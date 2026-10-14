import {
  algorithmVersion,
  analysisEnvironment,
  check,
  cleanups,
  command,
  eventFields,
  releaseId,
  report,
  requireSuccess,
  runSmoke,
  safeDiagnostics,
  Smoke,
  startWorker,
  withCleanup,
} from "./worker-smoke-support.mts";

await runSmoke("Series-analysis control-plane smoke", async (signal) => {
  check(process.argv.length === 2, "Control-plane smoke accepts no arguments.");
  const smoke = new Smoke(signal);
  const worker_image = process.env.ANALYSIS_WORKER_IMAGE ?? "";
  const worker_database_url = process.env.WORKER_DATABASE_URL ?? smoke.database;
  const release_database_url = process.env.RELEASE_DATABASE_URL ?? smoke.database;
  const worker_container = `momo-analysis-control-smoke-worker-${process.pid}`;
  const analysis_worker_id = "ci-analysis-worker";
  const analysis_capability_id = smoke.capability(analysis_worker_id);
  const release_capability_id = smoke.capability("worker-release-smoke");
  const algorithm_version = algorithmVersion;
  const artifact_schema_version = smoke.contract.artifactSchemaVersion;
  const validation_contract_id = smoke.contract.validationContractId;
  let worker: ReturnType<typeof startWorker> | undefined;
  let ownsFixtures = false;
  const release = async (args: string[]) =>
    requireSuccess(
      await smoke.release(worker_image, release_database_url, args),
      "Release command",
    );
  const waitSQL = (expected: string, query: string, description: string) =>
    smoke.waitSQL(expected, query, description, {
      container: worker_container,
      rejectFailedJobs: true,
    });
  const makeReady = async (job: string) => {
    await smoke.sql(
      `UPDATE series_analysis_jobs SET available_at = clock_timestamp() WHERE id = '${job}'; SELECT pg_notify('processing_jobs', '');`,
    );
  };
  const pair = async (prefix: string) => {
    await smoke.sqlFile("control-plane-job-pair", { job_a: `${prefix}-a`, job_b: `${prefix}-b` });
  };
  await withCleanup(
    async () => {
      check(worker_image, "Worker image is required.");
      await smoke.isolated({
        WORKER_DATABASE_URL: worker_database_url,
        RELEASE_DATABASE_URL: release_database_url,
      });
      ownsFixtures = true;
      await smoke.sqlFile("control-plane-retention");
      worker = startWorker(smoke, worker_container, worker_image, {
        ...analysisEnvironment(worker_database_url, analysis_worker_id),
        MOMO_ANALYSIS_CONFIG_VERSION: "ci-control-plane-v1",
      });
      await worker.ready();
      await waitSQL(
        `1`,
        `
  SELECT COUNT(*)::int FROM series_analysis_worker_capabilities
  WHERE worker_id = '${analysis_capability_id}'
    AND algorithm_versions = jsonb_build_array('${algorithm_version}')
    AND artifact_schema_versions = jsonb_build_array(${artifact_schema_version})
    AND validation_contract_ids = jsonb_build_array('${validation_contract_id}')
    AND draining = false;
`,
        "worker capability registration",
      );
      await waitSQL(
        `0`,
        `
  SELECT COUNT(*)::int FROM series_analysis_jobs WHERE id = 'ci-analysis-expired-history';
`,
        "worker-owned terminal history retention",
      );
      await waitSQL(
        `2|0`,
        `
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded')::int,
    COUNT(*) FILTER (WHERE status IN ('queued','running','failed','timed_out'))::int
  FROM series_analysis_jobs;
`,
        "worker-owned campaign expansion and publication",
      );
      check(
        (await smoke.sql(`
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (
      WHERE campaign.validation_contract_id IS DISTINCT FROM '${validation_contract_id}'
         OR target.validation_contract_id IS DISTINCT FROM '${validation_contract_id}'
         OR request.validation_contract_id IS DISTINCT FROM target.validation_contract_id
         OR job.validation_contract_id IS DISTINCT FROM '${validation_contract_id}'
    )::int
  FROM series_analysis_campaign_targets target
  JOIN series_analysis_campaigns campaign ON campaign.id = target.campaign_id
  JOIN series_analysis_job_requests request ON request.id = target.job_request_id
  JOIN series_analysis_jobs job ON job.id = request.assigned_job_id;
`)) === "2|0",
        "Worker expansion lost the campaign contract.",
      );
      check(
        (await smoke.sql(`
  SELECT
    (SELECT COUNT(*) FROM series_analysis_title_states WHERE current_artifact_id IS NOT NULL),
    (SELECT COUNT(*) FROM series_analysis_artifacts WHERE status = 'published'),
    (SELECT COUNT(*) FROM series_analysis_scope_aggregate_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_scope_review_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_drilldown_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_match_context_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-a'),
    (SELECT COUNT(*) FROM series_analysis_scope_aggregate_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-b'),
    (SELECT COUNT(*) FROM series_analysis_scope_review_artifacts c JOIN series_analysis_artifacts a ON a.id = c.artifact_id WHERE a.game_title_id = 'title-release-smoke-b'),
    (SELECT COUNT(*) FROM series_analysis_artifacts
      WHERE status = 'published'
        AND validation_contract_id = '${validation_contract_id}');
`)) === "2|2|4|4|64|4|1|1|2",
        "Unexpected published artifact shape.",
      );
      const firstComplete = report(
        await release(["release-reconcile", "--operation", "auto", "--release-id", releaseId]),
      );
      check(
        firstComplete.status === "complete" &&
          firstComplete.targetCount === 2 &&
          firstComplete.completedCount === 2 &&
          firstComplete.failedCount === 0,
        "Unexpected maintenance completion.",
      );
      const first_job = await smoke.sql(
        `SELECT id FROM series_analysis_jobs ORDER BY requested_at, id LIMIT 1;`,
      );
      const attempts_before = await smoke.sql(
        `SELECT attempt_count FROM series_analysis_jobs WHERE id = '${first_job}';`,
      );
      await makeReady(first_job);
      await release([
        "release-promote",
        "--trigger",
        "algorithm-update",
        "--operation-key",
        "ci-release-reuse",
        "--apply",
      ]);
      await waitSQL(
        `4|0`,
        `
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded')::int,
    COUNT(*) FILTER (WHERE status <> 'succeeded')::int
  FROM series_analysis_jobs;
`,
        "checksum reuse jobs",
      );
      check(
        (await smoke.sql(`
  SELECT
    COUNT(*) FILTER (WHERE result_disposition = 'published'),
    COUNT(*) FILTER (WHERE result_disposition = 'reused'),
    (SELECT COUNT(*) FROM series_analysis_artifacts WHERE status = 'published')
  FROM series_analysis_jobs;
`)) === "2|2|2",
        "Unexpected publication/reuse dispositions.",
      );
      check(
        (await smoke.sql(
          `SELECT attempt_count FROM series_analysis_jobs WHERE id = '${first_job}';`,
        )) === attempts_before,
        "A wake for a terminal job changed its attempt count.",
      );
      await pair("ci-analysis-lease-recovery");
      const lease_job = await smoke.sql(`
  SELECT id FROM series_analysis_jobs
  WHERE game_title_id = 'title-release-smoke-a' AND status = 'queued';
`);
      await smoke.sql(`
  UPDATE worker_execution_slots
  SET task_kind = 'analysis', owner = 'ci-expired-worker', job_id = '${lease_job}',
      attempt_id = 'ci-expired-attempt', holder_preemptible = true,
      lease_expires_at = clock_timestamp() - interval '1 second',
      fencing_token = fencing_token + 1,
      preempt_requested_by = NULL, preempt_requested_at = NULL,
      updated_at = clock_timestamp()
  WHERE slot_key = 'shared-heavy-work';
  UPDATE series_analysis_jobs
  SET status = 'running', started_at = clock_timestamp() - interval '2 seconds',
      lease_owner = 'ci-expired-worker', lease_attempt_id = 'ci-expired-attempt',
      lease_fencing_token = (
        SELECT fencing_token FROM worker_execution_slots WHERE slot_key = 'shared-heavy-work'
      ),
      lease_expires_at = clock_timestamp() - interval '1 second',
      lease_validation_contract_id = validation_contract_id,
      attempt_count = 1, updated_at = clock_timestamp()
  WHERE id = '${lease_job}';
  INSERT INTO series_analysis_job_attempts (
    id, job_id, attempt_no, owner, fencing_token, input_revision,
    algorithm_version, artifact_schema_version, validation_contract_id, status,
    effective_config_version, calculation_timeout_milliseconds, started_at
  )
  SELECT
    'ci-expired-attempt', id, 1, 'ci-expired-worker', lease_fencing_token,
    input_revision, algorithm_version, artifact_schema_version, validation_contract_id, 'running',
    'ci-expired-config', 120000, clock_timestamp() - interval '2 seconds'
  FROM series_analysis_jobs WHERE id = '${lease_job}';
`);
      check(
        (await smoke.sql(`
  SELECT
    job.validation_contract_id,
    job.lease_validation_contract_id,
    attempt.validation_contract_id
  FROM series_analysis_jobs job
  JOIN series_analysis_job_attempts attempt ON attempt.id = job.lease_attempt_id
  WHERE job.id = '${lease_job}';
`)) === [validation_contract_id, validation_contract_id, validation_contract_id].join("|"),
        "Expired lease fixture lost validation contract provenance.",
      );
      await smoke.sql("SELECT pg_notify('processing_jobs', '');");
      await waitSQL(
        "succeeded",
        `SELECT status FROM series_analysis_jobs WHERE id = '${lease_job}';`,
        "expired running recovery without an eligible queued job",
      );
      const queued_peer = await smoke.sql(`
  SELECT id FROM series_analysis_jobs
  WHERE game_title_id = 'title-release-smoke-b' AND status = 'queued';
`);
      await makeReady(queued_peer);
      await waitSQL(
        `6|0`,
        `
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded')::int,
    COUNT(*) FILTER (WHERE status <> 'succeeded')::int
  FROM series_analysis_jobs;
`,
        "expired lease recovery jobs",
      );
      check(
        (await smoke.sql(`
  SELECT
    (SELECT COUNT(*) FROM series_analysis_job_attempts WHERE outcome = 'owner_lost'),
    (SELECT lease_recovery_count FROM series_analysis_jobs WHERE id = '${lease_job}'),
    (SELECT attempt_count FROM series_analysis_jobs WHERE id = '${lease_job}');
`)) === "1|1|2",
        "Expired lease recovery did not preserve the fencing state machine.",
      );
      await pair("ci-analysis-supersede");
      const stale_job = await smoke.sql(`
  SELECT id FROM series_analysis_jobs
  WHERE game_title_id = 'title-release-smoke-a' AND status = 'queued';
`);
      const peer_job = await smoke.sql(`
  SELECT id FROM series_analysis_jobs
  WHERE game_title_id = 'title-release-smoke-b' AND status = 'queued';
`);
      await smoke.sql(`
  UPDATE series_analysis_title_states
  SET input_revision = input_revision + 1, pending_work = true,
      updated_at = clock_timestamp()
  WHERE game_title_id = 'title-release-smoke-a';
`);
      await makeReady(stale_job);
      // The committed superseding job is discovered directly from the DB.
      await makeReady(peer_job);
      await waitSQL(
        `8|0`,
        `
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded')::int,
    COUNT(*) FILTER (WHERE status <> 'succeeded')::int
  FROM series_analysis_jobs;
`,
        "superseded revision jobs",
      );
      check(
        (await smoke.sql(`
  SELECT
    (SELECT COUNT(*) FROM series_analysis_job_attempts WHERE outcome = 'superseded'),
    (SELECT COUNT(*) FROM series_analysis_jobs WHERE result_disposition = 'published'),
    (SELECT COUNT(*) FROM series_analysis_jobs WHERE result_disposition = 'reused'),
    (SELECT COUNT(*) FROM series_analysis_artifacts WHERE status = 'published'),
    (SELECT a.input_revision FROM series_analysis_artifacts a JOIN series_analysis_title_states s ON s.current_artifact_id = a.id WHERE s.game_title_id = 'title-release-smoke-a');
`)) === "1|3|5|3|1",
        "Unexpected supersede/publication state.",
      );
      check(
        (await smoke.sql(`
  SELECT COUNT(*)::int
  FROM series_analysis_job_attempts attempt
  JOIN series_analysis_jobs job ON job.id = attempt.job_id
  WHERE attempt.validation_contract_id IS DISTINCT FROM job.validation_contract_id;
`)) === "0",
        "Attempt contracts diverged from their claimed jobs.",
      );
      check(
        (await smoke.sql(`
  SELECT
    COUNT(*) FILTER (WHERE outcome = 'succeeded'),
    COUNT(*) FILTER (
      WHERE outcome = 'succeeded'
        AND (
          elapsed_milliseconds IS NULL
          OR calculation_milliseconds IS NULL
          OR staging_milliseconds IS NULL
          OR publication_milliseconds IS NULL
          OR child_peak_bytes IS NULL
          OR worker_peak_bytes IS NULL
          OR elapsed_milliseconds < 0
          OR calculation_milliseconds < 0
          OR staging_milliseconds < 0
          OR publication_milliseconds < 0
          OR child_peak_bytes <= 0
          OR worker_peak_bytes <= 0
          OR elapsed_milliseconds
             <> calculation_milliseconds + staging_milliseconds + publication_milliseconds
        )
    )
  FROM series_analysis_job_attempts;
`)) === "8|0",
        "Attempt timing metrics were incomplete or inconsistent.",
      );
      const events = eventFields(smoke.logs());
      const child = events.find((event) => event.event === "analysis_child_report_accepted");
      check(child, "Worker did not record an accepted child report.");
      for (const field of [
        "worker_id",
        "job_id",
        "attempt_id",
        "game_title_id",
        "attempt_no",
        "input_revision",
        "algorithm_version",
        "artifact_schema_version",
        "fencing_token",
        "terminal_phase",
        "child_total_milliseconds",
        "input_milliseconds",
        "kernel_milliseconds",
        "encoding_milliseconds",
        "input_row_count",
        "artifact_chunk_count",
        "artifact_payload_bytes",
        "artifact_temporary_bytes",
        "child_self_peak_bytes",
      ])
        check(field in child, `Child diagnostic omitted ${field}.`);
      const terminal = events.find(
        (event) =>
          event.event === "analysis_attempt_finished" &&
          event.outcome === "succeeded" &&
          event.attempt_id === child.attempt_id,
      );
      check(
        terminal &&
          typeof child.artifact_payload_bytes === "number" &&
          typeof child.artifact_temporary_bytes === "number" &&
          child.artifact_payload_bytes >= 0 &&
          child.artifact_payload_bytes === terminal.artifact_encoded_bytes &&
          child.artifact_payload_bytes <= child.artifact_temporary_bytes,
        "Child and terminal byte metrics were inconsistent.",
      );
      check(
        !/(postgres|redis):\/\/[^" ]+/.test(smoke.logs()),
        "Worker logs exposed a database or Redis connection URL.",
      );
      const completed = report(
        await release(["release-reconcile", "--operation", "auto", "--release-id", releaseId]),
      );
      check(
        completed.status === "complete" &&
          completed.targetCount === 4 &&
          completed.completedCount === 4 &&
          completed.failedCount === 0,
        "Unexpected final maintenance completion.",
      );
      await release(["release-audit", "--require-current", "--require-quiescent"]);
      const unsupported_job_id = "ci-analysis-job-unsupported-version";
      await smoke.sql(`
  INSERT INTO series_analysis_jobs (
    id, game_title_id, input_revision, algorithm_version,
    artifact_schema_version, validation_contract_id,
    status, trigger, requested_at, available_at
  )
  SELECT
    '${unsupported_job_id}', game_title_id, input_revision, 'series-analysis-v999999',
    artifact_schema_version, validation_contract_id,
    'queued', 'algorithm_update', clock_timestamp(), clock_timestamp()
  FROM series_analysis_title_states
  WHERE game_title_id = 'title-release-smoke-a';
`);
      await makeReady(unsupported_job_id);
      // A later compatible candidate must progress past the unsupported oldest job.
      await smoke.sql(`
        INSERT INTO series_analysis_jobs (id, game_title_id, input_revision, algorithm_version,
          artifact_schema_version, validation_contract_id, status, trigger, requested_at, available_at)
        SELECT 'ci-analysis-compatible-later', game_title_id, input_revision, algorithm_version,
          artifact_schema_version, validation_contract_id, 'queued', 'manual', clock_timestamp(), clock_timestamp()
        FROM series_analysis_title_states WHERE game_title_id = 'title-release-smoke-b';
        SELECT pg_notify('processing_jobs', '');
      `);
      await waitSQL(
        "succeeded",
        "SELECT status FROM series_analysis_jobs WHERE id = 'ci-analysis-compatible-later';",
        "compatible job behind an unsupported job",
      );
      check(
        (await smoke.sql(`
  SELECT status, attempt_count, lease_owner IS NULL
  FROM series_analysis_jobs WHERE id = '${unsupported_job_id}';
`)) === "queued|0|t",
        "Unsupported-version job was claimed.",
      );
      check(
        requireSuccess(
          await command(
            "docker",
            [
              "exec",
              worker_container,
              "find",
              "/var/lib/momo-analysis",
              "-mindepth",
              "1",
              "-print",
              "-quit",
            ],
            { signal },
          ),
          "Temporary residue inspection",
        ) === "",
        "Worker left temporary attempt data behind.",
      );
      await worker.stop();
      check(
        (await smoke.sql(`
  SELECT draining FROM series_analysis_worker_capabilities
  WHERE worker_id = '${analysis_capability_id}';
`)) === "t",
        "Worker capability did not enter draining state.",
      );
    },
    async () => {
      for (const diagnostic of safeDiagnostics(smoke.logs()))
        console.error(JSON.stringify(diagnostic));
      await cleanups([
        () => worker?.stop(),
        () =>
          ownsFixtures
            ? smoke.sqlFile(
                "control-plane-cleanup",
                { analysis_worker_id, analysis_capability_id, release_capability_id },
                true,
              )
            : undefined,
        () => smoke.remove(),
      ]);
    },
  );
});
