package main

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var sampleFilenamePattern = regexp.MustCompile(
	`^[^_]+_([0-9]+)_[0-9]{8}_[^_]+_(01|02|03)[^_.]+(?:_[^.]+)?\.(?i:jpg|jpeg|png|webp)$`,
)

var incidentFields = []string{
	"目的地",
	"プラス駅",
	"マイナス駅",
	"カード駅",
	"カード売り場",
	"スリの銀次",
}

func loadAnswers(path string) (map[int][]expectedPlayer, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open answers: %w", err)
	}
	defer file.Close()
	reader := csv.NewReader(file)
	reader.Comma = '\t'
	reader.FieldsPerRecord = -1
	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("read answers header: %w", err)
	}
	indexes := make(map[string]int, len(header))
	for index, name := range header {
		indexes[strings.TrimSpace(name)] = index
	}
	required := []string{"対戦No.", "プレー順", "プレーヤー名", "順位", "総資産", "収益"}
	required = append(required, incidentFields...)
	for _, name := range required {
		if _, ok := indexes[name]; !ok {
			return nil, fmt.Errorf("answers column is missing: %s", name)
		}
	}
	grouped := make(map[int][]expectedPlayer)
	for rowNumber := 2; ; rowNumber++ {
		record, readErr := reader.Read()
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return nil, fmt.Errorf("read answers row %d: %w", rowNumber, readErr)
		}
		matchNo, err := requiredInteger(record, indexes["対戦No."])
		if err != nil {
			return nil, fmt.Errorf("answers row %d match number: %w", rowNumber, err)
		}
		playOrder, err := requiredInteger(record, indexes["プレー順"])
		if err != nil {
			return nil, fmt.Errorf("answers row %d play order: %w", rowNumber, err)
		}
		name, err := requiredText(record, indexes["プレーヤー名"])
		if err != nil {
			return nil, fmt.Errorf("answers row %d player name: %w", rowNumber, err)
		}
		rank, err := optionalInteger(record, indexes["順位"])
		if err != nil {
			return nil, fmt.Errorf("answers row %d rank: %w", rowNumber, err)
		}
		totalAssets, err := optionalInteger(record, indexes["総資産"])
		if err != nil {
			return nil, fmt.Errorf("answers row %d total assets: %w", rowNumber, err)
		}
		revenue, err := optionalInteger(record, indexes["収益"])
		if err != nil {
			return nil, fmt.Errorf("answers row %d revenue: %w", rowNumber, err)
		}
		player := expectedPlayer{
			PlayOrder:   playOrder,
			Name:        name,
			Rank:        rank,
			TotalAssets: totalAssets,
			Revenue:     revenue,
			Incidents:   make(map[string]int64, len(incidentFields)),
		}
		for _, field := range incidentFields {
			value, err := optionalInteger(record, indexes[field])
			if err != nil {
				return nil, fmt.Errorf("answers row %d incident %s: %w", rowNumber, field, err)
			}
			if value != nil {
				player.Incidents[field] = *value
			} else {
				player.Incidents[field] = 0
			}
		}
		grouped[matchNo] = append(grouped[matchNo], player)
	}
	for matchNo, players := range grouped {
		if len(players) != 4 {
			return nil, fmt.Errorf("match %d has %d answer rows, want 4", matchNo, len(players))
		}
		sort.Slice(players, func(left, right int) bool {
			return players[left].PlayOrder < players[right].PlayOrder
		})
		for index, player := range players {
			if player.PlayOrder != index+1 {
				return nil, fmt.Errorf("match %d has a non-contiguous play order", matchNo)
			}
		}
		grouped[matchNo] = players
	}
	return grouped, nil
}

func selectImages(directory string, limit int) ([]imageMetadata, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("read samples directory: %w", err)
	}
	images := make([]imageMetadata, 0, len(entries))
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !supportedImage(entry.Name()) {
			continue
		}
		matches := sampleFilenamePattern.FindStringSubmatch(entry.Name())
		if matches == nil {
			continue
		}
		matchNo, parseErr := strconv.Atoi(matches[1])
		if parseErr != nil {
			return nil, fmt.Errorf("parse image match number: %w", parseErr)
		}
		screenType, ok := screenTypeForPrefix(matches[2])
		if !ok {
			return nil, errors.New("filename parser accepted an unsupported screen prefix")
		}
		images = append(images, imageMetadata{
			Path:       filepath.Join(directory, entry.Name()),
			File:       entry.Name(),
			MatchNo:    matchNo,
			ScreenType: screenType,
			Prefix:     matches[2],
		})
	}
	sort.Slice(images, func(left, right int) bool {
		if images[left].MatchNo == images[right].MatchNo {
			return images[left].Prefix < images[right].Prefix
		}
		return images[left].MatchNo < images[right].MatchNo
	})
	if limit > 0 && limit < len(images) {
		images = images[:limit]
	}
	if len(images) == 0 {
		return nil, errors.New("no evaluator-eligible images were found")
	}
	return images, nil
}

func requiredInteger(record []string, index int) (int, error) {
	text, err := requiredText(record, index)
	if err != nil {
		return 0, err
	}
	value, err := strconv.Atoi(text)
	if err != nil {
		return 0, err
	}
	return value, nil
}

func optionalInteger(record []string, index int) (*int64, error) {
	if index < 0 || index >= len(record) {
		return nil, errors.New("column is outside the record")
	}
	text := strings.TrimSpace(record[index])
	if text == "" {
		return nil, nil
	}
	value, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func requiredText(record []string, index int) (string, error) {
	if index < 0 || index >= len(record) {
		return "", errors.New("column is outside the record")
	}
	value := strings.TrimSpace(record[index])
	if value == "" {
		return "", errors.New("value is empty")
	}
	return value, nil
}

func supportedImage(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".webp":
		return true
	default:
		return false
	}
}

func screenTypeForPrefix(prefix string) (string, bool) {
	switch prefix {
	case "01":
		return "total_assets", true
	case "02":
		return "revenue", true
	case "03":
		return "incident_log", true
	default:
		return "", false
	}
}

func layoutFamily(directory string) string {
	base := filepath.Base(filepath.Clean(directory))
	switch {
	case strings.Contains(base, "桃鉄令和"):
		return "reiwa"
	case strings.Contains(base, "桃鉄ワールド") || strings.Contains(base, "桃鉄ワールド"):
		return "world"
	case strings.Contains(base, "桃鉄2"):
		return "momotetsu_2"
	default:
		return ""
	}
}
