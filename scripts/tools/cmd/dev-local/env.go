package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// readEnv supports dotenv assignments with optional export, comments, and quoted
// (including multiline) values. Values are never expanded. Invalid assignments
// and unclosed quotes fail before starting any development processes.
func readEnv(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read environment file %s", path)
	}
	result := map[string]string{}
	rest := strings.ReplaceAll(string(data), "\r\n", "\n")
	for len(rest) > 0 {
		line, next, _ := strings.Cut(rest, "\n")
		rest = next
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, found := strings.Cut(line, "=")
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if !found || key == "" {
			return nil, fmt.Errorf("invalid environment assignment in %s", path)
		}
		if len(value) > 0 && (value[0] == '\'' || value[0] == '"' || value[0] == '`') {
			quote := value[0]
			value = value[1:]
			for !strings.ContainsRune(value, rune(quote)) {
				if rest == "" {
					return nil, fmt.Errorf("unclosed environment quote in %s", path)
				}
				line, next, _ = strings.Cut(rest, "\n")
				rest = next
				value += "\n" + line
			}
			value = value[:strings.IndexByte(value, quote)]
			if quote == '"' {
				value = strings.ReplaceAll(value, `\n`, "\n")
			}
		} else {
			value, _, _ = strings.Cut(value, "#")
			value = strings.TrimSpace(value)
		}
		result[key] = value
	}
	return result, nil
}

func firstValue(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func resolveEnvironment(root string, base []string) ([]string, error) {
	local, err := readEnv(filepath.Join(root, ".env"))
	if err != nil {
		return nil, err
	}
	example, err := readEnv(filepath.Join(root, ".env.example"))
	if err != nil {
		return nil, err
	}
	process := map[string]string{}
	for _, entry := range base {
		if key, value, ok := strings.Cut(entry, "="); ok && key != "" {
			process[key] = value
		}
	}
	database := firstValue(process["DATABASE_URL"], local["DATABASE_URL"])
	if database == "" {
		shared, err := readEnv(filepath.Join(root, "../momo-db/.env.local"))
		if err != nil {
			return nil, err
		}
		database = firstValue(shared["DIRECT_URL"])
	}
	if database == "" {
		return nil, fmt.Errorf("Local development requires DATABASE_URL. Configure .env or ../momo-db/.env.local before running pnpm dev.")
	}
	for _, key := range []string{"APP_ENV", "MOMO_LOG_FORMAT", "REDIS_URL"} {
		fallback := example[key]
		if key == "APP_ENV" {
			fallback = firstValue(fallback, "dev")
		}
		if key == "MOMO_LOG_FORMAT" {
			fallback = firstValue(fallback, "text")
		}
		value := firstValue(process[key], local[key], fallback)
		if value != "" {
			process[key] = value
		}
	}
	for key, value := range process {
		local[key] = value
	}
	local["DATABASE_URL"] = database
	result := make([]string, 0, len(local))
	for key, value := range local {
		result = append(result, key+"="+value)
	}
	return result, nil
}
