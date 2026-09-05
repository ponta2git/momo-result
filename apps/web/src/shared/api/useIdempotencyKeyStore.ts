import { useState } from "react";

import { createIdempotencyKeyStore } from "@/shared/api/idempotency";
import type { IdempotencyKeyStore } from "@/shared/api/idempotency";

export function useIdempotencyKeyStore(): IdempotencyKeyStore {
  const [store] = useState(createIdempotencyKeyStore);
  return store;
}
