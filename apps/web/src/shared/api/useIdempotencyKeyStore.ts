import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createIdempotencyKeyStore } from "@/shared/api/idempotency";
import type { IdempotencyKeyStore } from "@/shared/api/idempotency";
import { principalRequestSignal } from "@/shared/api/principalRequestScope";

export function useIdempotencyKeyStore(): IdempotencyKeyStore {
  const queryClient = useQueryClient();
  const [store] = useState(() => createIdempotencyKeyStore(principalRequestSignal(queryClient)));
  return store;
}
