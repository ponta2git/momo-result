package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

const supportedDBContractVersion = 1

type runtimeDBContract struct {
	SchemaVersion     int      `json:"schemaVersion"`
	Columns           []string `json:"columns"`
	Tables            []string `json:"tables"`
	Indexes           []string `json:"indexes"`
	HardenedFunctions []string `json:"hardenedFunctions"`
	SeedMemberIDs     []string `json:"seedMemberIds"`
}

type databaseSnapshot struct {
	Columns           map[string]struct{}
	Tables            map[string]struct{}
	Indexes           map[string]struct{}
	HardenedFunctions map[string]struct{}
	SeedMemberIDs     map[string]struct{}
}

func loadRuntimeDBContract(path string) (runtimeDBContract, error) {
	encoded, err := os.ReadFile(path)
	if err != nil {
		return runtimeDBContract{}, fmt.Errorf("read runtime DB contract: %w", err)
	}
	var contract runtimeDBContract
	if err := json.Unmarshal(encoded, &contract); err != nil {
		return runtimeDBContract{}, fmt.Errorf("decode runtime DB contract: %w", err)
	}
	if contract.SchemaVersion != supportedDBContractVersion {
		return runtimeDBContract{}, fmt.Errorf("unsupported runtime DB contract version")
	}
	if err := validateContractValues(contract); err != nil {
		return runtimeDBContract{}, err
	}
	return contract, nil
}

func validateContractValues(contract runtimeDBContract) error {
	groups := map[string][]string{
		"columns":           contract.Columns,
		"tables":            contract.Tables,
		"indexes":           contract.Indexes,
		"hardenedFunctions": contract.HardenedFunctions,
		"seedMemberIds":     contract.SeedMemberIDs,
	}
	for name, values := range groups {
		seen := make(map[string]struct{}, len(values))
		for _, value := range values {
			if value == "" || strings.TrimSpace(value) != value {
				return fmt.Errorf("invalid %s contract value", name)
			}
			if _, exists := seen[value]; exists {
				return fmt.Errorf("duplicate %s contract value", name)
			}
			seen[value] = struct{}{}
		}
	}
	return nil
}

func missingContractCounts(contract runtimeDBContract, snapshot databaseSnapshot) map[string]int {
	return map[string]int{
		"columns":     countMissing(contract.Columns, snapshot.Columns),
		"tables":      countMissing(contract.Tables, snapshot.Tables),
		"indexes":     countMissing(contract.Indexes, snapshot.Indexes),
		"functions":   countMissing(contract.HardenedFunctions, snapshot.HardenedFunctions),
		"seedMembers": countMissing(contract.SeedMemberIDs, snapshot.SeedMemberIDs),
	}
}

func contractCheckCount(contract runtimeDBContract) int {
	return len(contract.Columns) + len(contract.Tables) + len(contract.Indexes) +
		len(contract.HardenedFunctions) + len(contract.SeedMemberIDs)
}

func countMissing(required []string, actual map[string]struct{}) int {
	count := 0
	for _, value := range required {
		if _, exists := actual[value]; !exists {
			count++
		}
	}
	return count
}

func hasMissing(counts map[string]int) bool {
	for _, count := range counts {
		if count != 0 {
			return true
		}
	}
	return false
}

func stringSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

func sortedKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}
