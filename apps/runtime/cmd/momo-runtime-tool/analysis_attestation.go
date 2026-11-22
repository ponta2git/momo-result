package main

import (
	"context"
	"errors"
	"io"
	"net"
	"regexp"
	"time"
)

var readerAttestationID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$`)

// Ask the running JVM to renew its own registration. Reading the image's build
// contract would say nothing about the validator actually serving this machine.
func attestReader(ctx context.Context, output io.Writer) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp4", "127.0.0.1:19371")
	if err != nil {
		return err
	}
	defer conn.Close()
	deadline, _ := ctx.Deadline()
	if err = conn.SetDeadline(deadline); err != nil {
		return err
	}
	if _, err = io.WriteString(conn, "momo-release-attest-v1\n"); err != nil {
		return err
	}
	response, err := io.ReadAll(io.LimitReader(conn, 38))
	if err != nil || !readerAttestationID.Match(response) {
		return errors.New("invalid reader attestation")
	}
	_, err = output.Write(response)
	return err
}
