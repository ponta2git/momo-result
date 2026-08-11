package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"time"
)

const maximumPilotOutputBytes = 4 * 1024 * 1024

type engineOptions struct {
	binary       string
	layoutFamily string
	tessdataPath string
	timeout      time.Duration
}

func runPilot(options engineOptions, image imageMetadata) (pilotEnvelope, float64, error) {
	arguments := []string{
		"ocr-pilot",
		"--image", image.Path,
		"--screen-type", image.ScreenType,
	}
	if options.layoutFamily != "" {
		arguments = append(arguments, "--layout-family", options.layoutFamily)
	}
	if options.tessdataPath != "" {
		arguments = append(arguments, "--tessdata-path", options.tessdataPath)
	}
	ctx, cancel := context.WithTimeout(context.Background(), options.timeout)
	defer cancel()
	command := exec.CommandContext(ctx, options.binary, arguments...)
	stdout := newBoundedBuffer(maximumPilotOutputBytes)
	stderr := newBoundedBuffer(maximumPilotOutputBytes)
	command.Stdout = stdout
	command.Stderr = stderr
	started := time.Now()
	err := command.Run()
	duration := float64(time.Since(started).Microseconds()) / 1000
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return pilotEnvelope{}, duration, errors.New("pilot_timeout")
	}
	if err != nil {
		return pilotEnvelope{}, duration, errors.New("pilot_process_failed")
	}
	if stdout.exceeded || stderr.exceeded {
		return pilotEnvelope{}, duration, errors.New("pilot_output_exceeded")
	}
	decoder := json.NewDecoder(bytes.NewReader(stdout.Bytes()))
	decoder.DisallowUnknownFields()
	var envelope pilotEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return pilotEnvelope{}, duration, errors.New("pilot_output_invalid")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return pilotEnvelope{}, duration, errors.New("pilot_output_trailing_data")
	}
	if envelope.DetectedScreenType != image.ScreenType {
		return pilotEnvelope{}, duration, fmt.Errorf("pilot_screen_mismatch")
	}
	return envelope, duration, nil
}

type boundedBuffer struct {
	buffer   bytes.Buffer
	limit    int
	exceeded bool
}

func newBoundedBuffer(limit int) *boundedBuffer {
	return &boundedBuffer{limit: limit}
}

func (buffer *boundedBuffer) Write(value []byte) (int, error) {
	originalLength := len(value)
	remaining := buffer.limit - buffer.buffer.Len()
	if remaining <= 0 {
		buffer.exceeded = true
		return originalLength, nil
	}
	if len(value) > remaining {
		value = value[:remaining]
		buffer.exceeded = true
	}
	_, _ = buffer.buffer.Write(value)
	return originalLength, nil
}

func (buffer *boundedBuffer) Bytes() []byte {
	return buffer.buffer.Bytes()
}
