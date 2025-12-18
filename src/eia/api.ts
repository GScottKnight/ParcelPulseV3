import { promises as fs } from "fs";

export interface EiaSeriesRow {
  period: string;
  value: number;
  [key: string]: unknown;
}

export interface FuelPriceRow {
  series_id: string;
  period: string;
  value: number;
  units?: string | null;
  series_description?: string | null;
}

export interface EiaSeriesResponse {
  response: {
    data: EiaSeriesRow[];
    total: number;
    description?: string;
  };
}

export interface FetchSeriesOptions {
  apiKey: string;
  seriesId: string;
  length?: number;
  start?: string;
  end?: string;
}

export async function fetchSeries(options: FetchSeriesOptions): Promise<EiaSeriesRow[]> {
  const params = new URLSearchParams();
  params.set("api_key", options.apiKey);
  params.set("length", String(options.length ?? 500));
  if (options.start) params.set("start", options.start);
  if (options.end) params.set("end", options.end);

  const url = `https://api.eia.gov/v2/seriesid/${encodeURIComponent(options.seriesId)}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EIA request failed: ${res.status} ${res.statusText} - ${text}`);
  }

  const json = (await res.json()) as EiaSeriesResponse;
  if (!json.response || !Array.isArray(json.response.data)) {
    throw new Error("Unexpected EIA response shape");
  }
  return json.response.data;
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function toFuelPriceRows(seriesId: string, rows: EiaSeriesRow[]): FuelPriceRow[] {
  return rows.map((row) => ({
    series_id: seriesId,
    period: String(row.period),
    value: Number(row.value),
    units: typeof row.units === "string" ? row.units : undefined,
    series_description: typeof row["series-description"] === "string" ? row["series-description"] : undefined
  }));
}
