package main

import (
	"context"
	"io"
	"os"
)

func main() {
	os.Exit(runCLI(context.Background(), os.Args[1:], os.Stdout, os.Stderr))
}

func runCLI(ctx context.Context, args []string, stdout io.Writer, stderr io.Writer) int {
	mode, err := maintenanceModeFromEnvironment()
	if err != nil {
		writeResult(stderr, failureResult("runtime_tool", "InvalidMaintenanceMode"))
		return 1
	}
	if len(args) == 0 {
		writeResult(stderr, failureResult("runtime_tool", "InvalidArguments"))
		return 2
	}

	switch args[0] {
	case "maintenance":
		return runMaintenanceControl(ctx, args[1:], stdout, stderr)
	case "serve":
		if len(args) != 1 {
			writeResult(stderr, failureResult(serveEvent, "InvalidArguments"))
			return 2
		}
		return runServe(ctx, stdout, stderr)
	case "preflight":
		if len(args) != 1 {
			writeResult(stderr, failureResult(preflightEvent, "InvalidArguments"))
			return 2
		}
		return runPreflight(ctx, stdout, stderr)
	case "render-caddy":
		if len(args) != 1 {
			writeResult(stderr, failureResult(renderCaddyEvent, "InvalidArguments"))
			return 2
		}
		return runRenderCaddy(stdout, stderr)
	case "smoke":
		if len(args) < 2 {
			writeResult(stderr, failureResult("runtime_smoke", "InvalidArguments"))
			return 2
		}
		if (mode == maintenanceFrozen) != (args[1] == "maintenance") {
			writeResult(stderr, failureResult("runtime_smoke", "MaintenanceModeMismatch"))
			return 1
		}
		switch args[1] {
		case "maintenance":
			if len(args) != 2 {
				writeResult(stderr, failureResult(maintenanceSmokeEvent, "InvalidArguments"))
				return 2
			}
			return runMaintenanceSmoke(ctx, stdout, stderr)
		case "local":
			if len(args) != 2 {
				writeResult(stderr, failureResult(localSmokeEvent, "InvalidArguments"))
				return 2
			}
			return runLocalSmoke(ctx, stdout, stderr)
		case "edge":
			if len(args) > 3 {
				writeResult(stderr, failureResult(edgeSmokeEvent, "InvalidArguments"))
				return 2
			}
			host := ""
			if len(args) == 3 {
				host = args[2]
			}
			return runEdgeSmoke(ctx, host, stdout, stderr)
		case "http2":
			if len(args) != 2 {
				writeResult(stderr, failureResult(http2SmokeEvent, "InvalidArguments"))
				return 2
			}
			return runHTTP2Smoke(ctx, stdout, stderr)
		default:
			writeResult(stderr, failureResult("runtime_smoke", "InvalidArguments"))
			return 2
		}

	default:
		writeResult(stderr, failureResult("runtime_tool", "InvalidArguments"))
		return 2
	}
}
