import { desc, eq, sql, and } from "drizzle-orm";
import { getDb, closePool } from "../db";
import * as schema from "../db/schema";
import { FscSnapshotParsed } from "../types/fscSnapshotParsed";
import { parseNumber } from "../utils/number";
import fs from "fs";

interface ReportOptions {
  outPath?: string;
}

interface AppliedRow {
  carrier: string;
  program: string;
  weekEndingDate: string;
  tableEffectiveDate: string;
  bracketId: string | null;
  bracketRange: string | null;
  appliedPercent: number;
  fuelPrice: number | null;
  fuelIndex: string | null;
  reason: string;
}

interface UpcomingTable {
  carrier: string;
  program: string | null;
  effectiveDate: string | null;
  sourceId: string;
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${value.toFixed(2)}%`;
}

function formatPrice(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(3)}`;
}

async function loadLatestWeek(): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ week: schema.appliedFsc.weekEndingDate })
    .from(schema.appliedFsc)
    .orderBy(desc(schema.appliedFsc.weekEndingDate))
    .limit(1);
  return rows.length ? rows[0].week : null;
}

async function loadAppliedForWeek(week: string): Promise<AppliedRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.appliedFsc)
    .where(eq(schema.appliedFsc.weekEndingDate, week));

  return rows.map((r) => ({
    carrier: r.carrier,
    program: r.program,
    weekEndingDate: r.weekEndingDate,
    tableEffectiveDate: r.tableEffectiveDate,
    bracketId: r.bracketId,
    bracketRange: r.bracketRange ?? null,
    appliedPercent: parseNumber(r.appliedPercent) ?? 0,
    fuelPrice: parseNumber(r.fuelPrice),
    fuelIndex: r.fuelIndex ?? null,
    reason: r.reason
  }));
}

async function loadPriorApplied(
  carrier: string,
  program: string,
  beforeWeek: string
): Promise<AppliedRow | null> {
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
  if (rows.length) {
    const r = rows[0];
    return {
      carrier: r.carrier,
      program: r.program,
      weekEndingDate: r.weekEndingDate,
      tableEffectiveDate: r.tableEffectiveDate,
      bracketId: r.bracketId,
      bracketRange: r.bracketRange ?? null,
      appliedPercent: parseNumber(r.appliedPercent) ?? 0,
      fuelPrice: parseNumber(r.fuelPrice),
      fuelIndex: r.fuelIndex ?? null,
      reason: r.reason
    };
  }
  return null;
}

async function loadUpcomingTables(refDate: string): Promise<UpcomingTable[]> {
  const db = getDb();
  const rows = await db.execute(
    sql`
      SELECT DISTINCT ON (source_id, table_idx)
        carrier,
        source_id,
        parsed_json,
        table_idx
      FROM (
        SELECT
          s.carrier,
          s.source_id,
          s.parsed_json,
          idx as table_idx,
          (s.parsed_json->'tables'->idx->>'effective_date') as eff
        FROM snapshots s
        CROSS JOIN LATERAL generate_subscripts(s.parsed_json->'tables', 1) idx
      ) q
      WHERE eff IS NOT NULL AND eff > ${refDate}
    `
  );

  const upcoming: UpcomingTable[] = [];
  for (const row of rows.rows) {
    const parsed = row.parsed_json as FscSnapshotParsed;
    const idx = Number(row.table_idx) - 1;
    const table = parsed.tables?.[idx];
    if (!table) continue;
    upcoming.push({
      carrier: parsed.carrier,
      program: table.program ?? null,
      effectiveDate: table.effective_date ?? parsed.effective_date ?? null,
      sourceId: String(row.source_id)
    });
  }
  return upcoming;
}

function buildMarkdown(
  week: string,
  events: { current: AppliedRow; prior: AppliedRow | null }[],
  upcoming: UpcomingTable[]
): string {
  const lines: string[] = [];
  lines.push(`# Weekly Carrier Pricing Events (${week})`);
  lines.push("");
  lines.push("## Events");
  lines.push("");

  for (const { current, prior } of events) {
    const oldCharge = prior ? formatPercent(prior.appliedPercent) : "n/a";
    const newCharge = formatPercent(current.appliedPercent);
    const cause = current.reason;
    const fuelText = `${current.fuelIndex ?? "fuel"} ${formatPrice(current.fuelPrice)}`;
    const bracketText = current.bracketRange ?? current.bracketId ?? "n/a";
    lines.push(
      `- FSC | ${current.carrier} | ${current.program} | Week: ${current.weekEndingDate} | cause: ${cause}`
    );
    lines.push(
      `  - old_charge: ${oldCharge} | new_charge: ${newCharge} | bracket: ${bracketText} | table_eff: ${current.tableEffectiveDate}`
    );
    lines.push(`  - fuel: ${fuelText}`);
    lines.push("");
  }

  if (upcoming.length) {
    lines.push("## Upcoming Changes");
    lines.push("");
    for (const u of upcoming) {
      lines.push(
        `- ${u.carrier} | ${u.program ?? "unknown"} | effective: ${u.effectiveDate ?? "n/a"} | source: ${u.sourceId}`
      );
    }
  }

  return lines.join("\n");
}

export async function runReport(opts: ReportOptions): Promise<void> {
  try {
    const week = await loadLatestWeek();
    if (!week) {
      console.log("No applied FSC data available.");
      return;
    }

    const current = await loadAppliedForWeek(week);
    const events = await Promise.all(
      current.map(async (row) => {
        // find prior week (one week before)
        const prior = await loadPriorApplied(row.carrier, row.program, week);
        return { current: row, prior };
      })
    );

    const upcoming = await loadUpcomingTables(week);
    const md = buildMarkdown(week, events, upcoming);

    if (opts.outPath) {
      await fs.promises.writeFile(opts.outPath, md, "utf8");
      console.log(`Wrote report to ${opts.outPath}`);
    } else {
      console.log(md);
    }
  } finally {
    await closePool().catch(() => undefined);
  }
}
