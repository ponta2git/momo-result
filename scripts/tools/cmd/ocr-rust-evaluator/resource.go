package main

import (
	"os"
	"time"
)

func measuredProcessResources(state *os.ProcessState, wall time.Duration) processResourceMetrics {
	metrics := processResourceMetrics{
		WallMilliseconds:     durationMilliseconds(wall),
		MaximumResidentBytes: maximumResidentBytes(state),
	}
	if state != nil {
		metrics.UserCPUMilliseconds = durationMilliseconds(state.UserTime())
		metrics.SystemCPUMilliseconds = durationMilliseconds(state.SystemTime())
	}
	return metrics
}

func durationMilliseconds(duration time.Duration) float64 {
	return float64(duration.Microseconds()) / 1000
}
