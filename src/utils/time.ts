export function nowUtcIsoSeconds(): string {
  const iso = new Date().toISOString();
  return iso.replace(/\.\d{3}Z$/, "Z");
}

export function nowUtcIsoFileSafe(): string {
  return nowUtcIsoSeconds().replace(/:/g, "-");
}
