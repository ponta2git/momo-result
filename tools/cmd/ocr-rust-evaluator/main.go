// ocr-rust-evaluator runs the dormant Rust OCR core against a local, answer-keyed development
// dataset. It can compare the result with the existing Python evaluator at identical field keys.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

type options struct {
	samplesDirectory  string
	answersPath       string
	rustBinary        string
	tessdataPath      string
	reportPath        string
	baselineReport    string
	timeout           time.Duration
	limit             int
	marginBasisPoints uint
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	options, err := parseOptions(args, stderr)
	if err != nil {
		return 2
	}
	if err := validateOptions(options); err != nil {
		_, _ = fmt.Fprintf(stderr, "invalid evaluator configuration: %v\n", err)
		return 2
	}
	answers, err := loadAnswers(options.answersPath)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "answer loading failed: %v\n", err)
		return 1
	}
	images, err := selectImages(options.samplesDirectory, options.limit)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "image selection failed: %v\n", err)
		return 1
	}
	results := make([]imageResult, 0, len(images))
	engine := engineOptions{
		binary:       options.rustBinary,
		layoutFamily: layoutFamily(options.samplesDirectory),
		tessdataPath: options.tessdataPath,
		timeout:      options.timeout,
	}
	for index, image := range images {
		expected, ok := answers[image.MatchNo]
		if !ok {
			_, _ = fmt.Fprintln(stderr, "selected image has no answer-key match")
			return 1
		}
		envelope, resources, pilotErr := runPilot(engine, image)
		result := evaluateImage(image, expected, envelope, resources, pilotErr)
		results = append(results, result)
		_, _ = fmt.Fprintf(
			stderr,
			"[%d/%d] match=%d screen=%s fields=%d/%d failure=%t\n",
			index+1,
			len(images),
			image.MatchNo,
			image.ScreenType,
			result.FieldCorrect,
			result.FieldTotal,
			result.Failure != nil,
		)
	}
	report := evaluationReport{
		SchemaVersion: 2,
		Summary:       summarize(results),
		Results:       results,
	}
	if options.baselineReport != "" {
		report.Paired, err = compareWithBaseline(
			options.baselineReport,
			images,
			answers,
			results,
			float64(options.marginBasisPoints)/10_000,
		)
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "paired comparison failed: %v\n", err)
			return 1
		}
	}
	report.Passed = report.Summary.Failures == 0 &&
		(report.Paired == nil || report.Paired.PilotNoninferioritySupported)
	if err := writeReport(options.reportPath, report); err != nil {
		_, _ = fmt.Fprintf(stderr, "report write failed: %v\n", err)
		return 1
	}
	if err := json.NewEncoder(stdout).Encode(struct {
		Summary evaluationSummary `json:"summary"`
		Paired  *pairedSummary    `json:"paired,omitempty"`
		Passed  bool              `json:"passed"`
	}{Summary: report.Summary, Paired: report.Paired, Passed: report.Passed}); err != nil {
		_, _ = fmt.Fprintf(stderr, "summary encoding failed: %v\n", err)
		return 1
	}
	if report.Passed {
		return 0
	}
	return 1
}

func parseOptions(args []string, stderr io.Writer) (options, error) {
	options := options{}
	flags := flag.NewFlagSet("ocr-rust-evaluator", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.StringVar(&options.samplesDirectory, "samples-dir", "", "local OCR sample directory")
	flags.StringVar(&options.answersPath, "answers", "", "answer TSV path")
	flags.StringVar(&options.rustBinary, "rust-binary", "", "momo-analysis binary path")
	flags.StringVar(&options.tessdataPath, "tessdata-path", "", "optional tessdata directory")
	flags.StringVar(&options.reportPath, "report", "", "private detailed report path")
	flags.StringVar(&options.baselineReport, "baseline-report", "", "optional Python evaluator JSON report")
	flags.DurationVar(&options.timeout, "image-timeout", 30*time.Second, "per-image process timeout")
	flags.IntVar(&options.limit, "limit", 0, "maximum selected images; zero means all")
	flags.UintVar(&options.marginBasisPoints, "margin-basis-points", 50, "paired noninferiority margin")
	if err := flags.Parse(args); err != nil {
		return options, err
	}
	if flags.NArg() != 0 {
		return options, errors.New("positional arguments are not supported")
	}
	return options, nil
}

func validateOptions(options options) error {
	if options.samplesDirectory == "" || options.answersPath == "" || options.rustBinary == "" || options.reportPath == "" {
		return errors.New("samples-dir, answers, rust-binary, and report are required")
	}
	if options.timeout <= 0 || options.limit < 0 {
		return errors.New("timeout and limit are invalid")
	}
	if options.marginBasisPoints == 0 || options.marginBasisPoints >= 10_000 {
		return errors.New("margin-basis-points must be between 0 and 10000")
	}
	for label, path := range map[string]string{
		"samples-dir": options.samplesDirectory,
		"answers":     options.answersPath,
		"rust-binary": options.rustBinary,
	} {
		info, err := os.Stat(path)
		if err != nil {
			return fmt.Errorf("%s is unavailable", label)
		}
		if label == "samples-dir" && !info.IsDir() {
			return errors.New("samples-dir is not a directory")
		}
		if label != "samples-dir" && !info.Mode().IsRegular() {
			return fmt.Errorf("%s is not a regular file", label)
		}
	}
	return nil
}

func writeReport(path string, report evaluationReport) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".ocr-rust-evaluator-*.json")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	removeTemporary := true
	defer func() {
		if removeTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	removeTemporary = false
	return nil
}
