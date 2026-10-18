//! Joins the existing fixed isolation boundary of an authenticated, frozen live daemon.
use std::{
    env, fs,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

use super::{
    CGROUP_DIRECTORY_NAME, CGROUP_V2_VALIDATED_ENV, CgroupError, CgroupHierarchy, ChildCgroup,
    DELEGATION_CGROUP_NAME, PreparedChildCgroup, V1_MEMORY_ROOT, V2_ROOT, WORKER_CGROUP_NAME,
    bounded_read, controller_member_directory, cpu, membership_path, read_process_ids,
};
use crate::resource_budget::CpuBudget;

pub(crate) fn join_frozen_daemon(
    daemon_pid: u32,
    limit_bytes: u64,
    service_user_id: u32,
    service_group_id: u32,
) -> Result<PreparedChildCgroup, CgroupError> {
    if daemon_pid == 0
        || daemon_pid == std::process::id()
        || limit_bytes == 0
        || !limit_bytes.is_multiple_of(4096)
    {
        return Err(CgroupError::InvalidMembership);
    }
    let membership = daemon_membership(daemon_pid, service_user_id, service_group_id)?;
    let hierarchy = if Path::new(V2_ROOT).join("cgroup.controllers").is_file() {
        if env::var(CGROUP_V2_VALIDATED_ENV).as_deref() != Ok("true") {
            return Err(CgroupError::UnsupportedHierarchy);
        }
        CgroupHierarchy::V2
    } else if Path::new(V1_MEMORY_ROOT)
        .join("memory.limit_in_bytes")
        .is_file()
    {
        CgroupHierarchy::V1
    } else {
        return Err(CgroupError::UnsupportedHierarchy);
    };
    let root = match hierarchy {
        CgroupHierarchy::V1 => V1_MEMORY_ROOT,
        CgroupHierarchy::V2 => V2_ROOT,
    };
    let worker =
        controller_member_directory(Path::new(root), &membership_path(&membership, hierarchy)?)?;
    let delegation = delegated_parent(&worker, hierarchy, service_user_id, service_group_id)?;
    let members = read_process_ids(&worker.join("cgroup.procs"))?;
    if !members.contains(&daemon_pid)
        || (hierarchy == CgroupHierarchy::V2
            && members
                .iter()
                .any(|pid| *pid != daemon_pid && *pid != std::process::id()))
    {
        return Err(CgroupError::StaleBootstrapGroup);
    }
    let directory = delegation.join(CGROUP_DIRECTORY_NAME);
    let cpu_budget =
        CpuBudget::from_environment().map_err(|_error| CgroupError::InvalidEnvironment)?;
    let cpu_worker = match hierarchy {
        CgroupHierarchy::V1 => cpu::v1_worker_directory(&membership)?,
        CgroupHierarchy::V2 => worker.clone(),
    };
    let cpu_directory = match hierarchy {
        CgroupHierarchy::V1 => cpu_worker.join(CGROUP_DIRECTORY_NAME),
        CgroupHierarchy::V2 => directory.clone(),
    };
    let cpu = cpu::ChildCpuCgroup::open(hierarchy, cpu_directory.clone(), cpu_budget, true)?;
    cpu.validate_runtime_budget()?;
    owned_by(
        &cpu_directory.join("cgroup.procs"),
        service_user_id,
        service_group_id,
    )?;
    // Reuse exact limits and delegated files. No hierarchy, ownership, or limit is reconfigured.
    let child = ChildCgroup::open(hierarchy, directory.clone(), limit_bytes, cpu, true)?;
    owned_by(
        &directory.join("cgroup.procs"),
        service_user_id,
        service_group_id,
    )?;
    if hierarchy == CgroupHierarchy::V2 {
        owned_by(
            &directory.join("cgroup.kill"),
            service_user_id,
            service_group_id,
        )?;
    }
    drop(child);
    fs::write(worker.join("cgroup.procs"), std::process::id().to_string())?;
    if !read_process_ids(&worker.join("cgroup.procs"))?.contains(&std::process::id()) {
        return Err(CgroupError::AttachFailed);
    }
    if hierarchy == CgroupHierarchy::V1 {
        if !read_process_ids(&cpu_worker.join("cgroup.procs"))?.contains(&daemon_pid) {
            return Err(CgroupError::InvalidMembership);
        }
        fs::write(
            cpu_worker.join("cgroup.procs"),
            std::process::id().to_string(),
        )?;
        if !read_process_ids(&cpu_worker.join("cgroup.procs"))?.contains(&std::process::id()) {
            return Err(CgroupError::AttachFailed);
        }
    }
    Ok(PreparedChildCgroup {
        hierarchy,
        directory,
        limit_bytes,
        cpu_directory,
        cpu_budget,
    })
}

fn daemon_membership(
    daemon_pid: u32,
    service_user_id: u32,
    service_group_id: u32,
) -> Result<String, CgroupError> {
    let process_directory = PathBuf::from(format!("/proc/{daemon_pid}"));
    let status = bounded_read(&process_directory.join("status"))?;
    for (field, expected) in [("Uid:", service_user_id), ("Gid:", service_group_id)] {
        let values = status
            .lines()
            .find_map(|line| line.strip_prefix(field))
            .ok_or(CgroupError::InvalidMembership)?;
        let mut values = values.split_whitespace();
        if (0..4).any(|_index| {
            values.next().and_then(|value| value.parse::<u32>().ok()) != Some(expected)
        }) || values.next().is_some()
        {
            return Err(CgroupError::DelegationFailed);
        }
    }
    bounded_read(&process_directory.join("cgroup"))
}

fn delegated_parent(
    worker: &Path,
    hierarchy: CgroupHierarchy,
    service_user_id: u32,
    service_group_id: u32,
) -> Result<&Path, CgroupError> {
    let delegation = match hierarchy {
        CgroupHierarchy::V1 => worker,
        CgroupHierarchy::V2 => {
            if worker
                .file_name()
                .is_none_or(|name| name != WORKER_CGROUP_NAME)
            {
                return Err(CgroupError::UnsafeDirectory);
            }
            let parent = worker.parent().ok_or(CgroupError::UnsafeDirectory)?;
            if parent
                .file_name()
                .is_none_or(|name| name != DELEGATION_CGROUP_NAME)
            {
                return Err(CgroupError::UnsafeDirectory);
            }
            owned_by(
                &parent.join("cgroup.procs"),
                service_user_id,
                service_group_id,
            )?;
            parent
        }
    };
    Ok(delegation)
}

fn owned_by(path: &Path, user_id: u32, group_id: u32) -> Result<(), CgroupError> {
    let metadata = fs::metadata(path)?;
    if metadata.uid() == user_id && metadata.gid() == group_id {
        Ok(())
    } else {
        Err(CgroupError::DelegationFailed)
    }
}
