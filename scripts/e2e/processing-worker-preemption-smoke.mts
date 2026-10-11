import { join } from "node:path";
import {
  algorithmVersion,
  analysisEnvironment,
  check,
  cleanups,
  command,
  eventFields,
  requireSuccess,
  runSmoke,
  safeDiagnostics,
  Smoke,
  startCommand,
  startWorker,
  waitFor,
  withCleanup,
} from "./worker-smoke-support.mts";

await runSmoke("Combined analysis/OCR preemption smoke", async (signal) => {
  check(process.argv.length === 3, "A processing worker image argument is required.");
  const image = process.argv[2]!;
  const smoke = new Smoke(signal);
  const worker_database = process.env.WORKER_DATABASE_URL ?? "";
  const worker_redis = process.env.WORKER_REDIS_URL ?? "";
  const worker_container = `momo-analysis-preemption-smoke-worker-${process.pid}`;
  const lockContainer = `${worker_container}-lock`;
  const analysis_stream = "momo:analysis:preemption-smoke";
  const analysis_group = "momo-analysis-preemption-smoke";
  const ocr_stream = "momo:ocr:v2:preemption-smoke";
  const ocr_group = "momo-ocr-v2-preemption-smoke";
  const ocr_dead_stream = "momo:ocr:v2:preemption-smoke:dead";
  const analysis_job = "ci-preemption-analysis-job";
  const ocr_job = "ci-preemption-ocr-job";
  const title_id = "ci-preemption-title";
  const analysis_worker_id = "ci-preemption-analysis-worker";
  const analysis_capability_id = smoke.capability(analysis_worker_id);
  const algorithm_version = algorithmVersion;
  const artifact_schema_version = smoke.contract.artifactSchemaVersion;
  const validation_contract_id = smoke.contract.validationContractId;
  let ownsFixtures = false;
  let worker: ReturnType<typeof startWorker> | undefined;
  let lock: ReturnType<typeof startCommand> | undefined;
  const cleanupDB = () =>
    smoke.sqlFile("preemption-cleanup", { analysis_worker_id, analysis_capability_id }, true);
  const waitSQL = (expected: string, query: string, description: string, timeoutMs = 60_000) =>
    smoke.waitSQL(expected, query, description, {
      timeoutMs,
      intervalMs: 100,
      ...(worker ? { container: worker_container } : {}),
    });
  const waitEvent = (field: string, value: string, description: string) =>
    waitFor(
      description,
      async (probeSignal) => {
        if (eventFields(smoke.logs()).some((event) => event[field] === value)) return true;
        await smoke.running(worker_container, probeSignal);
        return false;
      },
      { timeoutMs: 20_000, intervalMs: 100, signal },
    );
  const releaseLock = async () => {
    if (!lock) return;
    const current = lock;
    lock = undefined;
    await cleanups([
      () => command("docker", ["rm", "--force", lockContainer]),
      async () => {
        // Removing the lock container terminates the attached CLI. Join it
        // before sending signals to a process group which may already be gone.
        const timer = setTimeout(current.stop, 5_000);
        try {
          await current.done.catch(() => {});
        } finally {
          clearTimeout(timer);
        }
      },
      () =>
        smoke.sql(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'ci-preemption-lock' AND pid <> pg_backend_pid();",
          {},
          null,
        ),
    ]);
  };
  await withCleanup(
    async () => {
      check(
        worker_database && worker_redis && smoke.redisURL,
        "Worker database and Redis URLs are required.",
      );
      await smoke.isolated(
        { WORKER_DATABASE_URL: worker_database },
        { WORKER_REDIS_URL: worker_redis },
      );
      ownsFixtures = true;
      await cleanupDB();
      await smoke.redis(["DEL", analysis_stream, ocr_stream, ocr_dead_stream]);
      check(
        (await smoke.sql(
          "SELECT COALESCE(owner, '') FROM worker_execution_slots WHERE slot_key = 'shared-heavy-work';",
        )) === "",
        "Shared heavy-work slot is owned by another runtime.",
      );
      await smoke.sqlFile("preemption-fixture", {
        algorithm_version,
        artifact_schema_version,
        validation_contract_id,
      });
      const lockArgs = smoke.sqlArgs();
      lockArgs.splice(1, 0, "--name", lockContainer);
      lock = startCommand("docker", lockArgs, {
        input:
          "SET application_name = 'ci-preemption-lock'; BEGIN; LOCK TABLE matches IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(120);",
        log: join(smoke.root, "lock.log"),
      });
      await waitSQL(
        `1`,
        `
  SELECT COUNT(*)::int
  FROM pg_locks lock
  JOIN pg_stat_activity activity ON activity.pid = lock.pid
  WHERE activity.application_name = 'ci-preemption-lock'
    AND lock.relation = 'matches'::regclass
    AND lock.mode = 'AccessExclusiveLock'
    AND lock.granted;
`,
        `the deterministic analysis input lock`,
      );
      worker = startWorker(smoke, worker_container, image, {
        ...analysisEnvironment(
          worker_database,
          worker_redis,
          analysis_stream,
          analysis_group,
          analysis_worker_id,
        ),
        MOMO_ANALYSIS_CALCULATION_TIMEOUT_MS: "30000",
        MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS: "45000",
        MOMO_ANALYSIS_CONFIG_VERSION: "ci-preemption-v1",
        MOMO_OCR_V2_CONSUMER_MODE: "enabled",
        OCR_REDIS_V2_STREAM: ocr_stream,
        MOMO_OCR_V2_REDIS_GROUP: ocr_group,
        OCR_REDIS_V2_DEAD_LETTER_STREAM: ocr_dead_stream,
        MOMO_OCR_V2_WORKER_ID: "ci-preemption-ocr-worker",
        SOURCE_IMAGE_R2_ENDPOINT: "http://127.0.0.1:9",
        SOURCE_IMAGE_R2_BUCKET: "ci-preemption",
        SOURCE_IMAGE_R2_ACCESS_KEY_ID: "ci-access-key",
        SOURCE_IMAGE_R2_SECRET_ACCESS_KEY: "ci-secret-key",
        MOMO_OCR_V2_R2_OPERATION_TIMEOUT_MS: "1000",
        MOMO_OCR_V2_R2_ATTEMPT_TIMEOUT_MS: "500",
        MOMO_OCR_V2_R2_MAXIMUM_ATTEMPTS: "1",
        MOMO_OCR_V2_LEASE_DURATION_MS: "5000",
        MOMO_OCR_V2_HEARTBEAT_INTERVAL_MS: "200",
        MOMO_OCR_V2_FINALIZATION_TIMEOUT_MS: "1000",
        MOMO_OCR_V2_RETRY_DELAY_MS: "60000",
        MOMO_OCR_V2_REDIS_BLOCK_MS: "10000",
        MOMO_OCR_V2_PEL_RECOVERY_INTERVAL_MS: "300000",
        MOMO_OCR_V2_CLAIM_IDLE_MS: "15000",
        MOMO_OCR_V2_TIMEOUT_MS: "5000",
        MOMO_OCR_V2_MAXIMUM_DELIVERY_ATTEMPTS: "2",
        MOMO_OCR_V2_PENDING_SCAN_COUNT: "10",
      });
      await worker.ready();
      await waitEvent("event", "analysis_worker_ready", "analysis readiness");
      await waitEvent("event", "ocr_rust_v2_worker_ready", "OCR readiness");
      await waitSQL(
        `1`,
        `
  SELECT COUNT(*)::int
  FROM series_analysis_worker_capabilities
  WHERE worker_id = '${analysis_capability_id}'
    AND algorithm_versions = jsonb_build_array('${algorithm_version}')
    AND artifact_schema_versions = jsonb_build_array(${artifact_schema_version})
    AND validation_contract_ids = jsonb_build_array('${validation_contract_id}')
    AND draining = false;
`,
        `the scoped analysis capability registration`,
      );
      await smoke.redis([
        "XADD",
        analysis_stream,
        "*",
        "schemaVersion",
        "1",
        "jobId",
        analysis_job,
      ]);
      await waitSQL(
        `analysis|${analysis_worker_id}|true`,
        `
  SELECT slot.task_kind || '|' || slot.owner || '|' || (
    job.validation_contract_id = '${validation_contract_id}'
    AND job.lease_validation_contract_id = '${validation_contract_id}'
    AND EXISTS (
      SELECT 1
      FROM series_analysis_job_attempts attempt
      WHERE attempt.id = job.lease_attempt_id
        AND attempt.validation_contract_id = '${validation_contract_id}'
    )
  )::text
  FROM worker_execution_slots slot
  JOIN series_analysis_jobs job ON job.id = slot.job_id
  WHERE slot.slot_key = 'shared-heavy-work';
`,
        `the running analysis holder`,
      );
      const childResult = await command(
        "docker",
        [
          "exec",
          "--user",
          "10001:10001",
          worker_container,
          "pgrep",
          "-f",
          "^/usr/local/bin/momo-processing-worker child-compute ",
        ],
        { signal },
      );
      const child = requireSuccess(childResult, "Analysis child inspection").split("\n")[0]!;
      check(/^[0-9]+$/.test(child), "The analysis child was not running behind the input lock.");
      // Observe committed renewals while the real child is still blocked, rather than
      // allowing a short child which exits before its first heartbeat to satisfy this.
      for (const renewal of [1, 2]) {
        const previous_lease = await smoke.sql(
          `SELECT lease_expires_at FROM series_analysis_jobs WHERE id = '${analysis_job}';`,
        );
        await waitSQL(
          `true`,
          `
    SELECT (lease_expires_at > TIMESTAMPTZ '${previous_lease}')::text
    FROM series_analysis_jobs WHERE id = '${analysis_job}' AND status = 'running';
  `,
          `committed analysis renewal ${renewal} with the child alive`,
        );
      }
      await smoke.redis([
        "XADD",
        ocr_stream,
        "*",
        "schemaVersion",
        "2",
        "jobId",
        ocr_job,
        "draftId",
        "ci-preemption-draft",
        "sourceImageId",
        "ci-preemption-source-image",
        "imageObjectKey",
        "source-images/ci-preemption-source.png",
        "sha256",
        "ab".repeat(32),
        "byteLength",
        "68",
        "mediaType",
        "image/png",
        "requestedScreenType",
        "total_assets",
        "attempt",
        "1",
        "enqueuedAt",
        "2026-08-12T00:00:00Z",
      ]);
      await waitSQL(
        `true|0|true|1`,
        `
  SELECT (job.status IN ('queued', 'running'))::text || '|' ||
         job.transient_retry_count || '|' || (job.safe_failure_code IS NULL)::text || '|' ||
         COUNT(*) FILTER (WHERE attempt.outcome = 'preempted')::text
  FROM series_analysis_jobs job
  JOIN series_analysis_job_attempts attempt ON attempt.job_id = job.id
  WHERE job.id = 'ci-preemption-analysis-job'
  GROUP BY job.status, job.transient_retry_count, job.safe_failure_code;
`,
        `analysis preemption without failure accounting`,
      );
      await waitEvent("reason", "preempted", "the analysis preemption requeue event");
      await waitSQL(
        `queued|1|true`,
        `
  SELECT status || '|' || attempt_count || '|' || (failure_code IS NULL)::text
  FROM ocr_jobs WHERE id = 'ci-preemption-ocr-job';
`,
        `the transient R2 failure requeue`,
      );
      await waitSQL(
        `true`,
        `
  SELECT (owner IS DISTINCT FROM 'ci-preemption-ocr-worker'
          AND preempt_requested_by IS NULL)::text
  FROM worker_execution_slots WHERE slot_key = 'shared-heavy-work';
`,
        `the released OCR execution slot`,
      );
      // A replacement may already run; inspect the interrupted child's exact PID.
      check(
        (
          await command(
            "docker",
            [
              "exec",
              "--user",
              "10001:10001",
              worker_container,
              "sh",
              "-c",
              'kill -0 "$1"',
              "--",
              child,
            ],
            { signal },
          )
        ).code !== 0,
        "The preempted analysis process group was not reaped.",
      );
      await releaseLock();
      // Include the real Redis idle threshold and bounded processing time.
      await waitSQL(
        `succeeded|2|1|1`,
        `
  SELECT job.status || '|' || job.attempt_count || '|' ||
         COUNT(*) FILTER (WHERE attempt.outcome = 'preempted')::text || '|' ||
         COUNT(*) FILTER (WHERE attempt.outcome = 'succeeded')::text
  FROM series_analysis_jobs job
  JOIN series_analysis_job_attempts attempt ON attempt.job_id = job.id
  WHERE job.id = 'ci-preemption-analysis-job'
  GROUP BY job.status, job.attempt_count;
`,
        `same-cgroup analysis recovery after preemption`,
        100000,
      );
      check(
        (await smoke.sql(`
  SELECT
    COUNT(*) FILTER (
      WHERE attempt.validation_contract_id IS DISTINCT FROM job.validation_contract_id
    )::int,
    (SELECT COUNT(*)::int
     FROM series_analysis_artifacts artifact
     WHERE artifact.game_title_id = '${title_id}'
       AND artifact.status = 'published'
       AND artifact.validation_contract_id = '${validation_contract_id}')
  FROM series_analysis_job_attempts attempt
  JOIN series_analysis_jobs job ON job.id = attempt.job_id
  WHERE job.id = '${analysis_job}';
`)) === "0|1",
        "Preemption recovery lost validation contract provenance.",
      );
      await smoke.running(worker_container);
      check(
        !/(postgres|redis):\/\/[^" ]+/.test(smoke.logs()),
        "Worker logs exposed a database or Redis connection URL.",
      );
    },
    async () => {
      for (const diagnostic of safeDiagnostics(smoke.logs()))
        console.error(JSON.stringify(diagnostic));
      await cleanups([
        releaseLock,
        () => worker?.stop(),
        () =>
          ownsFixtures
            ? smoke.redis(["DEL", analysis_stream, ocr_stream, ocr_dead_stream], null)
            : undefined,
        () => (ownsFixtures ? cleanupDB() : undefined),
        () => smoke.remove(),
      ]);
    },
  );
});
