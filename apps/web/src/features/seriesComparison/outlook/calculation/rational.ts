export type Rational = Readonly<{ numerator: bigint; denominator: bigint }>;

export function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function lcm(left: bigint, right: bigint): bigint {
  return (left / gcd(left, right)) * right;
}

export function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new RangeError("A rational denominator cannot be zero.");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return { numerator: (sign * numerator) / divisor, denominator: (sign * denominator) / divisor };
}

export function compareRationals(left: Rational, right: Rational): -1 | 0 | 1 {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function subtractRationals(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

/** BigInt division truncates towards zero; these helpers also handle negative boundaries. */
export function floorDivide(numerator: bigint, positiveDenominator: bigint): bigint {
  if (positiveDenominator <= 0n) throw new RangeError("A positive denominator is required.");
  const quotient = numerator / positiveDenominator;
  return numerator < 0n && numerator % positiveDenominator !== 0n ? quotient - 1n : quotient;
}

export function ceilDivide(numerator: bigint, positiveDenominator: bigint): bigint {
  return -floorDivide(-numerator, positiveDenominator);
}

export function safeInteger(value: number): bigint {
  if (!Number.isSafeInteger(value)) throw new RangeError("An exact safe integer is required.");
  return BigInt(value);
}

/** Input stays decimal text until its exact value and permitted input grid are checked. */
export function parseDecimal(text: string): Rational | null {
  const trimmed = text.trim();
  if (trimmed.length > 64 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(trimmed)) return null;
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[+-]/u, "");
  const [whole = "", fractional = ""] = unsigned.split(".");
  return rational(
    BigInt(`${whole || "0"}${fractional}`) * (negative ? -1n : 1n),
    10n ** BigInt(fractional.length),
  );
}

export function rationalToNumber(value: Rational): number {
  return Number(value.numerator) / Number(value.denominator);
}

/** Decimal display only; rounding is never used by comparison or arrival calculations. */
export function formatRational(value: Rational, digits = 2): string {
  if (!Number.isInteger(digits) || digits < 0 || digits > 12)
    throw new RangeError("Invalid display precision.");
  const scale = 10n ** BigInt(digits);
  const absolute = value.numerator < 0n ? -value.numerator : value.numerator;
  const rounded = (absolute * scale * 2n + value.denominator) / (2n * value.denominator);
  const sign = value.numerator < 0n && rounded !== 0n ? "-" : "";
  if (digits === 0) return `${sign}${rounded}`;
  return `${sign}${rounded / scale}.${String(rounded % scale).padStart(digits, "0")}`;
}
