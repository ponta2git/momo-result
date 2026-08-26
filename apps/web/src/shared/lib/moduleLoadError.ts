class LazyModuleLoadError extends Error {
  constructor(cause: unknown) {
    super("A lazy UI module failed to load.", { cause });
    this.name = "LazyModuleLoadError";
  }
}

/** Tags every rejected React.lazy loader independently of browser or bundler error wording. */
export async function loadLazyModule<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    throw new LazyModuleLoadError(error);
  }
}

/** Identifies a tagged React.lazy rejection whose cached payload cannot be reset in place. */
export function isModuleLoadError(error: unknown): boolean {
  return error instanceof LazyModuleLoadError;
}

export function reloadCurrentPage(): void {
  window.location.reload();
}
