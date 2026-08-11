package main

import "sort"

var legacyRuntimeProcessMarkers = map[string][]string{
	"api":       {"/opt/java/openjdk/bin/java", "/opt/momo-result/api/lib/", "momo.api.Main"},
	"nginx":     {"/usr/sbin/nginx"},
	"ocrWorker": {"/opt/momo-result/ocr-worker/.venv/bin/momo-ocr", "worker"},
}

func missingRuntimeProcesses(commandLines []string) []string {
	missing := make([]string, 0)
	for name, markers := range legacyRuntimeProcessMarkers {
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
		if !contains(value, marker) {
			return false
		}
	}
	return true
}

func contains(value string, marker string) bool {
	if len(marker) > len(value) {
		return false
	}
	for index := 0; index <= len(value)-len(marker); index++ {
		if value[index:index+len(marker)] == marker {
			return true
		}
	}
	return false
}
