export function parseNumber(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
