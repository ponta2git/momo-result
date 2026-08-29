type ContractError = {
  instancePath?: string;
  keyword?: string;
  params?: Record<string, unknown>;
};

export type ContractValidator = ((value: unknown) => boolean) & {
  errors?: ContractError[] | null;
};

export type ContractValidatorLoader = () => Promise<ContractValidator> | ContractValidator;

const validatorPromises = new Map<string, Promise<ContractValidator>>();

function validator(
  key: string,
  loadValidator: ContractValidatorLoader,
): Promise<ContractValidator> {
  const existing = validatorPromises.get(key);
  if (existing) return existing;

  const loading = Promise.resolve().then(loadValidator);
  const retryable = loading.catch((error: unknown) => {
    if (validatorPromises.get(key) === retryable) validatorPromises.delete(key);
    throw error;
  });
  validatorPromises.set(key, retryable);
  return retryable;
}

export async function decodeSeriesAnalysisContract<T>(
  key: string,
  responseName: string,
  loadValidator: ContractValidatorLoader,
  value: unknown,
): Promise<T> {
  const validate = await validator(key, loadValidator);
  if (!validate(value)) {
    const firstError = validate.errors?.[0];
    const location = firstError?.instancePath || "/";
    const keyword = firstError?.keyword ?? "unknown";
    const params = firstError?.params;
    const property = params
      ? (["missingProperty", "additionalProperty"] as const)
          .map((name) => params[name])
          .find((candidate) => typeof candidate === "string")
      : undefined;
    const propertyDetail = property ? `:${property}` : "";
    throw new Error(
      `Invalid series analysis ${responseName} response. Contract violation at ${location} (${keyword}${propertyDetail}).`,
    );
  }
  return value as T;
}
