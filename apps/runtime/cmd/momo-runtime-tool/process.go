package main

import (
	"sort"
	"strings"
)

var runtimeProcessMarkers = map[string][]string{
	"api":   {"/opt/java/openjdk/bin/java", "/opt/momo-result/api/lib/", "momo.api.Main"},
	"caddy": {"/usr/bin/caddy", "run", "--config"},
}

func missingRuntimeProcesses(commandLines []string) []string {
	missing := make([]string, 0)
	for name, markers := range runtimeProcessMarkers {
		found := false
		for _, commandLine := range commandLines {
			if containsAll(commandLine, markers) {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, name)
		}
	}
	sort.Strings(missing)
	return missing
}

func containsAll(value string, markers []string) bool {
	for _, marker := range markers {
		if !strings.Contains(value, marker) {
			return false
		}
	}
	return true
}
