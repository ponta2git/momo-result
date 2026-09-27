import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

export const screens = ["total_assets", "revenue", "incident_log"];

// Same releases as the former registry images; official release assets remain available.
// https://github.com/minio/minio/releases/tag/RELEASE.2025-09-07T16-13-09Z
// https://github.com/minio/mc/releases/tag/RELEASE.2025-08-13T08-35-41Z
const minioReleases = [
  {
    name: "minio",
    release: "RELEASE.2025-09-07T16-13-09Z",
    sha256: {
      amd64: "7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f",
      arm64: "5c83cd2cf151717ba0243f73e1c7802ff36e272b67144bdd7f1f7d684fd6f03d",
    },
  },
  {
    name: "mc",
    release: "RELEASE.2025-08-13T08-35-41Z",
    sha256: {
      amd64: "01f866e9c5f9b87c2b09116fa5d7c06695b106242d829a8bb32990c00312e891",
      arm64: "14c8c9616cfce4636add161304353244e8de383b2e2752c0e9dad01d4c27c12c",
    },
  },
];

export async function writeMinioImageContexts(directory, dockerArchitecture) {
  const architecture = { x86_64: "amd64", amd64: "amd64", aarch64: "arm64", arm64: "arm64" }[
    dockerArchitecture
  ];
  if (!architecture) throw new Error("Unsupported isolated MinIO Docker architecture.");
  const contexts = [];
  for (const { name, release, sha256 } of minioReleases) {
    let bytes;
    try {
      const response = await fetch(
        `https://github.com/minio/${name}/releases/download/${release}/${name}.linux-${architecture}.${release}`,
        { signal: AbortSignal.timeout(120_000) },
      );
      if (!response.ok) throw new Error("Download rejected.");
      bytes = Buffer.from(await response.arrayBuffer());
    } catch {
      throw new Error(`Owned E2E ${name} release download failed.`);
    }
    if (createHash("sha256").update(bytes).digest("hex") !== sha256[architecture])
      throw new Error(`Owned E2E ${name} release checksum mismatch.`);
    const context = join(directory, `${name}-image`);
    await mkdir(context);
    await writeFile(join(context, name), bytes, { flag: "wx", mode: 0o600 });
    // These static binaries only communicate over the isolated HTTP network; no shell or CA bundle.
    await writeFile(
      join(context, "Dockerfile"),
      `FROM scratch\nCOPY --chmod=0755 ${name} /usr/bin/${name}\nENTRYPOINT ["/usr/bin/${name}"]\n`,
      { flag: "wx", mode: 0o600 },
    );
    contexts.push({ name, context });
  }
  return contexts;
}

// Child-process errors can contain credentials in command/output/cause fields. Expose only
// fixed operation labels and bounded process metadata, never the original error object.
export function dockerFailure(operation, phase, error) {
  const code =
    Number.isInteger(error?.code) && error.code >= 0 && error.code <= 255
      ? error.code
      : ["ENOENT", "EACCES", "EPERM", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"].includes(error?.code)
        ? error.code
        : "unknown";
  const signal = ["SIGINT", "SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV"].includes(error?.signal)
    ? error.signal
    : error?.signal == null
      ? "none"
      : "unknown";
  return new Error(
    `Owned E2E Docker ${operation} failed (phase=${phase}, exit=${code}, signal=${signal}).`,
  );
}

// Full HD synthetic inputs exercise the real upload / checksum / image decoder boundary.
export async function writeImages(directory) {
  const images = {};
  for (const [index, screen] of screens.entries()) {
    const width = 1920;
    const height = 1080;
    const scanlines = Buffer.alloc(height * (width * 3 + 1), 80 + index * 40);
    for (let y = 0; y < height; y += 1) scanlines[y * (width * 3 + 1)] = 0;
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    const bytes = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(scanlines)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    const path = join(directory, `${screen}.png`);
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    images[screen] = {
      path,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  return images;
}

function chunk(type, body) {
  const content = Buffer.concat([Buffer.from(type), body]);
  const result = Buffer.alloc(content.length + 8);
  result.writeUInt32BE(body.length, 0);
  content.copy(result, 4);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

export function workerTiming() {
  return {
    MOMO_OCR_V2_R2_OPERATION_TIMEOUT_MS: "10000",
    MOMO_OCR_V2_R2_ATTEMPT_TIMEOUT_MS: "5000",
    MOMO_OCR_V2_R2_MAXIMUM_ATTEMPTS: "1",
    OCR_REDIS_V2_STREAM: "momo:ocr:v2:jobs",
    MOMO_OCR_V2_REDIS_GROUP: "mom24-e2e",
    OCR_REDIS_V2_DEAD_LETTER_STREAM: "momo:ocr:v2:jobs:dead",
    MOMO_OCR_V2_WORKER_ID: "mom24-e2e-worker",
    MOMO_OCR_V2_LEASE_DURATION_MS: "60000",
    MOMO_OCR_V2_HEARTBEAT_INTERVAL_MS: "5000",
    MOMO_OCR_V2_FINALIZATION_TIMEOUT_MS: "5000",
    MOMO_OCR_V2_RETRY_DELAY_MS: "1000",
    MOMO_OCR_V2_REDIS_BLOCK_MS: "1000",
    MOMO_OCR_V2_PEL_RECOVERY_INTERVAL_MS: "300000",
    MOMO_OCR_V2_CLAIM_IDLE_MS: "386000",
    MOMO_OCR_V2_TIMEOUT_MS: "300000",
    MOMO_OCR_V2_MAXIMUM_DELIVERY_ATTEMPTS: "2",
    MOMO_OCR_V2_PENDING_SCAN_COUNT: "10",
  };
}
