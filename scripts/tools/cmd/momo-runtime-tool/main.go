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
	if len(args) == 0 {
		writeResult(stderr, failureResult("runtime_tool", "InvalidArguments"))
		return 2
	}

	switch args[0] {
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
		switch args[1] {
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
	case "validate-postdeploy-evidence":
		return runValidatePostdeployEvidence(args[1:], stdout, stderr)
	case "summarize-logs":
		if len(args) != 1 {
			writeResult(stderr, failureResult(logSummaryEvent, "InvalidArguments"))
			return 2
		}
		return runSummarizeLogs(os.Stdin, stdout, stderr)
	default:
		writeResult(stderr, failureResult("runtime_tool", "InvalidArguments"))
		return 2
	}
}
