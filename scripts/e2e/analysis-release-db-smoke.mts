import { isDeepStrictEqual } from "node:util";
import {
  algorithmVersion,
  check,
  cleanups,
  records,
  releaseId,
  report,
  requireSuccess,
  runSmoke,
  Smoke,
  withCleanup,
} from "./worker-smoke-support.mts";

await runSmoke("Release control-plane smoke", async (signal) => {
  check(process.argv.length <= 3, "Expected at most one worker binary argument.");
  const smoke = new Smoke(signal);
  const workerImage = process.env.ANALYSIS_WORKER_IMAGE ?? "";
  const binary = process.argv[2] ?? "";
  const database =
    process.env.RELEASE_DATABASE_URL ?? process.env.WORKER_DATABASE_URL ?? smoke.database;
  const { artifactSchemaVersion, validationContractId } = smoke.contract;
  const releaseCapability = smoke.capability("worker-release-smoke");
  const operation = ["--operation-key", "ci-release-control-plane"];
  const promote = ["release-promote", "--trigger", "algorithm-update", ...operation];
  const release = (args: string[]) => smoke.release(workerImage, database, args, binary);
  const cleanup = () =>
    smoke.sqlFile(
      "release-cleanup",
      {
        analysis_capability_id: smoke.capability("ci-analysis-worker"),
        release_worker_id: "worker-release-smoke",
        release_capability_id: releaseCapability,
      },
      true,
    );
  let fixturesOwned = false;
  let succeeded = false;
  await withCleanup(
    async () => {
      check(workerImage || binary, "A worker image or executable is required.");
      await smoke.isolated({ RELEASE_DATABASE_URL: database });
      fixturesOwned = true;
      await cleanup();
      await smoke.sqlFile("release-fixture", {
        artifact_schema_version: artifactSchemaVersion,
        algorithm_version: algorithmVersion,
        validation_contract_id: validationContractId,
        reader_schemas: JSON.stringify([artifactSchemaVersion]),
        reader_contracts: JSON.stringify([validationContractId]),
        release_capability_id: releaseCapability,
      });
      check(
        (await release(promote)).code !== 0,
        "Release promotion accepted a worker without a validation contract.",
      );
      await smoke.sql(
        `UPDATE series_analysis_worker_capabilities
      SET validation_contract_ids = '["unknown-validation-contract"]'::jsonb WHERE worker_id = :'worker';`,
        { worker: releaseCapability },
      );
      check(
        (await release(promote)).code !== 0,
        "Release promotion accepted a worker with an unknown validation contract.",
      );
      await smoke.sql(
        `UPDATE series_analysis_worker_capabilities
      SET validation_contract_ids = jsonb_build_array(:'contract') WHERE worker_id = :'worker';`,
        { contract: validationContractId, worker: releaseCapability },
      );

      for (const contracts of [[], ["unknown-validation-contract"]]) {
        await smoke.sql(
          `UPDATE series_analysis_reader_capabilities SET validation_contract_ids = :'contracts'::jsonb
        WHERE reader_id = 'reader-release-smoke';`,
          { contracts: JSON.stringify(contracts) },
        );
        check(
          (await release(promote)).code !== 0,
          "Release promotion accepted an incompatible reader validation contract.",
        );
      }
      await smoke.sql(`UPDATE series_analysis_reader_capabilities
      SET artifact_schema_versions = '[2,3]'::jsonb,
        validation_contract_ids = '["series-analysis-artifact-v2-full-validation-v1","series-analysis-artifact-v3-full-validation-v1"]'::jsonb
      WHERE reader_id = 'reader-release-smoke';`);
      check(
        (await release(["release-promote", "--trigger", "artifact-schema-update", ...operation]))
          .code !== 0,
        "Release promotion accepted a reader limited to legacy publication formats.",
      );
      await smoke.sql(
        `UPDATE series_analysis_reader_capabilities
      SET artifact_schema_versions = :'schemas'::jsonb, validation_contract_ids = :'contracts'::jsonb
      WHERE reader_id = 'reader-release-smoke';`,
        {
          schemas: JSON.stringify([artifactSchemaVersion]),
          contracts: JSON.stringify([validationContractId]),
        },
      );

      const dryRun = records(requireSuccess(await release(promote), "Release dry-run"));
      check(
        dryRun.some((value) => value.mode === "dry_run" && value.targetCount === 2),
        "Unexpected release dry-run report.",
      );
      const previewResult = await release([
        "release-reconcile",
        "--operation",
        "backfill",
        "--release-id",
        releaseId,
      ]);
      const preview = report(previewResult.stdout);
      // attention_required deliberately exits 1. Inspect both the report and exit
      // status so a dependency failure cannot masquerade as the generation guard.
      if (isDeepStrictEqual(preview.current, preview.target)) {
        check(
          previewResult.code === 0 &&
            preview.status === "planned" &&
            preview.action === "initial_backfill" &&
            preview.targetCount === 1,
          "Backfill preview did not match the current release generation.",
        );
      } else {
        check(
          previewResult.code === 1 &&
            preview.status === "attention_required" &&
            preview.reason === "promote_before_backfill",
          "Backfill preview did not reject promotion before backfill.",
        );
      }
      check(
        (await smoke.sql(`SELECT
      (SELECT COUNT(*) FROM series_analysis_operation_requests),
      (SELECT COUNT(*) FROM series_analysis_campaigns),
      (SELECT COUNT(*) FROM series_analysis_jobs),
      (SELECT COUNT(*) FROM series_analysis_queue_outbox);`)) === "0|0|0|0",
        "Release dry-run changed durable state.",
      );
      requireSuccess(await release([...promote, "--apply"]), "Release apply");
      const replay = records(
        requireSuccess(await release([...promote, "--apply"]), "Release replay"),
      );
      check(
        replay.some(
          (value) =>
            value.idempotentReplay === true &&
            value.compatibleReaderCount === 1 &&
            value.compatibleWorkerCount === 1,
        ),
        "Release replay was not idempotent with compatible readers and workers.",
      );
      check(
        (await smoke.sql(
          `SELECT
      (SELECT COUNT(*) FROM series_analysis_operation_requests),
      (SELECT COUNT(*) FROM series_analysis_campaigns),
      (SELECT COUNT(*) FROM series_analysis_campaign_targets),
      (SELECT COUNT(*) FROM series_analysis_job_requests),
      (SELECT COUNT(*) FROM series_analysis_jobs),
      (SELECT COUNT(*) FROM series_analysis_queue_outbox),
      (SELECT COUNT(*) FROM series_analysis_campaign_targets
        WHERE status = 'pending' AND job_request_id IS NULL
          AND algorithm_version = :'algorithm' AND artifact_schema_version = :schema
          AND validation_contract_id = :'contract'),
      (SELECT COUNT(*) FROM series_analysis_campaigns WHERE validation_contract_id = :'contract'),
      (SELECT COUNT(*) FROM series_analysis_campaign_targets WHERE validation_contract_id = :'contract'),
      (SELECT COUNT(*) FROM series_analysis_title_states
        WHERE game_title_id IN ('title-release-smoke-a', 'title-release-smoke-b') AND validation_contract_id = :'contract');`,
          {
            algorithm: algorithmVersion,
            schema: artifactSchemaVersion,
            contract: validationContractId,
          },
        )) === "1|1|2|0|0|0|2|1|2|2",
        "Release apply produced an unexpected control-plane shape.",
      );
      requireSuccess(await release(["release-audit"]), "Release audit");
      check(
        (await release(["release-audit", "--require-current", "--require-quiescent"])).code !== 0,
        "Strict audit accepted active backfill work.",
      );
      const progress = report(
        requireSuccess(
          await release([
            "release-reconcile",
            "--operation",
            "auto",
            "--release-id",
            releaseId,
            "--apply",
          ]),
          "Maintenance progress",
        ),
      );
      check(
        progress.status === "running" &&
          progress.targetCount === 2 &&
          progress.completedCount === 0,
        "Unexpected maintenance progress.",
      );
      // The following control-plane suite consumes this generation and campaign.
      // They belong to the disposable database, not a persistent environment.
      succeeded = true;
    },
    () =>
      cleanups([() => (fixturesOwned && !succeeded ? cleanup() : undefined), () => smoke.remove()]),
  );
});
