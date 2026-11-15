package main

import (
	"errors"
	"os"
	"regexp"
	"strings"
)

const defaultCanonicalHost = "momo-result.ponta.me"

var hostPattern = regexp.MustCompile(`^[A-Za-z0-9.-]+$`)

func validateHost(host string) error {
	if len(host) > 253 || !hostPattern.MatchString(host) {
		return errors.New("invalid host")
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) < 1 || len(label) > 63 || !isASCIIAlphaNumeric(label[0]) ||
			!isASCIIAlphaNumeric(label[len(label)-1]) {
			return errors.New("invalid host label")
		}
	}
	return nil
}

func isASCIIAlphaNumeric(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z' || value >= '0' && value <= '9'
}

func environmentOrDefault(name string, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
