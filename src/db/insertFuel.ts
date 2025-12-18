import { getDb } from "./client";
import * as schema from "./schema";
import { FuelPriceRow } from "../eia/api";

export interface InsertFuelPricesOptions {
  rows: FuelPriceRow[];
  requestParams?: Record<string, unknown>;
}

export async function insertFuelPrices(opts: InsertFuelPricesOptions): Promise<void> {
  const db = getDb();
  if (opts.rows.length === 0) return;

  const values: (typeof schema.fuelPricesRaw.$inferInsert)[] = opts.rows.map((row) => ({
    seriesId: row.series_id,
    period: row.period,
    value: String(row.value),
    units: row.units ?? "",
    description: row.series_description ?? row.series_id,
    requestParams: opts.requestParams ?? null
  }));

  await db.insert(schema.fuelPricesRaw).values(values).onConflictDoNothing();
}
