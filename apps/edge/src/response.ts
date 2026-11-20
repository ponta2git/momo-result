export function failure(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}
