//go:build linux

package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func processCommandLines() ([]string, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	commandLines := make([]string, 0)
	for _, entry := range entries {
		if !entry.IsDir() || !isDecimal(entry.Name()) {
			continue
		}
		raw, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "cmdline"))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) || errors.Is(err, os.ErrPermission) {
				continue
			}
			return nil, err
		}
		commandLines = append(commandLines, strings.ReplaceAll(string(raw), "\x00", " "))
	}
	return commandLines, nil
}

func isDecimal(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}
