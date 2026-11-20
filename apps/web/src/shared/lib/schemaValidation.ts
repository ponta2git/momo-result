import { parse, safeParse } from "zod";
import { en } from "zod/locales";
import type { $ZodType } from "zod/v4/core";

// Zod Mini omits the detailed fallback messages. Use them at the application boundary,
// along with the ZodError that callers already receive from a throwing parse.
const options = { error: en().localeError };

export function parseSchema<T extends $ZodType>(schema: T, value: unknown) {
  return parse(schema, value, options);
}

export function safeParseSchema<T extends $ZodType>(schema: T, value: unknown) {
  return safeParse(schema, value, options);
}
