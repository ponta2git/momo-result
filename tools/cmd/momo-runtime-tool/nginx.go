package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
)

const (
	renderNginxEvent              = "runtime_nginx_render"
	defaultNginxTemplatePath      = "/etc/nginx/nginx.conf.template"
	defaultNginxOutputPath        = "/etc/nginx/nginx.conf"
	defaultCanonicalHost          = "momo-result.ponta.me"
	minimumOriginLockTokenLength  = 32
	developmentOriginLockToken    = "dev-origin-lock"
	allowedHostPlaceholder        = "__MOMO_ALLOWED_HOST_MAP_ENTRIES__"
	optionalOriginHostPlaceholder = "__MOMO_OPTIONAL_ORIGIN_LOCK_HOST_MAP_ENTRIES__"
	originLockTokenPlaceholder    = "__MOMO_ORIGIN_LOCK_TOKEN_VALUE__"
)

var hostPattern = regexp.MustCompile(`^[A-Za-z0-9.-]+$`)

type nginxRenderConfig struct {
	AppEnv            string
	CanonicalHost     string
	ExtraAllowedHosts string
	OriginLockToken   string
	TemplatePath      string
	OutputPath        string
}

type nginxRenderValues struct {
	AllowedHosts            []string
	OptionalOriginLockHosts []string
	OriginLockToken         string
}

func runRenderNginx(stdout io.Writer, stderr io.Writer) int {
	config := nginxRenderConfig{
		AppEnv:            strings.ToLower(environmentOrDefault("APP_ENV", "prod")),
		CanonicalHost:     environmentOrDefault("MOMO_CANONICAL_HOST", defaultCanonicalHost),
		ExtraAllowedHosts: os.Getenv("MOMO_EXTRA_ALLOWED_HOSTS"),
		OriginLockToken:   os.Getenv("MOMO_ORIGIN_LOCK_TOKEN"),
		TemplatePath:      environmentOrDefault("MOMO_NGINX_TEMPLATE_PATH", defaultNginxTemplatePath),
		OutputPath:        environmentOrDefault("MOMO_NGINX_OUTPUT_PATH", defaultNginxOutputPath),
	}
	values, err := resolveNginxRenderValues(config)
	if err != nil {
		writeResult(stderr, failureResult(renderNginxEvent, "InvalidConfiguration"))
		return 1
	}
	template, err := os.ReadFile(config.TemplatePath)
	if err != nil {
		writeResult(stderr, failureResult(renderNginxEvent, "TemplateReadError"))
		return 1
	}
	if err := validateNginxTemplate(string(template)); err != nil {
		writeResult(stderr, failureResult(renderNginxEvent, "TemplateContractError"))
		return 1
	}
	rendered := renderNginxTemplate(string(template), values)
	if err := os.WriteFile(config.OutputPath, []byte(rendered), 0o644); err != nil {
		writeResult(stderr, failureResult(renderNginxEvent, "OutputWriteError"))
		return 1
	}
	writeResult(stdout, successResult(renderNginxEvent))
	return 0
}

func validateNginxTemplate(template string) error {
	for _, placeholder := range []string{
		allowedHostPlaceholder,
		optionalOriginHostPlaceholder,
		originLockTokenPlaceholder,
	} {
		if strings.Count(template, placeholder) != 1 {
			return errors.New("invalid nginx template placeholder count")
		}
	}
	return nil
}

func resolveNginxRenderValues(config nginxRenderConfig) (nginxRenderValues, error) {
	if config.AppEnv != "dev" && config.AppEnv != "test" && config.AppEnv != "prod" {
		return nginxRenderValues{}, errors.New("invalid app environment")
	}
	token := config.OriginLockToken
	if token == "" {
		if config.AppEnv == "prod" {
			return nginxRenderValues{}, errors.New("missing production origin lock token")
		}
		token = developmentOriginLockToken
	}
	if strings.ContainsAny(token, "\r\n") {
		return nginxRenderValues{}, errors.New("invalid origin lock token")
	}
	if config.AppEnv == "prod" {
		if len(token) < minimumOriginLockTokenLength || !isVisibleASCII(token) {
			return nginxRenderValues{}, errors.New("invalid production origin lock token")
		}
	}
	allowed, err := parseHosts(config.CanonicalHost + "," + config.ExtraAllowedHosts)
	if err != nil || len(allowed) == 0 {
		return nginxRenderValues{}, errors.New("invalid allowed hosts")
	}
	optional := make([]string, 0)
	if config.AppEnv != "prod" {
		optional = []string{"localhost", "127.0.0.1"}
		for _, host := range optional {
			if !containsString(allowed, host) {
				allowed = append(allowed, host)
			}
		}
	}
	return nginxRenderValues{
		AllowedHosts:            allowed,
		OptionalOriginLockHosts: optional,
		OriginLockToken:         token,
	}, nil
}

func parseHosts(raw string) ([]string, error) {
	hosts := make([]string, 0)
	for _, part := range strings.Split(raw, ",") {
		host := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(part)), ".")
		if host == "" {
			continue
		}
		if err := validateHost(host); err != nil {
			return nil, err
		}
		if !containsString(hosts, host) {
			hosts = append(hosts, host)
		}
	}
	return hosts, nil
}

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

func renderNginxTemplate(template string, values nginxRenderValues) string {
	rendered := strings.ReplaceAll(template, allowedHostPlaceholder, nginxMapEntries(values.AllowedHosts, 1))
	rendered = strings.ReplaceAll(rendered, optionalOriginHostPlaceholder,
		nginxMapEntries(values.OptionalOriginLockHosts, 0))
	return strings.ReplaceAll(rendered, originLockTokenPlaceholder, nginxQuote(values.OriginLockToken))
}

func nginxMapEntries(hosts []string, value int) string {
	entries := make([]string, 0, len(hosts))
	for _, host := range hosts {
		entries = append(entries, fmt.Sprintf("    %s %d;", nginxQuote(host), value))
	}
	return strings.Join(entries, "\n")
}

func nginxQuote(value string) string {
	escaped := strings.ReplaceAll(value, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `"`, `\"`)
	return `"` + escaped + `"`
}

func isVisibleASCII(value string) bool {
	for _, character := range []byte(value) {
		if character < 33 || character > 126 {
			return false
		}
	}
	return true
}

func isASCIIAlphaNumeric(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z' || value >= '0' && value <= '9'
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

func environmentOrDefault(name string, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
