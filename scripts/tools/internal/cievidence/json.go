package cievidence

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"regexp"
	"unicode/utf8"
)

var (
	positiveIDPattern = regexp.MustCompile(`^[1-9][0-9]*$`)
	commitPattern     = regexp.MustCompile(`^[0-9a-f]{40}$`)
	shaPattern        = regexp.MustCompile(`^[0-9a-f]{64}$`)
	digestPattern     = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	versionPattern    = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z.+-]*$`)
	checkNamePattern  = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]*$`)
)

type object map[string]any

func decodeOne(data []byte) (any, error) {
	if !utf8.Valid(data) {
		return nil, errors.New("Invalid JSON document.")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, errors.New("Invalid JSON document.")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, errors.New("Expected one JSON document.")
	}
	return value, nil
}

func decodeObject(data []byte) (object, error) {
	value, err := decodeOne(data)
	if err != nil {
		return nil, err
	}
	result, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("Expected a JSON object.")
	}
	return result, nil
}

func (o object) keys(names ...string) bool {
	if len(o) != len(names) {
		return false
	}
	for _, name := range names {
		if _, exists := o[name]; !exists {
			return false
		}
	}
	return true
}

func (o object) text(name string) string {
	value, _ := o[name].(string)
	return value
}

func (o object) equals(name, expected string) bool {
	value, ok := o[name].(string)
	return ok && value == expected
}

func (o object) numberEquals(name string, expected float64) bool {
	value, ok := o[name].(json.Number)
	if !ok {
		return false
	}
	number, err := value.Float64()
	return err == nil && number == expected
}

func regularFile(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular()
}

func readRegular(path string) ([]byte, error) {
	if !regularFile(path) {
		return nil, errors.New("Evidence input must be a regular file.")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.New("Evidence input could not be read.")
	}
	return data, nil
}

func encodeLine(value any) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", errors.New("Evidence output could not be encoded.")
	}
	return string(data) + "\n", nil
}
