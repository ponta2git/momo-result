// ci-tool owns structured CI data. Shell callers own process orchestration.
package main

import (
	"fmt"
	"os"

	"github.com/ponta2git/momo-result/scripts/tools/internal/cievidence"
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
	default:
		return cievidence.Run(command, rest, os.Stdin, os.Stdout, os.Stderr, root)
	}
}
