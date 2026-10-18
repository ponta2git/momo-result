//! Identity read from a running job before expiry recovery rechecks it under row locks.
#[derive(Clone, Debug)]
pub(crate) struct ExpiredJobLease {
    pub(crate) job_id: String,
    pub(crate) owner: String,
    pub(crate) attempt_id: String,
    pub(crate) fencing_token: i64,
}
