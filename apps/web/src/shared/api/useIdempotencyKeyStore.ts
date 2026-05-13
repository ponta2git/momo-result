import { useRef } from "react";

import { createIdempotencyKeyStore } from "@/shared/api/idempotency";
import type { IdempotencyKeyStore } from "@/shared/api/idempotency";

export function useIdempotencyKeyStore(): IdempotencyKeyStore {
  const storeRef = useRef<IdempotencyKeyStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createIdempotencyKeyStore();
  }
  return storeRef.current;
}
