package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgproto3"
)

func TestDatabaseProbesBoundTransactionCleanup(t *testing.T) {
	probes := []struct {
		name string
		run  func(context.Context, string) error
	}{
		{name: "smoke", run: probeDatabase},
		{name: "preflight", run: func(ctx context.Context, databaseURL string) error {
			_, err := inspectRuntimeDatabase(ctx, databaseURL)
			return err
		}},
	}
	for _, probe := range probes {
		for _, stallRollback := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stall_rollback=%t", probe.name, stallRollback), func(t *testing.T) {
				databaseURL, rollbackReceived, disconnected := startProbeDatabasePeer(t, stallRollback)
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				result := make(chan error, 1)
				go func() { result <- probe.run(ctx, databaseURL) }()
				select {
				case <-rollbackReceived:
				case <-time.After(3 * time.Second):
					t.Fatal("probe did not reach transaction cleanup")
				}
				if stallRollback {
					cancel()
				}
				select {
				case err := <-result:
					if stallRollback && err == nil {
						t.Fatal("probe reported success despite canceled transaction cleanup")
					}
					if !stallRollback && err != nil {
						t.Fatalf("healthy database probe failed: %v", err)
					}
				case <-time.After(time.Second):
					t.Fatal("transaction cleanup outlived probe cancellation")
				}
				select {
				case <-disconnected:
				case <-time.After(time.Second):
					t.Fatal("probe left its database connection open")
				}
			})
		}
	}
}

// Exercise the real pgx transaction and socket cleanup. The peer completes all
// read-only queries, then can withhold the ROLLBACK reply without closing TCP.
func startProbeDatabasePeer(t *testing.T, stallRollback bool) (string, <-chan struct{}, <-chan struct{}) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	connected := make(chan net.Conn, 1)
	rollbackReceived := make(chan struct{})
	finished := make(chan struct{})
	var peerErr error
	go func() {
		defer close(finished)
		connection, err := listener.Accept()
		if err != nil {
			return
		}
		connected <- connection
		defer connection.Close()
		cancelHandled := make(chan struct{})
		go func() {
			defer close(cancelHandled)
			cancelConnection, err := listener.Accept()
			if err != nil {
				return
			}
			defer cancelConnection.Close()
			_, _ = pgproto3.NewBackend(cancelConnection, cancelConnection).ReceiveStartupMessage()
		}()
		peerErr = serveProbeDatabasePeer(connection, rollbackReceived, stallRollback)
		_ = listener.Close()
		<-cancelHandled
	}()
	t.Cleanup(func() {
		_ = listener.Close()
		select {
		case connection := <-connected:
			_ = connection.Close()
		case <-finished:
		}
		<-finished
		if peerErr != nil && !errors.Is(peerErr, net.ErrClosed) {
			t.Errorf("database peer: %v", peerErr)
		}
	})
	databaseURL := "postgres://probe@" + listener.Addr().String() + "/probe?sslmode=disable&default_query_exec_mode=simple_protocol"
	return databaseURL, rollbackReceived, finished
}

func serveProbeDatabasePeer(connection net.Conn, rollbackReceived chan<- struct{}, stallRollback bool) error {
	backend := pgproto3.NewBackend(connection, connection)
	if _, err := backend.ReceiveStartupMessage(); err != nil {
		return err
	}
	backend.Send(&pgproto3.AuthenticationOk{})
	backend.Send(&pgproto3.ParameterStatus{Name: "standard_conforming_strings", Value: "on"})
	backend.Send(&pgproto3.ParameterStatus{Name: "client_encoding", Value: "UTF8"})
	backend.Send(&pgproto3.ReadyForQuery{TxStatus: 'I'})
	if err := backend.Flush(); err != nil {
		return err
	}
	for {
		message, err := backend.Receive()
		if err != nil {
			return err
		}
		if _, ok := message.(*pgproto3.Terminate); ok {
			return nil
		}
		query, ok := message.(*pgproto3.Query)
		if !ok {
			return fmt.Errorf("unexpected message %T", message)
		}
		sql := strings.ToLower(query.String)
		tag, status := "SET", byte('T')
		switch {
		case sql == "begin read only":
			tag = "BEGIN"
		case strings.HasPrefix(sql, "set local "):
		case sql == "rollback":
			close(rollbackReceived)
			if stallRollback {
				message, err := backend.Receive()
				if err != nil {
					return err
				}
				if _, ok := message.(*pgproto3.Terminate); !ok {
					return fmt.Errorf("expected termination after stalled rollback, got %T", message)
				}
				return nil
			}
			tag, status = "ROLLBACK", 'I'
		case strings.HasPrefix(sql, "select "):
			fields := []pgproto3.FieldDescription{{Name: []byte("value"), DataTypeOID: 25, DataTypeSize: -1, TypeModifier: -1}}
			if sql == "select 1" {
				fields[0].DataTypeOID, fields[0].DataTypeSize = 23, 4
			}
			if strings.Contains(sql, "table_name, column_name") {
				fields = append(fields, fields[0])
			}
			backend.Send(&pgproto3.RowDescription{Fields: fields})
			tag = "SELECT 0"
			if sql == "select 1" {
				backend.Send(&pgproto3.DataRow{Values: [][]byte{[]byte("1")}})
				tag = "SELECT 1"
			}
		default:
			return fmt.Errorf("unexpected query %q", sql)
		}
		backend.Send(&pgproto3.CommandComplete{CommandTag: []byte(tag)})
		backend.Send(&pgproto3.ReadyForQuery{TxStatus: status})
		if err := backend.Flush(); err != nil {
			return err
		}
	}
}
