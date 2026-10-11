// Startup tasks can create owned resources even after a sibling fails. Never
// enter cleanup until every task has finished recording what it created.
export async function settle<const Tasks extends ReadonlyArray<Promise<unknown>>>(tasks: Tasks) {
  const results = await Promise.allSettled(tasks);
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) throw new AggregateError(failures, "E2E preparation failed.");
  // Every promise has already fulfilled; this preserves the tuple's result types.
  return Promise.all(tasks);
}
