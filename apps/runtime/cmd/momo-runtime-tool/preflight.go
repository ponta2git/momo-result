package main

import (
	"context"
	"errors"
	"io"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	preflightEvent            = "runtime_release_preflight"
	defaultDBContractPath     = "/opt/momo-result/contracts/runtime-db-contract.json"
	preflightConnectTimeout   = 10 * time.Second
	preflightOperationTimeout = 20 * time.Second
)

func runPreflight(ctx context.Context, stdout io.Writer, stderr io.Writer) int {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		writeResult(stderr, failureResult(preflightEvent, "MissingDatabaseUrl"))
		return 1
	}
	contractPath := os.Getenv("MOMO_RUNTIME_DB_CONTRACT_PATH")
	if contractPath == "" {
		contractPath = defaultDBContractPath
	}
	contract, err := loadRuntimeDBContract(contractPath)
	if err != nil {
		writeResult(stderr, failureResult(preflightEvent, "ContractLoadError"))
		return 1
	}

	operationCtx, cancel := context.WithTimeout(ctx, preflightOperationTimeout)
	defer cancel()
	snapshot, err := inspectRuntimeDatabase(operationCtx, databaseURL)
	if err != nil {
		writeResult(stderr, failureResult(preflightEvent, "DatabaseProbeError"))
		return 1
	}
	missingCounts := missingContractCounts(contract, snapshot)
	if hasMissing(missingCounts) {
		result := failureResult(preflightEvent, "")
		result.MissingCounts = missingCounts
		writeResult(stderr, result)
		return 1
	}
	result := successResult(preflightEvent)
	result.ContractChecks = contractCheckCount(contract)
	writeResult(stdout, result)
	return 0
}

func inspectRuntimeDatabase(ctx context.Context, databaseURL string) (databaseSnapshot, error) {
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return databaseSnapshot{}, err
	}
	config.ConnectTimeout = preflightConnectTimeout
	config.RuntimeParams["application_name"] = "momo-result-release-preflight"
	connection, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		return databaseSnapshot{}, err
	}
	// Closing this dedicated connection also rolls back early error paths.
	defer func() { _ = connection.Close(ctx) }()

	transaction, err := connection.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return databaseSnapshot{}, err
	}
	if _, err := transaction.Exec(ctx, "SET LOCAL statement_timeout = 10000"); err != nil {
		return databaseSnapshot{}, err
	}
	if _, err := transaction.Exec(ctx, "SET LOCAL lock_timeout = 3000"); err != nil {
		return databaseSnapshot{}, err
	}

	columns, err := queryPairs(ctx, transaction,
		"SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'")
	if err != nil {
		return databaseSnapshot{}, err
	}
	tables, err := queryStrings(ctx, transaction,
		"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
	if err != nil {
		return databaseSnapshot{}, err
	}
	indexes, err := queryStrings(ctx, transaction,
		"SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")
	if err != nil {
		return databaseSnapshot{}, err
	}
	functions, err := queryStrings(ctx, transaction,
		"SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "+
			"WHERE n.nspname = 'public' AND EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) setting "+
			"WHERE setting = 'search_path=pg_catalog, public')")
	if err != nil {
		return databaseSnapshot{}, err
	}
	memberColumns, err := queryStrings(ctx, transaction,
		"SELECT column_name || ':' || data_type || ':' || is_nullable "+
			"FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'members' "+
			"AND column_name IN ('id', 'legacy_id')")
	if err != nil {
		return databaseSnapshot{}, err
	}
	memberQuery, err := memberSeedQuery(memberColumns)
	if err != nil {
		return databaseSnapshot{}, err
	}
	members, err := queryStrings(ctx, transaction, memberQuery)
	if err != nil {
		return databaseSnapshot{}, err
	}
	if err := transaction.Rollback(ctx); err != nil {
		return databaseSnapshot{}, err
	}
	return databaseSnapshot{
		Columns:           stringSet(columns),
		Tables:            stringSet(tables),
		Indexes:           stringSet(indexes),
		HardenedFunctions: stringSet(functions),
		SeedMemberIDs:     stringSet(members),
	}, nil
}

// The fixed roster stays in the legacy identity domain through a native UUID cutover.
// Do not silently accept an expand/contract midpoint as either supported schema.
func memberSeedQuery(columns []string) (string, error) {
	shape := stringSet(columns)
	_, legacyID := shape["id:text:NO"]
	_, canonicalID := shape["id:uuid:NO"]
	_, legacyAlias := shape["legacy_id:text:NO"]
	if len(shape) == 1 && legacyID {
		return "SELECT id FROM members", nil
	}
	if len(shape) == 2 && canonicalID && legacyAlias {
		return "SELECT legacy_id FROM members", nil
	}
	return "", errors.New("unsupported member identity shape")
}

type queryExecutor interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func queryStrings(ctx context.Context, executor queryExecutor, query string) ([]string, error) {
	rows, err := executor.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := make([]string, 0)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func queryPairs(ctx context.Context, executor queryExecutor, query string) ([]string, error) {
	rows, err := executor.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := make([]string, 0)
	for rows.Next() {
		var first string
		var second string
		if err := rows.Scan(&first, &second); err != nil {
			return nil, err
		}
		values = append(values, first+"."+second)
	}
	return values, rows.Err()
}
