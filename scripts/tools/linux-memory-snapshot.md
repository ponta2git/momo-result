# Linux memory snapshot

`linux-memory-snapshot.sh` is a read-only, zero-install cgroup v1 diagnostic collector requiring
POSIX shell utilities and `awk`. It reads `CGROUP_MEMORY_ROOT` (default `/sys/fs/cgroup/memory`) and
`PROC_ROOT` (default `/proc`), and writes TSV to stdout. It never reads command lines or process
environments. Runtime observations belong in private evidence, not public repository files.

Schema version 2 keeps the process columns from version 1, but reports unavailable or invalid
process measurements as `NA`; measured zero remains `0`. A failed process-file read discards that
process row. Required cgroup reads must succeed for the command to exit successfully; discard partial
output on a nonzero exit. Each PID is emitted at most once.

Process memory columns are KiB. UID and thread count are integers. Cgroup keys ending in `_bytes`
are bytes; `memory_failcnt` and the fields copied from `memory.stat` retain their kernel-defined
units. In particular, `memory.stat` includes both byte values and event counters.

The collection is not atomic. Processes can exit, be replaced, or change their memory and membership
while files are read. Only direct members of the chosen `cgroup.procs` are enumerated; descendant
cgroups are not walked. Process RSS can count shared pages more than once, whereas PSS apportions
them. Neither sum must equal a cgroup counter, which can include descendants, cache, and kernel
memory. `memory.usage_in_bytes` itself is an approximate kernel counter. The begin/end readings bound
the collection period; they do not measure peak memory during that period.

The [kernel memory controller documentation](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v1/memory.html)
describes counter units and accounting; the [proc documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html)
describes process memory fields. This tool intentionally does not support cgroup v2 or CPU profiling.

Run `scripts/tools/test-linux-memory-snapshot.sh` for deterministic format, missing-data, read-failure,
and large-value checks. These fixtures do not establish memory accounting accuracy on a live host.
