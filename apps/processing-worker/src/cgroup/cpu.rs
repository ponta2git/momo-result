//! CPU bandwidth shares the child attach barrier and cleanup ownership with memory.

use std::{
    fs,
    path::{Path, PathBuf},
};

use super::{CgroupError, CgroupHierarchy, bounded_read, read_process_ids, read_u64};
use crate::resource_budget::{CPU_PERIOD_MICROS, CpuBudget};

#[cfg(target_os = "linux")]
const V1_CPU_ROOTS: [&str; 2] = ["/sys/fs/cgroup/cpu", "/sys/fs/cgroup/cpu,cpuacct"];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ChildCpuCgroup {
    hierarchy: CgroupHierarchy,
    directory: PathBuf,
    budget: CpuBudget,
}

impl ChildCpuCgroup {
    pub(super) fn open(
        hierarchy: CgroupHierarchy,
        directory: PathBuf,
        budget: CpuBudget,
        production: bool,
    ) -> Result<Self, CgroupError> {
        if !super::safe_absolute_path(&directory)
            || (production && !super::production_cgroup_path(&directory))
        {
            return Err(CgroupError::UnsafeDirectory);
        }
        let group = Self {
            hierarchy,
            directory,
            budget,
        };
        group.validate_limit()?;
        group.ensure_empty()?;
        fs::OpenOptions::new()
            .write(true)
            .open(group.processes_path())
            .map_err(super::controller_open_error)?;
        Ok(group)
    }

    pub(super) const fn budget(&self) -> CpuBudget {
        self.budget
    }

    pub(super) fn directory(&self) -> &Path {
        &self.directory
    }

    pub(super) fn validate_limit(&self) -> Result<(), CgroupError> {
        let bandwidth = read_bandwidth(self.hierarchy, &self.directory)?;
        if bandwidth.quota_micros == Some(self.budget.quota_micros())
            && bandwidth.period_micros == CPU_PERIOD_MICROS
        {
            Ok(())
        } else {
            Err(CgroupError::LimitMismatch)
        }
    }

    pub(super) fn process_ids(&self) -> Result<Vec<u32>, CgroupError> {
        read_process_ids(&self.processes_path())
    }

    pub(super) fn ensure_empty(&self) -> Result<(), CgroupError> {
        if self.process_ids()?.is_empty() {
            Ok(())
        } else {
            Err(CgroupError::UnexpectedProcess)
        }
    }

    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(
            dead_code,
            reason = "child CPU attachment is available only in the Linux runtime"
        )
    )]
    pub(super) fn attach(&self, process_id: u32) -> Result<(), CgroupError> {
        fs::write(self.processes_path(), process_id.to_string())?;
        let attached = self.process_ids()?;
        if attached.as_slice() == [process_id] {
            Ok(())
        } else {
            Err(CgroupError::AttachFailed)
        }
    }

    fn processes_path(&self) -> PathBuf {
        self.directory.join("cgroup.procs")
    }

    #[cfg(target_os = "linux")]
    pub(super) fn validate_runtime_budget(&self) -> Result<(), CgroupError> {
        validate_runtime_budget(self.hierarchy, &self.directory, self.budget)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Bandwidth {
    quota_micros: Option<u64>,
    period_micros: u64,
}

impl Bandwidth {
    #[cfg(any(target_os = "linux", test))]
    fn admits(self, budget: CpuBudget) -> bool {
        self.quota_micros.is_none_or(|quota| {
            u128::from(quota) * 1_000
                >= u128::from(budget.millis()) * u128::from(self.period_micros)
        })
    }
}

fn read_bandwidth(hierarchy: CgroupHierarchy, directory: &Path) -> Result<Bandwidth, CgroupError> {
    let (quota, period) = match hierarchy {
        CgroupHierarchy::V1 => (
            bounded_read(&directory.join("cpu.cfs_quota_us"))?,
            read_u64(&directory.join("cpu.cfs_period_us"))?,
        ),
        CgroupHierarchy::V2 => {
            let raw = bounded_read(&directory.join("cpu.max"))?;
            let mut fields = raw.split_whitespace();
            let quota = fields
                .next()
                .ok_or(CgroupError::InvalidControllerValue)?
                .to_owned();
            let period = fields
                .next()
                .and_then(|value| value.parse().ok())
                .filter(|_period| fields.next().is_none())
                .ok_or(CgroupError::InvalidControllerValue)?;
            (quota, period)
        }
    };
    if !(1_000..=1_000_000).contains(&period) {
        return Err(CgroupError::InvalidControllerValue);
    }
    let unlimited = match hierarchy {
        CgroupHierarchy::V1 => "-1",
        CgroupHierarchy::V2 => "max",
    };
    let quota_micros = if quota.trim() == unlimited {
        None
    } else {
        Some(
            quota
                .trim()
                .parse::<u64>()
                .ok()
                .filter(|value| *value >= 1_000)
                .ok_or(CgroupError::InvalidControllerValue)?,
        )
    };
    Ok(Bandwidth {
        quota_micros,
        period_micros: period,
    })
}

#[cfg(target_os = "linux")]
fn validate_runtime_budget(
    hierarchy: CgroupHierarchy,
    child: &Path,
    budget: CpuBudget,
) -> Result<(), CgroupError> {
    // Affinity and ancestor quotas are distinct: rounding a fractional cgroup quota up to one
    // available CPU would otherwise admit more CPU than this instance was assigned.
    let processors = std::thread::available_parallelism()
        .map_err(|_error| CgroupError::ControllerUnavailable)?;
    let processors =
        u128::try_from(processors.get()).map_err(|_error| CgroupError::InvalidControllerValue)?;
    if u128::from(budget.millis()) > processors * 1_000 {
        return Err(CgroupError::LimitMismatch);
    }
    let root = match hierarchy {
        CgroupHierarchy::V1 => V1_CPU_ROOTS
            .iter()
            .map(Path::new)
            .find(|root| child.starts_with(root)),
        CgroupHierarchy::V2 => Some(Path::new(super::V2_ROOT)),
    }
    .ok_or(CgroupError::UnsafeDirectory)?;
    let mut ancestor = child.parent().ok_or(CgroupError::UnsafeDirectory)?;
    while ancestor.starts_with(root) {
        let controller = match hierarchy {
            CgroupHierarchy::V1 => "cpu.cfs_quota_us",
            CgroupHierarchy::V2 => "cpu.max",
        };
        // The system-wide v2 root has no cpu.max. Every non-root ancestor must expose it.
        if (ancestor != root || ancestor.join(controller).is_file())
            && !read_bandwidth(hierarchy, ancestor)?.admits(budget)
        {
            return Err(CgroupError::LimitMismatch);
        }
        if ancestor == root {
            break;
        }
        ancestor = ancestor.parent().ok_or(CgroupError::UnsafeDirectory)?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub(super) fn v1_worker_directory(membership: &str) -> Result<PathBuf, CgroupError> {
    let member = super::controller_membership_path(membership, Some("cpu"))?;
    for root in V1_CPU_ROOTS {
        let directory = super::controller_member_directory(Path::new(root), &member)?;
        if directory.join("cpu.cfs_quota_us").is_file() {
            return Ok(directory);
        }
    }
    Err(CgroupError::ControllerUnavailable)
}

#[cfg(target_os = "linux")]
pub(super) fn prepare_v1(
    membership: &str,
    budget: CpuBudget,
    user_id: u32,
    group_id: u32,
) -> Result<ChildCpuCgroup, CgroupError> {
    let parent = v1_worker_directory(membership)?;
    let directory = super::prepare_empty_child_directory(&parent, super::CGROUP_DIRECTORY_NAME)?;
    validate_runtime_budget(CgroupHierarchy::V1, &directory, budget)?;
    super::write_exact_u64(&directory.join("cpu.cfs_period_us"), CPU_PERIOD_MICROS)?;
    super::write_exact_u64(&directory.join("cpu.cfs_quota_us"), budget.quota_micros())?;
    if directory.join("cpu.cfs_burst_us").is_file() {
        super::write_exact_u64(&directory.join("cpu.cfs_burst_us"), 0)?;
    }
    super::delegate_process_attachment(&directory, user_id, group_id)?;
    ChildCpuCgroup::open(CgroupHierarchy::V1, directory, budget, true)
}

#[cfg(target_os = "linux")]
pub(super) fn prepare_v2(
    directory: &Path,
    budget: CpuBudget,
) -> Result<ChildCpuCgroup, CgroupError> {
    validate_runtime_budget(CgroupHierarchy::V2, directory, budget)?;
    fs::write(
        directory.join("cpu.max"),
        format!("{} {CPU_PERIOD_MICROS}", budget.quota_micros()),
    )?;
    if directory.join("cpu.max.burst").is_file() {
        super::write_exact_u64(&directory.join("cpu.max.burst"), 0)?;
    }
    ChildCpuCgroup::open(CgroupHierarchy::V2, directory.to_owned(), budget, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fractional_and_inherited_quotas_do_not_round_up() {
        assert!(
            Bandwidth {
                quota_micros: None,
                period_micros: 100_000
            }
            .admits(CpuBudget::DEFAULT)
        );
        assert!(
            Bandwidth {
                quota_micros: Some(100_000),
                period_micros: 100_000
            }
            .admits(CpuBudget::DEFAULT)
        );
        assert!(
            !Bandwidth {
                quota_micros: Some(99_999),
                period_micros: 100_000
            }
            .admits(CpuBudget::DEFAULT)
        );
    }

    #[test]
    fn both_controller_formats_reject_missing_or_unbounded_child_quotas()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        fs::write(directory.path().join("cpu.cfs_period_us"), "100000")?;
        fs::write(directory.path().join("cpu.cfs_quota_us"), "100000")?;
        fs::write(directory.path().join("cpu.max"), "100000 100000")?;
        fs::write(directory.path().join("cgroup.procs"), "")?;
        for hierarchy in [CgroupHierarchy::V1, CgroupHierarchy::V2] {
            let group = ChildCpuCgroup::open(
                hierarchy,
                directory.path().to_owned(),
                CpuBudget::DEFAULT,
                false,
            )?;
            if group.budget() != CpuBudget::DEFAULT {
                return Err("CPU budget differs from the controller readback".into());
            }
        }
        fs::write(directory.path().join("cpu.cfs_quota_us"), "-1")?;
        fs::write(directory.path().join("cpu.max"), "max 100000")?;
        for hierarchy in [CgroupHierarchy::V1, CgroupHierarchy::V2] {
            if !matches!(
                ChildCpuCgroup::open(
                    hierarchy,
                    directory.path().to_owned(),
                    CpuBudget::DEFAULT,
                    false
                ),
                Err(CgroupError::LimitMismatch)
            ) {
                return Err("unbounded child CPU quota was accepted".into());
            }
        }
        fs::write(directory.path().join("cpu.max"), "100000 100000 extra")?;
        if !matches!(
            read_bandwidth(CgroupHierarchy::V2, directory.path()),
            Err(CgroupError::InvalidControllerValue)
        ) {
            return Err("malformed CPU controller fields were accepted".into());
        }
        Ok(())
    }
}
