import { FscSnapshotParsed } from "../types/fscSnapshotParsed";
import { FscDeltaRecord } from "../types/fscDeltaRecord";

interface BracketRecord {
  bracket_id: string;
  index_range: string;
  surcharge_percent: number | null;
}

interface TableRecord {
  effective_date: string | null;
  brackets: Map<string, BracketRecord>;
}

function buildTableMap(snapshot: FscSnapshotParsed): Map<string | null, TableRecord> {
  const map = new Map<string | null, TableRecord>();
  for (const table of snapshot.tables) {
    const program = table.program ?? null;
    const entry = map.get(program) ?? {
      effective_date: table.effective_date,
      brackets: new Map<string, BracketRecord>()
    };
    entry.effective_date = entry.effective_date ?? table.effective_date;
    for (const bracket of table.brackets) {
      entry.brackets.set(bracket.bracket_id, {
        bracket_id: bracket.bracket_id,
        index_range: bracket.index_range,
        surcharge_percent: bracket.surcharge_percent
      });
    }
    map.set(program, entry);
  }
  return map;
}

function groupKeyFor(carrier: string, program: string | null, effectiveDate: string | null): string {
  const year = effectiveDate ? effectiveDate.slice(0, 4) : "unknown";
  const programKey = program ?? "unknown";
  const dateKey = effectiveDate ?? "unknown";
  return `${year}-fuel_surcharge-${dateKey}-${carrier}-${programKey}`;
}

function isProgramUnknown(program: string | null): boolean {
  return program === null || program === "unknown";
}

function publishabilityReasons(
  program: string | null,
  effectiveDate: string | null,
  structuralError: boolean
): string[] {
  const reasons: string[] = [];
  if (!effectiveDate) reasons.push("EFFECTIVE_DATE_UNKNOWN");
  if (isProgramUnknown(program)) reasons.push("PROGRAM_UNKNOWN");
  if (structuralError) reasons.push("PARSER_STRUCTURAL_ERROR");
  return reasons;
}

export function diffFscSnapshots(
  current: FscSnapshotParsed,
  prior: FscSnapshotParsed | null
): FscDeltaRecord[] {
  const priorMap: Map<string | null, TableRecord> = prior ? buildTableMap(prior) : new Map();
  const currentMap = buildTableMap(current);
  const records: FscDeltaRecord[] = [];

  const programs = new Set<string | null>([
    ...Array.from(currentMap.keys()),
    ...Array.from(priorMap.keys())
  ]);

  for (const program of programs) {
    const currentTable = currentMap.get(program);
    const priorTable = priorMap.get(program);
    if (!currentTable) continue;

    const effectiveDate = currentTable.effective_date ?? priorTable?.effective_date ?? null;
    const bracketIds = new Set<string>([
      ...Array.from(currentTable.brackets.keys()),
      ...Array.from(priorTable?.brackets.keys() ?? [])
    ]);

    for (const bracketId of bracketIds) {
      const currentBracket = currentTable.brackets.get(bracketId);
      const priorBracket = priorTable?.brackets.get(bracketId);
      const oldValue = priorBracket?.surcharge_percent ?? null;
      const newValue = currentBracket?.surcharge_percent ?? null;
      if (oldValue === newValue) continue;

      const reasons = publishabilityReasons(
        program,
        effectiveDate,
        current.parser_diagnostics.structural_error
      );

      records.push({
        schema_version: "1.0",
        carrier: current.carrier,
        source_id: current.source_id,
        captured_at: current.captured_at,
        prior_captured_at: prior?.captured_at ?? null,
        program,
        effective_date: effectiveDate,
        bracket_id: bracketId,
        index_range: currentBracket?.index_range ?? priorBracket?.index_range ?? null,
        old_value: oldValue,
        new_value: newValue,
        group_key: groupKeyFor(current.carrier, program, effectiveDate),
        publishability: {
          is_publishable: reasons.length === 0,
          reasons
        },
        parser_structural_error: current.parser_diagnostics.structural_error
      });
    }
  }

  return records;
}
