use std::{
    env, fs, io,
    path::{Component, Path, PathBuf},
};

use thiserror::Error;

pub(crate) const CGROUP_DIRECTORY_NAME: &str = "momo-heavy-child";
pub(crate) const CGROUP_HIERARCHY_ENV: &str = "MOMO_HEAVY_CGROUP_HIERARCHY";
pub(crate) const CGROUP_DIRECTORY_ENV: &str = "MOMO_HEAVY_CGROUP_DIRECTORY";
pub(crate) const CGROUP_LIMIT_ENV: &str = "MOMO_HEAVY_CGROUP_LIMIT_BYTES";
#[cfg(target_os = "linux")]
const CGROUP_V2_VALIDATED_ENV: &str = "MOMO_HEAVY_CGROUP_V2_VALIDATED";

#[cfg(target_os = "linux")]
const PROC_SELF_CGROUP: &str = "/proc/self/cgroup";
#[cfg(target_os = "linux")]
const V1_MEMORY_ROOT: &str = "/sys/fs/cgroup/memory";
#[cfg(target_os = "linux")]
const V2_ROOT: &str = "/sys/fs/cgroup";
#[cfg(target_os = "linux")]
const DELEGATION_CGROUP_NAME: &str = "momo-heavy-delegated";
#[cfg(target_os = "linux")]
const ORCHESTRATOR_CGROUP_NAME: &str = "momo-orchestrator";

const MAXIMUM_CONTROLLER_FILE_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CgroupHierarchy {
    V1,
    V2,
}

impl CgroupHierarchy {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "v1" => Some(Self::V1),
            "v2" => Some(Self::V2),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct CgroupMemorySnapshot {
    pub(crate) current_bytes: u64,
    pub(crate) peak_bytes: u64,
    pub(crate) oom_kill_count: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChildCgroup {
    hierarchy: CgroupHierarchy,
    directory: PathBuf,
    expected_limit_bytes: u64,
}

#[derive(Debug, Error)]
pub(crate) enum CgroupError {
    #[error("cgroup runtime environment is incomplete or invalid")]
    InvalidEnvironment,
    #[error("cgroup directory is outside the fixed runtime boundary")]
    UnsafeDirectory,
    #[error("cgroup controller file is unavailable")]
    ControllerUnavailable,
    #[error("cgroup controller value is invalid")]
    InvalidControllerValue,
    #[error("cgroup hard limit does not match the configured child limit")]
    LimitMismatch,
    #[error("cgroup contains a process outside the managed child lifecycle")]
    UnexpectedProcess,
    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(
            dead_code,
            reason = "production child attachment is available only on the Linux runtime"
        )
    )]
    #[error("cgroup child attachment failed")]
    AttachFailed,
    #[error("cgroup controller I/O failed: {0}")]
    Io(#[from] io::Error),
    #[cfg(target_os = "linux")]
    #[error("cgroup hierarchy is unsupported or has not passed its runtime probe")]
    UnsupportedHierarchy,
    #[cfg(target_os = "linux")]
    #[error("cgroup membership record is invalid")]
    InvalidMembership,
    #[cfg(target_os = "linux")]
    #[error("cgroup bootstrap found a stale process")]
    StaleBootstrapGroup,
    #[cfg(target_os = "linux")]
    #[error("cgroup delegation to the worker identity failed")]
    DelegationFailed,
}

impl CgroupError {
    pub(crate) const fn kind(&self) -> &'static str {
        match self {
            Self::InvalidEnvironment => "cgroup_invalid_environment",
            Self::UnsafeDirectory => "cgroup_unsafe_directory",
            Self::ControllerUnavailable => "cgroup_controller_unavailable",
            Self::InvalidControllerValue => "cgroup_controller_value",
            Self::LimitMismatch => "cgroup_limit_mismatch",
            Self::UnexpectedProcess => "cgroup_unexpected_process",
            Self::AttachFailed => "cgroup_attach_failed",
            Self::Io(_) => "cgroup_io",
            #[cfg(target_os = "linux")]
            Self::UnsupportedHierarchy => "cgroup_unsupported_hierarchy",
            #[cfg(target_os = "linux")]
            Self::InvalidMembership => "cgroup_invalid_membership",
            #[cfg(target_os = "linux")]
            Self::StaleBootstrapGroup => "cgroup_stale_bootstrap_group",
            #[cfg(target_os = "linux")]
            Self::DelegationFailed => "cgroup_delegation_failed",
        }
    }
}

#[cfg(target_os = "linux")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedChildCgroup {
    hierarchy: CgroupHierarchy,
    directory: PathBuf,
    limit_bytes: u64,
}

#[cfg(target_os = "linux")]
impl PreparedChildCgroup {
    pub(crate) fn environment(&self) -> [(String, String); 3] {
        [
            (
                String::from(CGROUP_HIERARCHY_ENV),
                String::from(self.hierarchy.wire()),
            ),
            (
                String::from(CGROUP_DIRECTORY_ENV),
                self.directory.as_os_str().to_string_lossy().into_owned(),
            ),
            (String::from(CGROUP_LIMIT_ENV), self.limit_bytes.to_string()),
        ]
    }
}

#[cfg(target_os = "linux")]
impl CgroupHierarchy {
    const fn wire(self) -> &'static str {
        match self {
            Self::V1 => "v1",
            Self::V2 => "v2",
        }
    }
}

impl ChildCgroup {
    pub(crate) fn from_environment(expected_limit_bytes: u64) -> Result<Self, CgroupError> {
        let hierarchy = env::var(CGROUP_HIERARCHY_ENV)
            .ok()
            .and_then(|value| CgroupHierarchy::parse(value.trim()))
            .ok_or(CgroupError::InvalidEnvironment)?;
        let directory = env::var(CGROUP_DIRECTORY_ENV)
            .ok()
            .map(PathBuf::from)
            .ok_or(CgroupError::InvalidEnvironment)?;
        let configured_limit = env::var(CGROUP_LIMIT_ENV)
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .ok_or(CgroupError::InvalidEnvironment)?;
        if configured_limit != expected_limit_bytes {
            return Err(CgroupError::LimitMismatch);
        }
        Self::open(hierarchy, directory, expected_limit_bytes, !cfg!(test))
    }

    fn open(
        hierarchy: CgroupHierarchy,
        directory: PathBuf,
        expected_limit_bytes: u64,
        enforce_production_path: bool,
    ) -> Result<Self, CgroupError> {
        if expected_limit_bytes == 0
            || !safe_absolute_path(&directory)
            || (enforce_production_path && !production_cgroup_path(&directory))
        {
            return Err(CgroupError::UnsafeDirectory);
        }
        let cgroup = Self {
            hierarchy,
            directory,
            expected_limit_bytes,
        };
        cgroup.validate_limit()?;
        cgroup.ensure_empty()?;
        fs::OpenOptions::new()
            .write(true)
            .open(cgroup.processes_path())
            .map_err(controller_open_error)?;
        cgroup.snapshot()?;
        Ok(cgroup)
    }

    #[cfg_attr(
        all(not(target_os = "linux"), not(test)),
        expect(
            dead_code,
            reason = "production child attachment is available only on the Linux runtime"
        )
    )]
    pub(crate) fn attach(&self, process_id: u32) -> Result<(), CgroupError> {
        if process_id == 0 {
            return Err(CgroupError::AttachFailed);
        }
        self.ensure_empty()?;
        fs::write(self.processes_path(), process_id.to_string())?;
        let attached = read_process_ids(&self.processes_path())?;
        if attached.len() != 1 || attached.first().copied() != Some(process_id) {
            return Err(CgroupError::AttachFailed);
        }
        Ok(())
    }

    pub(crate) fn ensure_empty(&self) -> Result<(), CgroupError> {
        if read_process_ids(&self.processes_path())?.is_empty() {
            Ok(())
        } else {
            Err(CgroupError::UnexpectedProcess)
        }
    }

    pub(crate) fn snapshot(&self) -> Result<CgroupMemorySnapshot, CgroupError> {
        match self.hierarchy {
            CgroupHierarchy::V1 => Ok(CgroupMemorySnapshot {
                current_bytes: read_u64(&self.directory.join("memory.usage_in_bytes"))?,
                peak_bytes: read_u64(&self.directory.join("memory.max_usage_in_bytes"))?,
                oom_kill_count: read_named_u64(
                    &self.directory.join("memory.oom_control"),
                    "oom_kill",
                )?,
            }),
            CgroupHierarchy::V2 => Ok(CgroupMemorySnapshot {
                current_bytes: read_u64(&self.directory.join("memory.current"))?,
                peak_bytes: read_u64(&self.directory.join("memory.peak"))?,
                oom_kill_count: read_named_u64(&self.directory.join("memory.events"), "oom_kill")?,
            }),
        }
    }

    fn validate_limit(&self) -> Result<(), CgroupError> {
        let limit_path = match self.hierarchy {
            CgroupHierarchy::V1 => self.directory.join("memory.limit_in_bytes"),
            CgroupHierarchy::V2 => self.directory.join("memory.max"),
        };
        if read_u64(&limit_path)? == self.expected_limit_bytes {
            Ok(())
        } else {
            Err(CgroupError::LimitMismatch)
        }
    }

    fn processes_path(&self) -> PathBuf {
        self.directory.join("cgroup.procs")
    }

    #[cfg(test)]
    fn open_fixture(
        hierarchy: CgroupHierarchy,
        directory: PathBuf,
        expected_limit_bytes: u64,
    ) -> Result<Self, CgroupError> {
        Self::open(hierarchy, directory, expected_limit_bytes, false)
    }
}

#[cfg(target_os = "linux")]
pub(crate) fn prepare_production_child_cgroup(
    limit_bytes: u64,
    worker_uid: u32,
    worker_gid: u32,
) -> Result<PreparedChildCgroup, CgroupError> {
    if limit_bytes == 0 || limit_bytes % 4096 != 0 {
        return Err(CgroupError::InvalidControllerValue);
    }
    let membership = bounded_read(Path::new(PROC_SELF_CGROUP))?;
    if Path::new(V2_ROOT).join("cgroup.controllers").is_file() {
        if env::var(CGROUP_V2_VALIDATED_ENV).as_deref() != Ok("true") {
            return Err(CgroupError::UnsupportedHierarchy);
        }
        prepare_v2(&membership, limit_bytes, worker_uid, worker_gid)
    } else if Path::new(V1_MEMORY_ROOT)
        .join("memory.limit_in_bytes")
        .is_file()
    {
        prepare_v1(&membership, limit_bytes, worker_uid, worker_gid)
    } else {
        Err(CgroupError::UnsupportedHierarchy)
    }
}

#[cfg(target_os = "linux")]
fn prepare_v1(
    membership: &str,
    limit_bytes: u64,
    worker_uid: u32,
    worker_gid: u32,
) -> Result<PreparedChildCgroup, CgroupError> {
    let member_path = membership_path(membership, CgroupHierarchy::V1)?;
    let parent = controller_member_directory(Path::new(V1_MEMORY_ROOT), &member_path)?;
    if !parent.join("memory.limit_in_bytes").is_file() {
        return Err(CgroupError::ControllerUnavailable);
    }
    let directory = prepare_empty_child_directory(&parent, CGROUP_DIRECTORY_NAME)?;
    write_exact_u64(&directory.join("memory.limit_in_bytes"), limit_bytes)?;
    if directory.join("memory.swappiness").is_file() {
        write_exact_u64(&directory.join("memory.swappiness"), 0)?;
    }
    if directory.join("memory.max_usage_in_bytes").is_file() {
        fs::write(directory.join("memory.max_usage_in_bytes"), "0")?;
    }
    delegate_process_attachment(&directory, worker_uid, worker_gid)?;
    Ok(PreparedChildCgroup {
        hierarchy: CgroupHierarchy::V1,
        directory,
        limit_bytes,
    })
}

#[cfg(target_os = "linux")]
fn prepare_v2(
    membership: &str,
    limit_bytes: u64,
    worker_uid: u32,
    worker_gid: u32,
) -> Result<PreparedChildCgroup, CgroupError> {
    let member_path = membership_path(membership, CgroupHierarchy::V2)?;
    let parent = controller_member_directory(Path::new(V2_ROOT), &member_path)?;
    require_controller_token(&parent.join("cgroup.controllers"), "memory")?;

    let parent_processes = read_process_ids(&parent.join("cgroup.procs"))?;
    if parent_processes.as_slice() != [std::process::id()] {
        return Err(CgroupError::StaleBootstrapGroup);
    }

    // A non-root cgroup v2 migration requires write access to both the
    // destination cgroup.procs and the common ancestor's cgroup.procs. Keep
    // both the orchestrator and heavy child under one narrowly delegated root
    // so the worker never needs write access to the container's cgroup root.
    let delegation = prepare_empty_child_directory(&parent, DELEGATION_CGROUP_NAME)?;
    let orchestrator = prepare_empty_child_directory(&delegation, ORCHESTRATOR_CGROUP_NAME)?;
    fs::write(
        orchestrator.join("cgroup.procs"),
        std::process::id().to_string(),
    )?;
    let orchestrator_processes = read_process_ids(&orchestrator.join("cgroup.procs"))?;
    if orchestrator_processes.as_slice() != [std::process::id()] {
        return Err(CgroupError::AttachFailed);
    }
    if !read_process_ids(&parent.join("cgroup.procs"))?.is_empty() {
        return Err(CgroupError::StaleBootstrapGroup);
    }

    enable_controller_for_children(&parent, "memory")?;
    require_controller_token(&delegation.join("cgroup.controllers"), "memory")?;
    enable_controller_for_children(&delegation, "memory")?;

    let directory = prepare_empty_child_directory(&delegation, CGROUP_DIRECTORY_NAME)?;
    write_exact_u64(&directory.join("memory.max"), limit_bytes)?;
    if directory.join("memory.swap.max").is_file() {
        write_exact_u64(&directory.join("memory.swap.max"), 0)?;
    }
    if directory.join("memory.oom.group").is_file() {
        write_exact_u64(&directory.join("memory.oom.group"), 1)?;
    }
    delegate_process_attachment(&delegation, worker_uid, worker_gid)?;
    delegate_process_attachment(&directory, worker_uid, worker_gid)?;
    Ok(PreparedChildCgroup {
        hierarchy: CgroupHierarchy::V2,
        directory,
        limit_bytes,
    })
}

#[cfg(target_os = "linux")]
fn enable_controller_for_children(parent: &Path, controller: &str) -> Result<(), CgroupError> {
    let subtree_control = parent.join("cgroup.subtree_control");
    if !controller_file_has_token(&subtree_control, controller)? {
        fs::write(&subtree_control, format!("+{controller}"))?;
        if !controller_file_has_token(&subtree_control, controller)? {
            return Err(CgroupError::ControllerUnavailable);
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn prepare_empty_child_directory(parent: &Path, name: &str) -> Result<PathBuf, CgroupError> {
    let directory = parent.join(name);
    match fs::create_dir(&directory) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(CgroupError::Io(error)),
    }
    if !read_process_ids(&directory.join("cgroup.procs"))?.is_empty() {
        return Err(CgroupError::StaleBootstrapGroup);
    }
    Ok(directory)
}

#[cfg(target_os = "linux")]
fn delegate_process_attachment(
    directory: &Path,
    worker_uid: u32,
    worker_gid: u32,
) -> Result<(), CgroupError> {
    use std::os::unix::fs::{MetadataExt, chown};

    let processes = directory.join("cgroup.procs");
    chown(&processes, Some(worker_uid), Some(worker_gid))?;
    let metadata = fs::metadata(&processes)?;
    if metadata.uid() != worker_uid || metadata.gid() != worker_gid {
        return Err(CgroupError::DelegationFailed);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn membership_path(membership: &str, hierarchy: CgroupHierarchy) -> Result<PathBuf, CgroupError> {
    for line in membership.lines() {
        let mut fields = line.splitn(3, ':');
        let Some(_hierarchy_id) = fields.next() else {
            continue;
        };
        let Some(controllers) = fields.next() else {
            continue;
        };
        let Some(path) = fields.next() else {
            continue;
        };
        let selected = match hierarchy {
            CgroupHierarchy::V1 => controllers.split(',').any(|value| value == "memory"),
            CgroupHierarchy::V2 => controllers.is_empty(),
        };
        if selected {
            let path = PathBuf::from(path);
            if safe_absolute_membership_path(&path) {
                return Ok(path);
            }
            return Err(CgroupError::InvalidMembership);
        }
    }
    Err(CgroupError::InvalidMembership)
}

#[cfg(target_os = "linux")]
fn controller_member_directory(root: &Path, membership: &Path) -> Result<PathBuf, CgroupError> {
    if !safe_absolute_membership_path(membership) {
        return Err(CgroupError::InvalidMembership);
    }
    let relative = membership
        .strip_prefix("/")
        .map_err(|_error| CgroupError::InvalidMembership)?;
    let directory = root.join(relative);
    if safe_absolute_path(&directory) {
        Ok(directory)
    } else {
        Err(CgroupError::InvalidMembership)
    }
}

#[cfg(target_os = "linux")]
fn safe_absolute_membership_path(path: &Path) -> bool {
    path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::RootDir | Component::Normal(_)))
}

#[cfg(target_os = "linux")]
fn require_controller_token(path: &Path, token: &str) -> Result<(), CgroupError> {
    if controller_file_has_token(path, token)? {
        Ok(())
    } else {
        Err(CgroupError::ControllerUnavailable)
    }
}

#[cfg(target_os = "linux")]
fn controller_file_has_token(path: &Path, token: &str) -> Result<bool, CgroupError> {
    Ok(bounded_read(path)?
        .split_whitespace()
        .any(|value| value == token))
}

#[cfg(target_os = "linux")]
fn write_exact_u64(path: &Path, value: u64) -> Result<(), CgroupError> {
    fs::write(path, value.to_string())?;
    if read_u64(path)? == value {
        Ok(())
    } else {
        Err(CgroupError::LimitMismatch)
    }
}

fn production_cgroup_path(path: &Path) -> bool {
    path.starts_with("/sys/fs/cgroup")
        && path
            .file_name()
            .is_some_and(|name| name == CGROUP_DIRECTORY_NAME)
}

fn safe_absolute_path(path: &Path) -> bool {
    path.is_absolute()
        && path != Path::new("/")
        && path
            .components()
            .all(|component| matches!(component, Component::RootDir | Component::Normal(_)))
}

fn read_process_ids(path: &Path) -> Result<Vec<u32>, CgroupError> {
    bounded_read(path)?
        .split_whitespace()
        .map(|value| {
            value
                .parse::<u32>()
                .ok()
                .filter(|process_id| *process_id > 0)
                .ok_or(CgroupError::InvalidControllerValue)
        })
        .collect()
}

fn read_u64(path: &Path) -> Result<u64, CgroupError> {
    bounded_read(path)?
        .trim()
        .parse::<u64>()
        .map_err(|_error| CgroupError::InvalidControllerValue)
}

fn read_named_u64(path: &Path, field: &str) -> Result<u64, CgroupError> {
    for line in bounded_read(path)?.lines() {
        let mut parts = line.split_whitespace();
        if parts.next() != Some(field) {
            continue;
        }
        let value = parts
            .next()
            .and_then(|raw| raw.parse::<u64>().ok())
            .filter(|_value| parts.next().is_none())
            .ok_or(CgroupError::InvalidControllerValue)?;
        return Ok(value);
    }
    Err(CgroupError::InvalidControllerValue)
}

fn bounded_read(path: &Path) -> Result<String, CgroupError> {
    let metadata = fs::metadata(path).map_err(controller_open_error)?;
    if !metadata.is_file() || metadata.len() > MAXIMUM_CONTROLLER_FILE_BYTES {
        return Err(CgroupError::ControllerUnavailable);
    }
    fs::read_to_string(path).map_err(CgroupError::Io)
}

fn controller_open_error(error: io::Error) -> CgroupError {
    if matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied
    ) {
        CgroupError::ControllerUnavailable
    } else {
        CgroupError::Io(error)
    }
}

#[cfg(test)]
#[expect(
    clippy::expect_used,
    reason = "cgroup fixtures abort with precise context when test setup is invalid"
)]
mod tests {
    use super::*;

    fn fixture(hierarchy: CgroupHierarchy) -> (tempfile::TempDir, PathBuf) {
        let temporary = tempfile::tempdir().expect("temporary cgroup root must be created");
        let directory = temporary.path().join(CGROUP_DIRECTORY_NAME);
        fs::create_dir(&directory).expect("fixture cgroup must be created");
        fs::write(directory.join("cgroup.procs"), "").expect("process fixture must be written");
        match hierarchy {
            CgroupHierarchy::V1 => {
                fs::write(directory.join("memory.limit_in_bytes"), "201326592\n")
                    .expect("v1 limit fixture must be written");
                fs::write(directory.join("memory.usage_in_bytes"), "4096\n")
                    .expect("v1 usage fixture must be written");
                fs::write(directory.join("memory.max_usage_in_bytes"), "8192\n")
                    .expect("v1 peak fixture must be written");
                fs::write(
                    directory.join("memory.oom_control"),
                    "oom_kill_disable 0\nunder_oom 0\noom_kill 2\n",
                )
                .expect("v1 event fixture must be written");
            }
            CgroupHierarchy::V2 => {
                fs::write(directory.join("memory.max"), "201326592\n")
                    .expect("v2 limit fixture must be written");
                fs::write(directory.join("memory.current"), "4096\n")
                    .expect("v2 usage fixture must be written");
                fs::write(directory.join("memory.peak"), "8192\n")
                    .expect("v2 peak fixture must be written");
                fs::write(
                    directory.join("memory.events"),
                    "low 0\nhigh 0\nmax 1\noom 2\noom_kill 2\n",
                )
                .expect("v2 event fixture must be written");
            }
        }
        (temporary, directory)
    }

    #[test]
    fn v1_and_v2_validate_the_same_runtime_contract() {
        for hierarchy in [CgroupHierarchy::V1, CgroupHierarchy::V2] {
            let (_temporary, directory) = fixture(hierarchy);
            let cgroup = ChildCgroup::open_fixture(hierarchy, directory, 201_326_592)
                .expect("valid cgroup fixture must open");
            assert_eq!(
                cgroup.snapshot().expect("snapshot must be readable"),
                CgroupMemorySnapshot {
                    current_bytes: 4096,
                    peak_bytes: 8192,
                    oom_kill_count: 2,
                }
            );
        }
    }

    #[test]
    fn attach_requires_an_empty_group_and_exact_pid_readback() {
        let (_temporary, directory) = fixture(CgroupHierarchy::V1);
        let cgroup = ChildCgroup::open_fixture(CgroupHierarchy::V1, directory.clone(), 201_326_592)
            .expect("valid cgroup fixture must open");
        cgroup.attach(42).expect("first child must attach");
        assert!(matches!(
            cgroup.attach(43),
            Err(CgroupError::UnexpectedProcess)
        ));
        fs::write(directory.join("cgroup.procs"), "").expect("fixture must be emptied");
        cgroup.ensure_empty().expect("empty group must be accepted");
    }

    #[test]
    fn wrong_limit_and_stale_membership_fail_closed() {
        let (_temporary, directory) = fixture(CgroupHierarchy::V2);
        assert!(matches!(
            ChildCgroup::open_fixture(CgroupHierarchy::V2, directory.clone(), 64),
            Err(CgroupError::LimitMismatch)
        ));
        fs::write(directory.join("cgroup.procs"), "91\n")
            .expect("stale process fixture must be written");
        assert!(matches!(
            ChildCgroup::open_fixture(CgroupHierarchy::V2, directory, 201_326_592),
            Err(CgroupError::UnexpectedProcess)
        ));
    }

    #[test]
    fn production_path_rejects_aliases_and_parent_components() {
        assert!(production_cgroup_path(Path::new(
            "/sys/fs/cgroup/memory/momo-heavy-child"
        )));
        assert!(!production_cgroup_path(Path::new(
            "/sys/fs/cgroup/memory/other"
        )));
        assert!(!safe_absolute_path(Path::new(
            "/sys/fs/cgroup/../momo-heavy-child"
        )));
    }
}
