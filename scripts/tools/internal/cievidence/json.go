package cievidence

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"math/big"
	"os"
	"regexp"
	"strings"
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

func (o object) numberEquals(name string, expected int64) bool {
	value, ok := o[name].(json.Number)
	if !ok {
		return false
	}
	// The float conversion is only a cheap rejection of obviously different
	// magnitudes. Rounded fractions must never pass a schema-version guard.
	approximate, err := value.Float64()
	if err != nil || approximate != float64(expected) {
		return false
	}
	number, ok := new(big.Rat).SetString(string(value))
	return ok && number.Cmp(big.NewRat(expected, 1)) == 0
}

func readObjectFile(path string) (object, error) {
	data, err := readRegular(path)
	if err != nil {
		return nil, err
	}
	return decodeObject(data)
}

// Provider fields are not a wire schema: extra fields are ignored and only
// explicitly projected values can become public evidence.
func objectMap(value any) object {
	switch m := value.(type) {
	case map[string]any:
		return m
	case object:
		return m
	default:
		return nil
	}
}
func field(value any, keys ...string) any {
	for _, key := range keys {
		value = objectMap(value)[key]
	}
	return value
}
func str(value any) string { s, _ := value.(string); return s }
func number(value any) string {
	n, ok := value.(json.Number)
	if !ok {
		return ""
	}
	text := string(n)
	if !strings.ContainsAny(text, ".eE") {
		return strings.TrimPrefix(text, "+")
	}
	mantissa, _, _ := strings.Cut(strings.ToLower(text), "e")
	if strings.Trim(mantissa, "-0.") == "" {
		return "0"
	}
	// Exponent notation must not turn a few input bytes into an enormous
	// integer allocation. Literal integers remain exact at their input size.
	f, err := n.Float64()
	if err != nil || math.IsInf(f, 0) || math.Abs(f) < 1 {
		return ""
	}
	r, ok := new(big.Rat).SetString(string(n))
	if !ok || !r.IsInt() {
		return ""
	}
	return r.Num().String()
}
func readJSON(in io.Reader) (any, error) {
	data, err := io.ReadAll(in)
	if err != nil {
		return nil, errors.New("Provider input could not be read.")
	}
	return decodeOne(data)
}
func encode(out io.Writer, value any) error {
	e := json.NewEncoder(out)
	e.SetIndent("", "  ")
	return e.Encode(value)
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
