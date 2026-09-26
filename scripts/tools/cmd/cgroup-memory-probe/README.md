# cgroup memory probe

This command probes Linux cgroup v1 memory isolation. It is not the
production worker bootstrap.

The coordinator must start as root so it can create one temporary memory cgroup and delegate its
`cgroup.procs` file. It then launches a parent under the requested non-root UID/GID. That parent
starts a synchronized allocator, moves the allocator's complete thread group into the cgroup, and
only then releases it with an explicit start byte to touch memory beyond the configured limit. A
closed synchronization pipe without that byte cannot start the allocation. The coordinator rejects
ordinary directories and ineffective or rounded-up limits before starting a child.

The experiment has a 30-second deadline. On timeout, `SIGINT`, or `SIGTERM`, the coordinator stops
the launcher's dedicated process group and attempts to remove its temporary cgroup. An interrupted
or timed-out experiment fails even if some counters were already observed. Forced termination of
the coordinator (such as `SIGKILL`) cannot run cleanup; use a disposable environment for this probe.

`passed: true` requires all of the following evidence in one run:

- the kernel reads back a positive hard limit no greater than the requested limit;
- the non-root parent can write the child to `cgroup.procs`;
- the child is attached before allocation starts;
- the child receives `SIGKILL` while the non-root parent survives;
- both the v1 limit-failure and OOM-kill counters increase; and
- the temporary cgroup is empty and removed afterward.

The harness intentionally supports only the cgroup v1 memory controller currently under test. A
runtime exposing only cgroup v2 must fail closed until a separate v2 implementation and equivalent
evidence exist.

Run unit checks from the Go tools module:

```sh
cd scripts/tools
go test ./...
go vet ./...
```

Linux tests cover the allocator release protocol and cancellation with real child processes and
ordinary temporary files. They do not exercise the kernel's cgroup v1 delegation or OOM behavior;
only a successful disposable runtime probe can supply that evidence.

For an external runtime probe, cross-compile the command into the ignored `out/` directory and
build the adjacent Dockerfile with an immutable candidate image supplied as `ANALYSIS_IMAGE`. Run
the resulting image only in a disposable, secret-free environment. The image starts as root by
design and exits after this single bounded experiment.
