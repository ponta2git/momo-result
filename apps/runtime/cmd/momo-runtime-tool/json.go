package main

import (
	"encoding/json"
	"errors"
	"io"
)

// decodeBoundedJSON requires the entire input to fit the limit. Limiting only a
// streaming decoder would mistake truncation for EOF and accept hidden suffixes.
func decodeBoundedJSON(reader io.Reader, limit int64, destination any) error {
	encoded, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return err
	}
	if int64(len(encoded)) > limit {
		return errors.New("JSON size limit exceeded")
	}
	return json.Unmarshal(encoded, destination)
}
