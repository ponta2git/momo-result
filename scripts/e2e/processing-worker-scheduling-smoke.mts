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

await runSmoke("Combined analysis/OCR scheduling smoke", async (signal) => {
  check(process.argv.length === 3, "A processing worker image argument is required.");
  const image = process.argv[2]!;
  const smoke = new Smoke(signal);
  const worker_database = process.env.WORKER_DATABASE_URL ?? "";
  const worker_container = `momo-analysis-scheduling-smoke-worker-${process.pid}`;
  const lockContainer = `${worker_container}-lock`;
  const analysis_job = "ci-scheduling-analysis-job";
  const ocr_job = "ci-scheduling-ocr-job";
  const waiting_job = "ci-scheduling-waiting-analysis-job";
  const title_id = "ci-scheduling-title";
  const analysis_worker_id = "ci-scheduling-analysis-worker";
  const analysis_capability_id = smoke.capability(analysis_worker_id);
  const algorithm_version = algorithmVersion;
  const artifact_schema_version = smoke.contract.artifactSchemaVersion;
  const validation_contract_id = smoke.contract.validationContractId;
  let ownsFixtures = false;
  let worker: ReturnType<typeof startWorker> | undefined;
  let lock: ReturnType<typeof startCommand> | undefined;
  const cleanupDB = () =>
    smoke.sqlFile("scheduling-cleanup", { analysis_worker_id, analysis_capability_id }, true);
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
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'ci-scheduling-lock' AND pid <> pg_backend_pid();",
          {},
          null,
        ),
    ]);
  };
  await withCleanup(
    async () => {
      check(worker_database, "Worker database URL is required.");
      await smoke.isolated({ WORKER_DATABASE_URL: worker_database });
      ownsFixtures = true;
      await cleanupDB();
      check(
        (await smoke.sql(
          "SELECT ((SELECT count(*) FROM series_analysis_jobs WHERE status='running') + (SELECT count(*) FROM ocr_jobs WHERE status='running'))::text;",
        )) === "0",
        "The isolated fixture contains another running job.",
      );
      await smoke.sqlFile("scheduling-fixture", {
        algorithm_version,
        artifact_schema_version,
        validation_contract_id,
      });
      const lockArgs = smoke.sqlArgs();
      lockArgs.splice(1, 0, "--name", lockContainer);
      lock = startCommand("docker", lockArgs, {
        input:
          "SET application_name = 'ci-scheduling-lock'; BEGIN; LOCK TABLE matches IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(120);",
        log: join(smoke.root, "lock.log"),
      });
      await waitSQL(
        `1`,
        `
  SELECT COUNT(*)::int
  FROM pg_locks lock
  JOIN pg_stat_activity activity ON activity.pid = lock.pid
  WHERE activity.application_name = 'ci-scheduling-lock'
    AND lock.relation = 'matches'::regclass
    AND lock.mode = 'AccessExclusiveLock'
    AND lock.granted;
`,
        `the deterministic analysis input lock`,
      );
      worker = startWorker(smoke, worker_container, image, {
        ...analysisEnvironment(worker_database, analysis_worker_id),
        MOMO_ANALYSIS_CALCULATION_TIMEOUT_MS: "30000",
        MOMO_ANALYSIS_FINALIZATION_TIMEOUT_MS: "45000",
        MOMO_ANALYSIS_CONFIG_VERSION: "ci-scheduling-v1",
        MOMO_OCR_V2_CONSUMER_MODE: "enabled",
        MOMO_OCR_V2_WORKER_ID: "ci-scheduling-ocr-worker",
        SOURCE_IMAGE_R2_ENDPOINT: "http://127.0.0.1:9",
        SOURCE_IMAGE_R2_BUCKET: "ci-scheduling",
        SOURCE_IMAGE_R2_ACCESS_KEY_ID: "ci-access-key",
        SOURCE_IMAGE_R2_SECRET_ACCESS_KEY: "ci-secret-key",
        MOMO_OCR_V2_R2_OPERATION_TIMEOUT_MS: "1000",
        MOMO_OCR_V2_R2_ATTEMPT_TIMEOUT_MS: "500",
        MOMO_OCR_V2_R2_MAXIMUM_ATTEMPTS: "1",
        MOMO_OCR_V2_LEASE_DURATION_MS: "5000",
        MOMO_OCR_V2_HEARTBEAT_INTERVAL_MS: "200",
        MOMO_OCR_V2_FINALIZATION_TIMEOUT_MS: "1000",
        MOMO_OCR_V2_RETRY_DELAY_MS: "60000",
        MOMO_OCR_V2_TIMEOUT_MS: "5000",
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
      await smoke.sql("SELECT pg_notify('processing_jobs', '');");
      await waitSQL(
        `analysis|${analysis_worker_id}|true`,
        `
  SELECT 'analysis|' || job.lease_owner || '|' || (
    job.validation_contract_id = '${validation_contract_id}'
    AND job.lease_validation_contract_id = '${validation_contract_id}'
    AND EXISTS (
      SELECT 1
      FROM series_analysis_job_attempts attempt
      WHERE attempt.id = job.lease_attempt_id
        AND attempt.validation_contract_id = '${validation_contract_id}'
    )
  )::text
  FROM series_analysis_jobs job
  WHERE job.id = '${analysis_job}' AND job.status = 'running';
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
      await smoke.sql(
        `UPDATE ocr_jobs SET available_at = clock_timestamp() WHERE id = '${ocr_job}';
         UPDATE series_analysis_jobs SET available_at = clock_timestamp() WHERE id = '${waiting_job}';
         SELECT pg_notify('processing_jobs', '');`,
      );
      // Both kinds are now due. Observe real renewals without allowing the queued
      // OCR request to interrupt this child or claim the next analysis attempt.
      for (const renewal of [1, 2]) {
        const previous_lease = await smoke.sql(
          `SELECT lease_expires_at FROM series_analysis_jobs WHERE id = '${analysis_job}';`,
        );
        await waitSQL(
          `true`,
          `SELECT (lease_expires_at > TIMESTAMPTZ '${previous_lease}')::text
           FROM series_analysis_jobs WHERE id = '${analysis_job}' AND status = 'running';`,
          `analysis renewal ${renewal} while OCR waits`,
        );
        check(
          (await smoke.sql(`
  SELECT analysis.status || '|' || analysis.attempt_count || '|' ||
         ocr.status || '|' || ocr.attempt_count || '|' ||
         waiting.status || '|' || waiting.attempt_count || '|' ||
         (analysis.fencing_counter = analysis.lease_fencing_token)::text
  FROM series_analysis_jobs analysis, ocr_jobs ocr, series_analysis_jobs waiting
  WHERE analysis.id = '${analysis_job}' AND ocr.id = '${ocr_job}'
    AND waiting.id = '${waiting_job}';
`)) === "running|1|queued|0|queued|0|true",
          "Queued work interrupted the active analysis or bypassed its resource reservation.",
        );
        requireSuccess(
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
          ),
          "The original analysis child must remain alive while OCR waits",
        );
      }
      await releaseLock();
      await waitSQL(
        `succeeded|1|0|1`,
        `
  SELECT job.status || '|' || job.attempt_count || '|' ||
         COUNT(*) FILTER (WHERE attempt.outcome = 'preempted')::text || '|' ||
         COUNT(*) FILTER (WHERE attempt.outcome = 'succeeded')::text
  FROM series_analysis_jobs job
  JOIN series_analysis_job_attempts attempt ON attempt.job_id = job.id
  WHERE job.id = '${analysis_job}'
  GROUP BY job.status, job.attempt_count;
`,
        `the original analysis completes without a discarded attempt`,
        100000,
      );
      await waitSQL(
        `queued|1|true`,
        `SELECT status || '|' || attempt_count || '|' || (failure_code IS NULL)::text
         FROM ocr_jobs WHERE id = '${ocr_job}';`,
        `the next OCR attempt reaches its transient R2 requeue`,
      );
      await waitSQL(
        `succeeded|1`,
        `SELECT status || '|' || attempt_count FROM series_analysis_jobs WHERE id = '${waiting_job}';`,
        `analysis resumes after the queued OCR attempt`,
        100000,
      );
      check(
        (await smoke.sql(`
  SELECT (first_attempt.finished_at <= ocr.updated_at
          AND ocr.updated_at <= next_attempt.started_at)::text
  FROM series_analysis_job_attempts first_attempt, ocr_jobs ocr,
       series_analysis_job_attempts next_attempt
  WHERE first_attempt.job_id = '${analysis_job}' AND ocr.id = '${ocr_job}'
    AND next_attempt.job_id = '${waiting_job}';
`)) === "true",
        "Queued OCR did not run between the completed analysis and the next analysis attempt.",
      );
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
        "The completed analysis process group was not reaped.",
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
        "Analysis completion lost validation contract provenance.",
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
        () => (ownsFixtures ? cleanupDB() : undefined),
        () => smoke.remove(),
      ]);
    },
  );
});
