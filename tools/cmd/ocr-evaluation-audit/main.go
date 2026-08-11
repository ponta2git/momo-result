// ocr-evaluation-audit checks sample independence and computes conservative paired-comparison
// planning floors. It does not decide release eligibility without a Rust/Python paired pilot.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var evaluationFilenamePattern = regexp.MustCompile(
	`^[^_]+_[0-9]+_[0-9]{8}_[^_]+_(01|02|03)[^_.]+(?:_[^.]+)?\.(jpg|jpeg|png|webp)$`,
)

type stringList []string

func (values *stringList) String() string {
	return strings.Join(*values, ",")
}

func (values *stringList) Set(value string) error {
	if strings.TrimSpace(value) == "" {
		return errors.New("samples-dir must not be empty")
	}
	*values = append(*values, value)
	return nil
}

type options struct {
	sampleDirectories stringList
	maximumWidth      int
	maximumHeight     int
	requireUnique     bool
	allowIgnored      bool
	baselineCorrect   uint64
	baselineTotal     uint64
	marginBasisPoints uint
	alphaBasisPoints  uint
	powerBasisPoints  uint
	fieldsPerMatch    uint
	imagesPerMatch    uint
}

type datasetAudit struct {
	Directories                   int            `json:"directories"`
	ImageFiles                    int            `json:"imageFiles"`
	EvaluationEligibleFiles       int            `json:"evaluationEligibleFiles"`
	IgnoredImageFiles             int            `json:"ignoredImageFiles"`
	UniqueContents                int            `json:"uniqueContents"`
	DuplicateFileReferences       int            `json:"duplicateFileReferences"`
	DuplicateContentGroups        int            `json:"duplicateContentGroups"`
	CrossDirectoryDuplicateGroups int            `json:"crossDirectoryDuplicateGroups"`
	OverDimensionUniqueContents   int            `json:"overDimensionUniqueContents"`
	Dimensions                    map[string]int `json:"dimensions"`
	Extensions                    map[string]int `json:"extensions"`
	Passed                        bool           `json:"passed"`
}

type sampleFloor struct {
	AssumedDiscordanceRate float64 `json:"assumedDiscordanceRate"`
	IndependentFields      uint64  `json:"independentFields"`
	RoundedMatches         uint64  `json:"roundedMatches"`
	RoundedImages          uint64  `json:"roundedImages"`
	RoundedFields          uint64  `json:"roundedFields"`
}

type holdoutPlan struct {
	BaselineAccuracy              float64     `json:"baselineAccuracy"`
	BaselineErrorRate             float64     `json:"baselineErrorRate"`
	BaselineErrorRateUpperBound   float64     `json:"baselineErrorRateUpperBound"`
	NoninferiorityMargin          float64     `json:"noninferiorityMargin"`
	OneSidedAlpha                 float64     `json:"oneSidedAlpha"`
	Power                         float64     `json:"power"`
	PointEstimateFloor            sampleFloor `json:"pointEstimateFloor"`
	UncertaintyAwareFloor         sampleFloor `json:"uncertaintyAwareFloor"`
	PlanningModel                 string      `json:"planningModel"`
	PairedPilotRequired           bool        `json:"pairedPilotRequired"`
	MatchClusterAdjustmentPending bool        `json:"matchClusterAdjustmentPending"`
}

type report struct {
	SchemaVersion int          `json:"schemaVersion"`
	Dataset       datasetAudit `json:"dataset"`
	Holdout       holdoutPlan  `json:"holdout"`
	Passed        bool         `json:"passed"`
}

type contentRecord struct {
	directories map[string]struct{}
	width       int
	height      int
	count       int
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout io.Writer, stderr io.Writer) int {
	opts, err := parseOptions(args, stderr)
	if err != nil {
		return 2
	}
	if err := validateOptions(opts); err != nil {
		_, _ = fmt.Fprintf(stderr, "invalid audit configuration: %v\n", err)
		return 2
	}
	dataset, err := auditDataset(opts)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "dataset audit failed: %v\n", err)
		return 1
	}
	holdout := planHoldout(opts)
	result := report{
		SchemaVersion: 1,
		Dataset:       dataset,
		Holdout:       holdout,
		Passed:        dataset.Passed,
	}
	if err := json.NewEncoder(stdout).Encode(result); err != nil {
		_, _ = fmt.Fprintf(stderr, "failed to encode audit report: %v\n", err)
		return 1
	}
	if result.Passed {
		return 0
	}
	return 1
}

func parseOptions(args []string, stderr io.Writer) (options, error) {
	opts := options{}
	flags := flag.NewFlagSet("ocr-evaluation-audit", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.Var(&opts.sampleDirectories, "samples-dir", "sample directory; repeatable")
	flags.IntVar(&opts.maximumWidth, "maximum-width", 1920, "maximum supported image width")
	flags.IntVar(&opts.maximumHeight, "maximum-height", 1080, "maximum supported image height")
	flags.BoolVar(&opts.requireUnique, "require-unique", false, "fail when duplicate content exists")
	flags.BoolVar(&opts.allowIgnored, "allow-ignored", false, "allow image files outside the evaluator filename contract")
	flags.Uint64Var(&opts.baselineCorrect, "baseline-correct", 0, "correct unique baseline fields")
	flags.Uint64Var(&opts.baselineTotal, "baseline-total", 0, "total unique baseline fields")
	flags.UintVar(&opts.marginBasisPoints, "margin-basis-points", 50, "noninferiority margin in basis points")
	flags.UintVar(&opts.alphaBasisPoints, "alpha-basis-points", 500, "one-sided alpha in basis points")
	flags.UintVar(&opts.powerBasisPoints, "power-basis-points", 8000, "target power in basis points")
	flags.UintVar(&opts.fieldsPerMatch, "fields-per-match", 36, "evaluated fields contributed by one match")
	flags.UintVar(&opts.imagesPerMatch, "images-per-match", 3, "images contributed by one match")
	if err := flags.Parse(args); err != nil {
		return options{}, err
	}
	if flags.NArg() != 0 {
		return options{}, errors.New("positional arguments are not supported")
	}
	return opts, nil
}

func validateOptions(opts options) error {
	if len(opts.sampleDirectories) == 0 {
		return errors.New("at least one samples-dir is required")
	}
	if opts.maximumWidth <= 0 || opts.maximumHeight <= 0 {
		return errors.New("maximum image dimensions must be positive")
	}
	if opts.baselineTotal == 0 || opts.baselineCorrect > opts.baselineTotal {
		return errors.New("baseline counts are invalid")
	}
	if opts.marginBasisPoints == 0 || opts.marginBasisPoints >= 10_000 {
		return errors.New("noninferiority margin must be between 0 and 10000 basis points")
	}
	if opts.alphaBasisPoints == 0 || opts.alphaBasisPoints >= 5_000 {
		return errors.New("one-sided alpha must be between 0 and 5000 basis points")
	}
	if opts.powerBasisPoints <= 5_000 || opts.powerBasisPoints >= 10_000 {
		return errors.New("power must be between 5000 and 10000 basis points")
	}
	if opts.fieldsPerMatch == 0 || opts.imagesPerMatch == 0 {
		return errors.New("per-match counts must be positive")
	}
	return nil
}

func auditDataset(opts options) (datasetAudit, error) {
	contents := make(map[string]*contentRecord)
	audit := datasetAudit{
		Directories: len(opts.sampleDirectories),
		Dimensions:  make(map[string]int),
		Extensions:  make(map[string]int),
	}
	for _, directory := range opts.sampleDirectories {
		entries, err := os.ReadDir(directory)
		if err != nil {
			return datasetAudit{}, fmt.Errorf("read samples directory: %w", err)
		}
		cleanDirectory := filepath.Clean(directory)
		for _, entry := range entries {
			info, err := entry.Info()
			if err != nil {
				return datasetAudit{}, fmt.Errorf("inspect sample entry: %w", err)
			}
			if !info.Mode().IsRegular() || !supportedImageExtension(entry.Name()) {
				continue
			}
			audit.ImageFiles++
			if !evaluationFilenamePattern.MatchString(strings.ToLower(entry.Name())) {
				audit.IgnoredImageFiles++
				continue
			}
			path := filepath.Join(directory, entry.Name())
			digest, width, height, err := inspectImage(path)
			if err != nil {
				return datasetAudit{}, fmt.Errorf("inspect sample image: %w", err)
			}
			audit.EvaluationEligibleFiles++
			audit.Extensions[strings.ToLower(filepath.Ext(entry.Name()))]++
			record, exists := contents[digest]
			if !exists {
				record = &contentRecord{
					directories: make(map[string]struct{}),
					width:       width,
					height:      height,
				}
				contents[digest] = record
				audit.Dimensions[fmt.Sprintf("%dx%d", width, height)]++
			}
			record.directories[cleanDirectory] = struct{}{}
			record.count++
		}
	}
	audit.UniqueContents = len(contents)
	audit.DuplicateFileReferences = audit.EvaluationEligibleFiles - audit.UniqueContents
	for _, record := range contents {
		if record.count > 1 {
			audit.DuplicateContentGroups++
		}
		if len(record.directories) > 1 {
			audit.CrossDirectoryDuplicateGroups++
		}
		if record.width > opts.maximumWidth || record.height > opts.maximumHeight {
			audit.OverDimensionUniqueContents++
		}
	}
	audit.Passed = audit.OverDimensionUniqueContents == 0 &&
		(opts.allowIgnored || audit.IgnoredImageFiles == 0) &&
		(!opts.requireUnique || audit.DuplicateFileReferences == 0)
	return audit, nil
}

func inspectImage(path string) (string, int, int, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", 0, 0, err
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		file.Close()
		return "", 0, 0, err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		file.Close()
		return "", 0, 0, err
	}
	config, _, err := image.DecodeConfig(file)
	closeErr := file.Close()
	if err != nil {
		return "", 0, 0, err
	}
	if closeErr != nil {
		return "", 0, 0, closeErr
	}
	return hex.EncodeToString(hash.Sum(nil)), config.Width, config.Height, nil
}

func supportedImageExtension(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".webp":
		return true
	default:
		return false
	}
}

func planHoldout(opts options) holdoutPlan {
	accuracy := float64(opts.baselineCorrect) / float64(opts.baselineTotal)
	errorRate := 1 - accuracy
	alpha := float64(opts.alphaBasisPoints) / 10_000
	power := float64(opts.powerBasisPoints) / 10_000
	margin := float64(opts.marginBasisPoints) / 10_000
	errorUpper := wilsonUpper(opts.baselineTotal-opts.baselineCorrect, opts.baselineTotal, 1-alpha)
	return holdoutPlan{
		BaselineAccuracy:              accuracy,
		BaselineErrorRate:             errorRate,
		BaselineErrorRateUpperBound:   errorUpper,
		NoninferiorityMargin:          margin,
		OneSidedAlpha:                 alpha,
		Power:                         power,
		PointEstimateFloor:            floorForDiscordance(math.Min(1, 2*errorRate), margin, alpha, power, opts),
		UncertaintyAwareFloor:         floorForDiscordance(math.Min(1, 2*errorUpper), margin, alpha, power, opts),
		PlanningModel:                 "equal_accuracy_disjoint_errors_independent_fields_normal_approximation",
		PairedPilotRequired:           true,
		MatchClusterAdjustmentPending: true,
	}
}

func floorForDiscordance(discordance, margin, alpha, power float64, opts options) sampleFloor {
	zAlpha := normalQuantile(1 - alpha)
	zPower := normalQuantile(power)
	fields := uint64(math.Ceil(discordance * math.Pow(zAlpha+zPower, 2) / math.Pow(margin, 2)))
	matches := ceilDiv(fields, uint64(opts.fieldsPerMatch))
	return sampleFloor{
		AssumedDiscordanceRate: discordance,
		IndependentFields:      fields,
		RoundedMatches:         matches,
		RoundedImages:          matches * uint64(opts.imagesPerMatch),
		RoundedFields:          matches * uint64(opts.fieldsPerMatch),
	}
}

func wilsonUpper(successes, total uint64, confidence float64) float64 {
	p := float64(successes) / float64(total)
	z := normalQuantile(confidence)
	n := float64(total)
	denominator := 1 + z*z/n
	center := (p + z*z/(2*n)) / denominator
	halfWidth := z * math.Sqrt(p*(1-p)/n+z*z/(4*n*n)) / denominator
	return math.Min(1, center+halfWidth)
}

func ceilDiv(value, divisor uint64) uint64 {
	if value == 0 {
		return 0
	}
	return 1 + (value-1)/divisor
}

// normalQuantile uses Peter J. Acklam's rational approximation.
func normalQuantile(probability float64) float64 {
	if probability <= 0 || probability >= 1 {
		return math.NaN()
	}
	a := [...]float64{-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00}
	b := [...]float64{-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01}
	c := [...]float64{-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00}
	d := [...]float64{7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00}
	const lower = 0.02425
	const upper = 1 - lower
	if probability < lower {
		q := math.Sqrt(-2 * math.Log(probability))
		return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q + c[5]) /
			((((d[0]*q+d[1])*q+d[2])*q+d[3])*q + 1)
	}
	if probability > upper {
		q := math.Sqrt(-2 * math.Log(1-probability))
		return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q + c[5]) /
			((((d[0]*q+d[1])*q+d[2])*q+d[3])*q + 1)
	}
	q := probability - 0.5
	r := q * q
	return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r + a[5]) * q /
		(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r + 1)
}
