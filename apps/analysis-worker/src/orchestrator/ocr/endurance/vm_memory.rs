#[cfg(target_os = "linux")]
use std::{path::Path, time::Duration};

use serde::Serialize;
#[cfg(target_os = "linux")]
use tokio::{
    sync::oneshot,
    task::JoinHandle,
    time::{self, MissedTickBehavior},
};

#[cfg(any(target_os = "linux", test))]
use super::{BASIS_POINTS, OcrEnduranceError};

#[cfg(target_os = "linux")]
const MEMINFO_PATH: &str = "/proc/meminfo";
#[cfg(any(target_os = "linux", test))]
const MAXIMUM_MEMINFO_BYTES: usize = 64 * 1024;
#[cfg(target_os = "linux")]
const SAMPLE_INTERVAL: Duration = Duration::from_millis(10);
#[cfg(any(target_os = "linux", test))]
const MINIMUM_CONFIGURED_CAPACITY_BASIS_POINTS: u128 = 8_500;
#[cfg(any(target_os = "linux", test))]
const MAXIMUM_CONFIGURED_CAPACITY_BASIS_POINTS: u128 = 10_500;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VmMemoryEvidence {
    configured_capacity_bytes: u64,
    total_bytes: u64,
    baseline_used_bytes: u64,
    final_used_bytes: u64,
    peak_used_bytes: u64,
    peak_basis_points: u64,
    sample_count: u64,
    sample_interval_milliseconds: u64,
}

#[cfg(target_os = "linux")]
impl VmMemoryEvidence {
    pub(super) fn within_peak_threshold(self, maximum_basis_points: u16) -> bool {
        u128::from(self.peak_used_bytes).saturating_mul(BASIS_POINTS)
            <= u128::from(self.total_bytes).saturating_mul(u128::from(maximum_basis_points))
    }
}

#[cfg(any(target_os = "linux", test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct VmMemorySnapshot {
    total_bytes: u64,
    available_bytes: u64,
}

#[cfg(target_os = "linux")]
impl VmMemorySnapshot {
    fn used_bytes(self) -> Result<u64, OcrEnduranceError> {
        self.total_bytes
            .checked_sub(self.available_bytes)
            .ok_or(OcrEnduranceError::RuntimeMemory)
    }
}

#[cfg(target_os = "linux")]
pub(super) struct VmMemorySampler {
    stop: Option<oneshot::Sender<()>>,
    task: Option<JoinHandle<Result<VmMemoryEvidence, OcrEnduranceError>>>,
}

#[cfg(target_os = "linux")]
impl VmMemorySampler {
    pub(super) async fn start(configured_capacity_bytes: u64) -> Result<Self, OcrEnduranceError> {
        let baseline = read_snapshot().await?;
        if !capacity_matches(configured_capacity_bytes, baseline.total_bytes) {
            return Err(OcrEnduranceError::RuntimeMemory);
        }
        let baseline_used_bytes = baseline.used_bytes()?;
        let (stop, mut stopped) = oneshot::channel();
        let task = tokio::spawn(async move {
            let mut peak_used_bytes = baseline_used_bytes;
            let mut sample_count = 1_u64;
            let mut interval = time::interval(SAMPLE_INTERVAL);
            interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
            interval.tick().await;

            let final_used_bytes = loop {
                tokio::select! {
                    biased;
                    _ = &mut stopped => {
                        let snapshot = read_snapshot().await?;
                        if snapshot.total_bytes != baseline.total_bytes {
                            return Err(OcrEnduranceError::RuntimeMemory);
                        }
                        let final_used_bytes = snapshot.used_bytes()?;
                        peak_used_bytes = peak_used_bytes.max(final_used_bytes);
                        sample_count = sample_count.saturating_add(1);
                        break final_used_bytes;
                    }
                    _ = interval.tick() => {
                        let snapshot = read_snapshot().await?;
                        if snapshot.total_bytes != baseline.total_bytes {
                            return Err(OcrEnduranceError::RuntimeMemory);
                        }
                        let used_bytes = snapshot.used_bytes()?;
                        peak_used_bytes = peak_used_bytes.max(used_bytes);
                        sample_count = sample_count.saturating_add(1);
                    }
                }
            };

            let peak_basis_points = u64::try_from(
                u128::from(peak_used_bytes).saturating_mul(BASIS_POINTS)
                    / u128::from(baseline.total_bytes),
            )
            .map_err(|_error| OcrEnduranceError::RuntimeMemory)?;
            Ok(VmMemoryEvidence {
                configured_capacity_bytes,
                total_bytes: baseline.total_bytes,
                baseline_used_bytes,
                final_used_bytes,
                peak_used_bytes,
                peak_basis_points,
                sample_count,
                sample_interval_milliseconds: u64::try_from(SAMPLE_INTERVAL.as_millis())
                    .map_err(|_error| OcrEnduranceError::RuntimeMemory)?,
            })
        });
        Ok(Self {
            stop: Some(stop),
            task: Some(task),
        })
    }

    pub(super) async fn finish(mut self) -> Result<VmMemoryEvidence, OcrEnduranceError> {
        let stop = self.stop.take().ok_or(OcrEnduranceError::RuntimeMemory)?;
        stop.send(())
            .map_err(|_error| OcrEnduranceError::RuntimeMemory)?;
        let task = self.task.take().ok_or(OcrEnduranceError::RuntimeMemory)?;
        task.await
            .map_err(|_error| OcrEnduranceError::RuntimeMemory)?
    }
}

#[cfg(target_os = "linux")]
impl Drop for VmMemorySampler {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

#[cfg(target_os = "linux")]
async fn read_snapshot() -> Result<VmMemorySnapshot, OcrEnduranceError> {
    let bytes = tokio::fs::read(Path::new(MEMINFO_PATH))
        .await
        .map_err(|_error| OcrEnduranceError::RuntimeMemory)?;
    decode_meminfo(&bytes)
}

#[cfg(any(target_os = "linux", test))]
fn decode_meminfo(bytes: &[u8]) -> Result<VmMemorySnapshot, OcrEnduranceError> {
    if bytes.is_empty() || bytes.len() > MAXIMUM_MEMINFO_BYTES {
        return Err(OcrEnduranceError::RuntimeMemory);
    }
    let text = std::str::from_utf8(bytes).map_err(|_error| OcrEnduranceError::RuntimeMemory)?;
    let mut total_kibibytes = None;
    let mut available_kibibytes = None;
    for line in text.lines() {
        let mut fields = line.split_ascii_whitespace();
        let Some(name) = fields.next() else {
            continue;
        };
        if !matches!(name, "MemTotal:" | "MemAvailable:") {
            continue;
        }
        let value = fields
            .next()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or(OcrEnduranceError::RuntimeMemory)?;
        if fields.next() != Some("kB") || fields.next().is_some() {
            return Err(OcrEnduranceError::RuntimeMemory);
        }
        match name {
            "MemTotal:" => total_kibibytes = Some(value),
            "MemAvailable:" => available_kibibytes = Some(value),
            _ => {}
        }
    }
    let total_bytes = total_kibibytes
        .filter(|value| *value > 0)
        .and_then(|value| value.checked_mul(1_024))
        .ok_or(OcrEnduranceError::RuntimeMemory)?;
    let available_bytes = available_kibibytes
        .and_then(|value| value.checked_mul(1_024))
        .filter(|value| *value <= total_bytes)
        .ok_or(OcrEnduranceError::RuntimeMemory)?;
    Ok(VmMemorySnapshot {
        total_bytes,
        available_bytes,
    })
}

#[cfg(any(target_os = "linux", test))]
fn capacity_matches(configured_capacity_bytes: u64, total_bytes: u64) -> bool {
    if configured_capacity_bytes == 0 || total_bytes == 0 {
        return false;
    }
    let actual_basis_points = u128::from(total_bytes).saturating_mul(BASIS_POINTS)
        / u128::from(configured_capacity_bytes);
    (MINIMUM_CONFIGURED_CAPACITY_BASIS_POINTS..=MAXIMUM_CONFIGURED_CAPACITY_BASIS_POINTS)
        .contains(&actual_basis_points)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meminfo_parser_requires_total_available_and_kibibyte_units() {
        let snapshot = decode_meminfo(
            b"MemTotal:        500000 kB\nMemFree: 1 kB\nMemAvailable:    125000 kB\n",
        );
        assert_eq!(
            snapshot,
            Ok(VmMemorySnapshot {
                total_bytes: 512_000_000,
                available_bytes: 128_000_000,
            })
        );
        assert!(decode_meminfo(b"MemTotal: 500000 kB\n").is_err());
        assert!(decode_meminfo(b"MemTotal: 500000 bytes\nMemAvailable: 125000 kB\n").is_err());
    }

    #[test]
    fn capacity_validation_accepts_kernel_reservation_but_not_wrong_vm_class() {
        assert!(capacity_matches(512 * 1024 * 1024, 500 * 1024 * 1024));
        assert!(!capacity_matches(512 * 1024 * 1024, 256 * 1024 * 1024));
        assert!(!capacity_matches(512 * 1024 * 1024, 1024 * 1024 * 1024));
    }
}
