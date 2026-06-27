/**
 * Returns a date as a LOCAL `YYYY-MM-DD` string.
 *
 * Use this everywhere instead of `new Date().toISOString().slice(0, 10)`:
 * `toISOString()` formats in UTC, so for users east/west of UTC it can yield
 * the wrong calendar day (off-by-one) around midnight. This builds the string
 * from the local-time components instead, avoiding that bug.
 */
export function toDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
