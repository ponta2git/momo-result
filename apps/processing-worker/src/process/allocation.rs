/// Allocates and physically touches an anonymous mapping for the explicit memory-limit probes.
#[cfg(unix)]
#[must_use]
pub(crate) fn allocate_and_touch(bytes: u64) -> i32 {
    let Ok(length) = usize::try_from(bytes) else {
        return super::RESOURCE_LIMIT_HIT_EXIT_CODE;
    };
    let Some(mapping) = AnonymousMapping::new(length) else {
        return super::RESOURCE_LIMIT_HIT_EXIT_CODE;
    };
    // SAFETY: sysconf reads a process-global constant and has no pointer preconditions.
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    let Ok(page_size) = usize::try_from(page_size) else {
        return 74;
    };
    if page_size == 0 {
        return 74;
    }
    mapping.touch_pages(page_size);
    if mapping.release() { 0 } else { 75 }
}

#[cfg(unix)]
struct AnonymousMapping {
    pointer: Option<std::ptr::NonNull<libc::c_void>>,
    length: usize,
}

#[cfg(unix)]
impl AnonymousMapping {
    fn new(length: usize) -> Option<Self> {
        // SAFETY: the arguments request a private anonymous mapping and contain no borrowed
        // pointers. A successful mapping is owned by the returned guard.
        let pointer = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                length,
                libc::PROT_READ | libc::PROT_WRITE,
                anonymous_mapping_flags(),
                -1,
                0,
            )
        };
        if pointer == libc::MAP_FAILED {
            return None;
        }
        std::ptr::NonNull::new(pointer).map(|pointer| Self {
            pointer: Some(pointer),
            length,
        })
    }

    fn touch_pages(&self, page_size: usize) {
        let Some(pointer) = self.pointer else {
            return;
        };
        let bytes = pointer.as_ptr().cast::<u8>();
        for offset in (0..self.length).step_by(page_size) {
            let address = bytes.wrapping_add(offset);
            // SAFETY: `offset` is strictly below the owned mapping length.
            unsafe { std::ptr::write_volatile(address, 1) };
        }
    }

    fn release(mut self) -> bool {
        let Some(pointer) = self.pointer.take() else {
            return true;
        };
        // SAFETY: the guard owns this mapping and clears the pointer before `Drop` can run.
        let result = unsafe { libc::munmap(pointer.as_ptr(), self.length) };
        result == 0
    }
}

#[cfg(target_os = "linux")]
const fn anonymous_mapping_flags() -> libc::c_int {
    // The probe touches every page, so Linux must defer memory admission to physical allocation.
    // Otherwise a small no-swap guest can reject one large mapping against its global commit
    // budget before the child cgroup's hard limit is exercised.
    libc::MAP_PRIVATE | libc::MAP_ANONYMOUS | libc::MAP_NORESERVE
}

#[cfg(all(unix, not(target_os = "linux")))]
const fn anonymous_mapping_flags() -> libc::c_int {
    libc::MAP_PRIVATE | libc::MAP_ANONYMOUS
}

#[cfg(unix)]
impl Drop for AnonymousMapping {
    fn drop(&mut self) {
        if let Some(pointer) = self.pointer.take() {
            // SAFETY: the guard still owns this mapping; cleanup errors cannot be reported from
            // `Drop`, but the explicit success path uses `release` when the result matters.
            unsafe {
                libc::munmap(pointer.as_ptr(), self.length);
            }
        }
    }
}

/// Reports that the allocation probe is unavailable outside Unix runtimes.
#[cfg(not(unix))]
#[must_use]
pub(crate) const fn allocate_and_touch(_bytes: u64) -> i32 {
    76
}
