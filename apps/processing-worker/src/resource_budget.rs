//! Instance resources are reserved before a claim and retained until process cleanup is verified.
//!
//! Job leases authorize durable writes. This budget only admits local computation; the shared
//! child cgroup accounts for the whole process tree inside its one reservation.

use thiserror::Error;

pub(crate) const CPU_LIMIT_ENV: &str = "MOMO_PROCESSING_CPU_LIMIT_MILLIS";
pub(crate) const CPU_PERIOD_MICROS: u64 = 100_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct CpuBudget(u32);

impl CpuBudget {
    pub(crate) const DEFAULT: Self = Self(1_000);

    pub(crate) fn from_environment() -> Result<Self, ResourceBudgetError> {
        std::env::var(CPU_LIMIT_ENV).map_or_else(
            |error| match error {
                std::env::VarError::NotPresent => Ok(Self::DEFAULT),
                std::env::VarError::NotUnicode(_) => Err(ResourceBudgetError::InvalidCpuLimit),
            },
            |raw| {
                raw.parse::<u32>()
                    .ok()
                    .filter(|millis| *millis >= 10)
                    .map(Self)
                    .ok_or(ResourceBudgetError::InvalidCpuLimit)
            },
        )
    }

    pub(crate) const fn millis(self) -> u32 {
        self.0
    }

    pub(crate) fn quota_micros(self) -> u64 {
        u64::from(self.0) * (CPU_PERIOD_MICROS / 1_000)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct MemoryBudget {
    runtime_bytes: u64,
    child_bytes: u64,
}

impl MemoryBudget {
    pub(crate) fn new(
        runtime_bytes: u64,
        child_bytes: u64,
        parent_headroom_bytes: u64,
    ) -> Result<Self, ResourceBudgetError> {
        if runtime_bytes == 0
            || child_bytes == 0
            || parent_headroom_bytes == 0
            || child_bytes
                .checked_add(parent_headroom_bytes)
                .is_none_or(|required| required > runtime_bytes)
        {
            return Err(ResourceBudgetError::UnsafeMemoryRelationship);
        }
        Ok(Self {
            runtime_bytes,
            child_bytes,
        })
    }

    #[cfg(any(target_os = "linux", test))]
    pub(crate) const fn runtime_bytes(self) -> u64 {
        self.runtime_bytes
    }

    pub(crate) const fn child_bytes(self) -> u64 {
        self.child_bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ResourceLimits {
    pub(crate) cpu: CpuBudget,
    pub(crate) memory: MemoryBudget,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub(crate) enum ResourceBudgetError {
    #[error("{CPU_LIMIT_ENV} must be an integer of at least 10 millicpus")]
    InvalidCpuLimit,
    #[error("child memory limit plus parent headroom must not exceed the runtime memory limit")]
    UnsafeMemoryRelationship,
    #[error("processing instance resources are already reserved")]
    AlreadyReserved,
}

/// Capacity is intentionally one whole attempt. It is not configurable concurrency.
///
/// The reservation lives outside the cancellable attempt task. Dropping a future, receiving a DB
/// lease expiry, or losing a job owner never returns physical resources to the scheduler.
pub(crate) struct ResourceBudget {
    limits: ResourceLimits,
    reserved: bool,
}

impl ResourceBudget {
    pub(crate) const fn new(limits: ResourceLimits) -> Self {
        Self {
            limits,
            reserved: false,
        }
    }

    pub(crate) const fn is_reserved(&self) -> bool {
        self.reserved
    }

    pub(crate) const fn reserve(&mut self) -> Result<ResourceLimits, ResourceBudgetError> {
        if self.reserved {
            return Err(ResourceBudgetError::AlreadyReserved);
        }
        self.reserved = true;
        Ok(self.limits)
    }

    /// Only a rejected claim or a completed execution with verified cleanup can return capacity.
    pub(crate) const fn release(&mut self) {
        self.reserved = false;
    }
}

#[cfg(test)]
impl ResourceLimits {
    pub(crate) const fn fixture() -> Self {
        Self {
            cpu: CpuBudget::DEFAULT,
            memory: MemoryBudget {
                runtime_bytes: 2,
                child_bytes: 1,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reservation_holds_all_instance_capacity_until_explicit_cleanup() {
        let limits = ResourceLimits::fixture();
        let mut budget = ResourceBudget::new(limits);
        assert_eq!(budget.reserve(), Ok(limits));
        assert_eq!(budget.reserve(), Err(ResourceBudgetError::AlreadyReserved));
        budget.release();
        assert_eq!(budget.reserve(), Ok(limits));
    }

    #[test]
    fn memory_reserves_parent_headroom_and_rejects_overflow() {
        assert!(MemoryBudget::new(256, 192, 64).is_ok());
        for (runtime, child, parent) in [(256, 193, 64), (u64::MAX, u64::MAX, 1), (256, 192, 0)] {
            assert_eq!(
                MemoryBudget::new(runtime, child, parent),
                Err(ResourceBudgetError::UnsafeMemoryRelationship)
            );
        }
    }
}
