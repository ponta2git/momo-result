// ci-tool owns structured CI data. Shell callers own process orchestration.
package main

import (
	"fmt"
	"os"

	"github.com/ponta2git/momo-result/scripts/tools/internal/cievidence"
	"github.com/ponta2git/momo-result/scripts/tools/internal/ciproducer"
	"github.com/ponta2git/momo-result/scripts/tools/internal/cireport"
)

func main() { os.Exit(run(os.Args[1:])) }

func run(args []string) int {
	root, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Cannot determine repository root.")
		return 1
	}
	if len(args) >= 2 && args[0] == "--repo-root" {
		root, args = args[1], args[2:]
	}
	if len(args) == 0 || args[0] == "--help" || args[0] == "help" {
		fmt.Fprintln(os.Stdout, "Usage: ci-tool [--repo-root PATH] COMMAND [ARGS]\nStructured CI reports, evidence validation, and metadata generation.\nRun COMMAND --help for its input/output contract.")
		if len(args) == 0 {
			return 2
		}
		return 0
	}
	command, rest := args[0], args[1:]
	switch command {
	case "coverage", "runtime-logs", "analysis-report", "analysis-summary", "analysis-report-state":
		return cireport.Run(command, rest, os.Stdin, os.Stdout, os.Stderr, root)
	case "runtime-candidate", "analysis-candidate", "runtime-deployment", "runtime-release-selection", "postdeploy-evidence", "worker-readiness", "artifact-digest", "analysis-archive", "image-id-match", "analysis-release-selection", "file-digest-match":
		return cievidence.Run(command, rest, os.Stdin, os.Stdout, os.Stderr, root)
	case "create-http4s-patch", "create-runtime-candidate", "create-analysis-candidate", "create-runtime-deployment", "resolve-pushed-image", "resolve-deployment-run", "verify-manifest-artifact", "runtime-machine-evidence", "runtime-machine-id", "analysis-machine-identity", "analysis-reusable-release", "analysis-machine-evidence", "analysis-secrets", "canonical-json", "public-edge-evidence":
		return ciproducer.Run(command, rest, os.Stdin, os.Stdout, os.Stderr, root)
	default:
		fmt.Fprintln(os.Stderr, "Unknown CI command. Run ci-tool --help.")
		return 2
	}
}
