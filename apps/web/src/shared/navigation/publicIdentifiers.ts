/** Public numbers stay decimal strings, including values above JavaScript's exact integer range. */
export function isPublicId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9][0-9]{0,18}$/u.test(value) &&
    (value.length < 19 || value <= "9223372036854775807")
  );
}

export function matchDetailHref(matchId: string, publicId?: string): string {
  return isPublicId(publicId) ? `/m/${publicId}` : `/matches/${encodeURIComponent(matchId)}`;
}

export function heldEventDetailHref(heldEventId: string, publicId?: string): string {
  return isPublicId(publicId)
    ? `/e/${publicId}`
    : `/held-events/${encodeURIComponent(heldEventId)}`;
}
