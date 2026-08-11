//go:build !linux

package main

import "errors"

func processCommandLines() ([]string, error) {
	return nil, errors.New("process inspection requires Linux")
}
