import path from "path";
import { fetchSeries, writeJson } from "../eia/api";

const DEFAULT_DIESEL_SERIES = "PET.EMD_EPD2D_PTE_NUS_DPG.W"; // U.S. No 2 Diesel Retail Prices (Dollars per Gallon), weekly
const DEFAULT_JET_SERIES = "PET.EER_EPJK_PF4_RGC_DPG.W"; // U.S. Gulf Coast Kerosene-Type Jet Fuel Spot Price FOB (Dollars per Gallon), weekly

interface FuelCommandOptions {
  seriesIds: string[];
  outPath?: string;
  start?: string;
  end?: string;
  length?: number;
}

export async function runFuelCommand(options: FuelCommandOptions): Promise<void> {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    throw new Error("EIA_API_KEY is not set in the environment.");
  }

  const seriesIds =
    options.seriesIds.length > 0 ? options.seriesIds : [DEFAULT_DIESEL_SERIES, DEFAULT_JET_SERIES];

  const results: Record<string, unknown> = {};
  for (const seriesId of seriesIds) {
    const rows = await fetchSeries({
      apiKey,
      seriesId,
      start: options.start,
      end: options.end,
      length: options.length
    });
    results[seriesId] = rows;
  }

  if (options.outPath) {
    const outPath = path.resolve(options.outPath);
    await writeJson(outPath, results);
    console.log(`Wrote fuel data to ${outPath}`);
  } else {
    console.log(JSON.stringify(results, null, 2));
  }
}
