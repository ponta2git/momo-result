package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestMain(tests *testing.M) {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--pilot-test-descendant":
			connection, err := net.Dial("tcp", os.Args[2])
			if err != nil {
				os.Exit(2)
			}
			_, _ = connection.Write([]byte{1})
			_, _ = io.Copy(io.Discard, connection)
			connection.Close()
			os.Exit(0)
		case "ocr-pilot":
			mode, address, _ := strings.Cut(os.Args[3], "|")
			child := exec.Command(os.Args[0], "--pilot-test-descendant", address)
			child.Stdout = os.Stdout
			child.Stderr = os.Stderr
			if err := child.Start(); err != nil {
				os.Exit(2)
			}
			if mode == "wait" {
				_ = child.Wait()
			}
			_, _ = fmt.Fprint(os.Stdout, `{"detectedScreenType":"revenue"}`)
			os.Exit(0)
		}
	}
	os.Exit(tests.Run())
}

func TestRunPilotBoundsInheritedPipesAndStopsDescendants(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("process group cleanup is supported on Linux and macOS")
	}
	t.Parallel()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"wait", "exit"} {
		t.Run(mode, func(t *testing.T) {
			t.Parallel()
			listener, err := net.ListenTCP("tcp", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { listener.Close() })
			_ = listener.SetDeadline(time.Now().Add(10 * time.Second))
			done := make(chan error, 1)
			go func() {
				_, _, err := runPilot(engineOptions{binary: binary, timeout: 2 * time.Second}, imageMetadata{
					Path: mode + "|" + listener.Addr().String(), ScreenType: "revenue",
				})
				done <- err
			}()
			connection, err := listener.AcceptTCP()
			if err != nil {
				t.Fatal(err)
			}
			// Closing this connection also releases the fixture if the assertion fails.
			t.Cleanup(func() { connection.Close() })
			_ = connection.SetReadDeadline(time.Now().Add(10 * time.Second))
			var ready [1]byte
			if _, err := io.ReadFull(connection, ready[:]); err != nil {
				t.Fatalf("descendant did not become ready: %v", err)
			}
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("a pilot leaving live output writers must fail")
				}
				if mode == "wait" && err.Error() != "pilot_timeout" {
					t.Fatalf("deadline failure = %v, want pilot_timeout", err)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("pilot did not finish within the bounded wait")
			}
			if _, err := connection.Read(ready[:]); err != io.EOF {
				t.Fatalf("owned descendant remains alive after pilot completion: %v", err)
			}
		})
	}
}
