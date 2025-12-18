import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, closePool } from "../db";
import * as schema from "../db/schema";
import { FscSnapshotParsed, ParsedBracket, ParsedTable } from "../types/fscSnapshotParsed";

type FuelKind = "diesel" | "jet";

const DIESEL_SERIES = "PET.EMD_EPD2D_PTE_NUS_DPG.W";
const JET_SERIES = "PET.EER_EPJK_PF4_RGC_DPG.W";

interface FuelPrice {
  seriesId: string;
  period: string; // YYYY-MM-DD
  value: number;
  kind: FuelKind;
}

interface TableCandidate {
  carrier: string;
  program: string | null;
  effectiveDate: string | null;
  tableIndex: number;
  brackets: ParsedBracket[];
}

interface AppliedResult {
  carrier: string;
  program: string;
  weekEndingDate: string;
  tableEffectiveDate: string;
  bracketId: string | null;
  bracketRange: string | null;
  appliedPercent: number;
  fuelPrice: number;
  fuelIndex: string;
  reason: "table_change" | "fuel_tier_change" | "both" | "no_change" | "new";
  sourceRunId: string | null;
}

function parseNumber(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isFuelMatch(kind: FuelKind, program: string | null): boolean {
  if (!program) return false;
  const p = program.toLowerCase();
  if (kind === "diesel") return p === "ground";
  if (kind === "jet") return p === "air";
  return false;
}

function compareDates(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return new Date(a).getTime() - new Date(b).getTime();
}

async function loadLatestFuelPrices(): Promise<FuelPrice[]> {
  const db = getDb();
  const rows = await db
    .select({
      seriesId: schema.fuelPricesRaw.seriesId,
      period: schema.fuelPricesRaw.period,
      value: schema.fuelPricesRaw.value
    })
    .from(schema.fuelPricesRaw)
    .where(
      sql`${schema.fuelPricesRaw.period} IN (
        SELECT period FROM ${schema.fuelPricesRaw} WHERE series_id = ${DIESEL_SERIES} ORDER BY period DESC LIMIT 1
      ) AND ${schema.fuelPricesRaw.seriesId} = ${DIESEL_SERIES} OR
           ${schema.fuelPricesRaw.period} IN (
             SELECT period FROM ${schema.fuelPricesRaw} WHERE series_id = ${JET_SERIES} ORDER BY period DESC LIMIT 1
           ) AND ${schema.fuelPricesRaw.seriesId} = ${JET_SERIES}`
    )
    .orderBy(desc(schema.fuelPricesRaw.period));

  return rows
    .map((row) => {
      const val = parseNumber(row.value);
      if (val === null) return null;
      const kind: FuelKind = row.seriesId === DIESEL_SERIES ? "diesel" : "jet";
      return { seriesId: row.seriesId, period: row.period, value: val, kind };
    })
    .filter((r): r is FuelPrice => r !== null);
}

async function loadLatestSnapshots(): Promise<
  {
    carrier: string;
    sourceId: string;
    capturedAt: string;
    parsed: FscSnapshotParsed;
    runId: string | null;
  }[]
> {
  const db = getDb();
  // Latest snapshot per source_id
  const rows = await db.execute(
    sql`
      SELECT DISTINCT ON (source_id)
        source_id,
        carrier,
        captured_at,
        parsed_json,
        run_id
      FROM snapshots
      ORDER BY source_id, captured_at DESC
    `
  );

  return rows.rows
    .map((row: any) => {
      try {
        return {
          carrier: String(row.carrier),
          sourceId: String(row.source_id),
          capturedAt: String(row.captured_at),
          parsed: row.parsed_json as FscSnapshotParsed,
          runId: row.run_id ? String(row.run_id) : null
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

function pickApplicableTable(
  tables: TableCandidate[],
  week: string,
  carrier: string,
  program: string
): TableCandidate | null {
  const candidates = tables
    .filter(
      (t) =>
        t.carrier.toLowerCase() === carrier.toLowerCase() &&
        (t.program ?? "").toLowerCase() === program.toLowerCase() &&
        t.effectiveDate &&
        compareDates(t.effectiveDate, week) <= 0
    )
    .sort((a, b) => compareDates(b.effectiveDate, a.effectiveDate));

  return candidates[0] ?? null;
}

function selectBracket(brackets: ParsedBracket[], price: number): ParsedBracket | null {
  for (const bracket of brackets) {
    const min = bracket.min_index ?? Number.NEGATIVE_INFINITY;
    const max = bracket.max_index ?? Number.POSITIVE_INFINITY;
    if (price >= min && price < max + 1e-9) {
      return bracket;
    }
  }
  return null;
}

async function loadPriorApplied(
  carrier: string,
  program: string,
  beforeWeek: string
): Promise<AppliedResult | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.appliedFsc)
    .where(
      and(
        eq(schema.appliedFsc.carrier, carrier),
        eq(schema.appliedFsc.program, program),
        sql`${schema.appliedFsc.weekEndingDate} < ${beforeWeek}`
      )
    )
    .orderBy(desc(schema.appliedFsc.weekEndingDate))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    carrier: r.carrier,
    program: r.program,
    weekEndingDate: r.weekEndingDate,
    tableEffectiveDate: r.tableEffectiveDate,
    bracketId: r.bracketId,
    bracketRange: r.bracketRange ?? null,
    appliedPercent: parseNumber(r.appliedPercent) ?? 0,
    fuelPrice: parseNumber(r.fuelPrice) ?? 0,
    fuelIndex: r.fuelIndex ?? "",
    reason: r.reason as AppliedResult["reason"],
    sourceRunId: r.sourceRunId ?? null
  };
}

async function insertApplied(results: AppliedResult[]): Promise<void> {
  if (results.length === 0) return;
  const db = getDb();
  const rows: (typeof schema.appliedFsc.$inferInsert)[] = results.map((r) => ({
    carrier: r.carrier,
    program: r.program,
    weekEndingDate: r.weekEndingDate,
    tableEffectiveDate: r.tableEffectiveDate,
    bracketId: r.bracketId,
    bracketRange: r.bracketRange,
    appliedPercent: String(r.appliedPercent),
    fuelPrice: String(r.fuelPrice),
    fuelIndex: r.fuelIndex,
    reason: r.reason,
    sourceRunId: r.sourceRunId ?? null
  }));

  await db.insert(schema.appliedFsc).values(rows).onConflictDoNothing();
}

export async function runApplyFsc(): Promise<void> {
  try {
    const fuels = await loadLatestFuelPrices();
    const snapshots = await loadLatestSnapshots();

    // Flatten tables
    const tables: TableCandidate[] = [];
    for (const snap of snapshots) {
      if (!snap.parsed.tables) continue;
      for (const [idx, table] of snap.parsed.tables.entries()) {
        tables.push({
          carrier: snap.parsed.carrier,
          program: table.program ?? snap.parsed.carrier,
          effectiveDate: table.effective_date ?? snap.parsed.effective_date,
          tableIndex: idx,
          brackets: table.brackets
        });
      }
    }

    const results: AppliedResult[] = [];

    for (const fuel of fuels) {
      const program = fuel.kind === "diesel" ? "ground" : "air";
      for (const carrier of ["UPS", "FedEx"]) {
        const table = pickApplicableTable(tables, fuel.period, carrier, program);
        if (!table) continue;
        const bracket = selectBracket(table.brackets, fuel.value);
        if (!bracket) continue;

        const prior = await loadPriorApplied(carrier, program, fuel.period);
        let reason: AppliedResult["reason"] = "new";
        if (prior) {
          const tableChanged = prior.tableEffectiveDate !== (table.effectiveDate ?? "");
          const bracketChanged = prior.bracketId !== bracket.bracket_id;
          if (tableChanged && bracketChanged) reason = "both";
          else if (tableChanged) reason = "table_change";
          else if (bracketChanged) reason = "fuel_tier_change";
          else reason = "no_change";
        }

        results.push({
          carrier,
          program,
          weekEndingDate: fuel.period,
          tableEffectiveDate: table.effectiveDate ?? "",
          bracketId: bracket.bracket_id ?? null,
          bracketRange: bracket.index_range ?? null,
          appliedPercent: bracket.surcharge_percent ?? 0,
          fuelPrice: fuel.value,
          fuelIndex: fuel.seriesId,
          reason,
          sourceRunId: snapshots[0]?.runId ?? null
        });
      }
    }

    await insertApplied(results);
    console.log(`Applied FSC computed for ${results.length} carrier/program pairs.`);
  } finally {
    await closePool().catch(() => undefined);
  }
}
