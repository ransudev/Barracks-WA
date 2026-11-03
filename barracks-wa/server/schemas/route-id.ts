// Dynamic route segments such as /api/barbers/[id]: a positive PostgreSQL
// integer written in plain digits, or null so the route can answer 400/404.
export function parseRouteId(raw: string): number | null {
  const id = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}
