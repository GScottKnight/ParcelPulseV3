import path from "path";
import { promises as fs } from "fs";
import { FscSnapshotParsed } from "../types/fscSnapshotParsed";
import { FscDeltaRecord } from "../types/fscDeltaRecord";
import { listFilesRecursive, pathExists, readJson } from "../utils/fs";
import { nowUtcIsoSeconds } from "../utils/time";
import { assertValidSchema, contractsSchemasDir, getSchemaValidator } from "../validation/jsonSchema";

export type MismatchCategory =
  | "MISSING_IN_LLM"
  | "EXTRA_IN_LLM"
  | "BRACKET_VALUE_MISMATCH"
  | "SCOPE_OR_DATE_MISMATCH";

export interface CompareItem {
  scope: "snapshot" | "delta";
  key: string;
  message: string;
  baseline_path?: string;
  llm_path?: string;
  details?: Record<string, unknown>;
}

export interface CompareReport {
  schema_version: "1.0";
  baseline_dir: string;
  llm_dir: string;
  generated_at: string;
  mismatches: Record<MismatchCategory, CompareItem[]>;
}

interface SnapshotEntry {
  path: string;
  data: FscSnapshotParsed;
}

interface DeltaEntry {
  path: string;
  data: FscDeltaRecord;
}

function snapshotKey(snapshot: FscSnapshotParsed): string {
  return `${snapshot.carrier}::${snapshot.source_id}::${snapshot.captured_at}`;
}

function compareNumbers(a: number | null, b: number | null, tolerance = 0.01): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= tolerance;
}

function buildMismatchReport(): CompareReport["mismatches"] {
  return {
    MISSING_IN_LLM: [],
    EXTRA_IN_LLM: [],
    BRACKET_VALUE_MISMATCH: [],
    SCOPE_OR_DATE_MISMATCH: []
  };
}

async function loadSnapshots(runDir: string): Promise<Map<string, SnapshotEntry>> {
  const snapshotsDir = path.join(runDir, "snapshots");
  if (!(await pathExists(snapshotsDir))) {
    return new Map();
  }
  const files = await listFilesRecursive(snapshotsDir, (filePath) =>
    path.basename(filePath) === "parsed.json"
  );

  const schemaPath = path.join(contractsSchemasDir(), "fsc_snapshot_parsed.schema.json");
  const validator = await getSchemaValidator(schemaPath);

  const map = new Map<string, SnapshotEntry>();
  for (const filePath of files) {
    const data = await readJson<FscSnapshotParsed>(filePath);
    assertValidSchema(validator, data, `Snapshot ${filePath}`);
    map.set(snapshotKey(data), { path: filePath, data });
  }
  return map;
}

async function loadDeltaRecords(runDir: string): Promise<Map<string, DeltaEntry[]>> {
  const changesDir = path.join(runDir, "changes");
  if (!(await pathExists(changesDir))) {
    return new Map();
  }
  const files = await listFilesRecursive(changesDir, (filePath) =>
    path.basename(filePath) === "fsc_delta_records.jsonl"
  );

  const schemaPath = path.join(contractsSchemasDir(), "fsc_delta_record.schema.json");
  const validator = await getSchemaValidator(schemaPath);

  const map = new Map<string, DeltaEntry[]>();
  for (const filePath of files) {
    const content = await readJsonLines(filePath);
    for (const record of content) {
      assertValidSchema(validator, record, `Delta ${filePath}`);
      const entry: DeltaEntry = { path: filePath, data: record };
      const list = map.get(record.group_key) ?? [];
      list.push(entry);
      map.set(record.group_key, list);
    }
  }
  return map;
}

async function readJsonLines(filePath: string): Promise<FscDeltaRecord[]> {
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as FscDeltaRecord;
    } catch {
      throw new Error(`Invalid JSONL at ${filePath}:${index + 1}`);
    }
  });
}

function compareSnapshotPair(
  baseline: SnapshotEntry,
  llm: SnapshotEntry,
  mismatches: CompareReport["mismatches"]
): void {
  const key = snapshotKey(baseline.data);

  if (baseline.data.effective_date !== llm.data.effective_date) {
    mismatches.SCOPE_OR_DATE_MISMATCH.push({
      scope: "snapshot",
      key,
      message: "effective_date mismatch",
      baseline_path: baseline.path,
      llm_path: llm.path,
      details: {
        baseline: baseline.data.effective_date,
        llm: llm.data.effective_date
      }
    });
  }

  const baselineProgramMap = buildProgramBracketMap(baseline.data);
  const llmProgramMap = buildProgramBracketMap(llm.data);
  const baselinePrograms = new Set(baselineProgramMap.keys());
  const llmPrograms = new Set(llmProgramMap.keys());

  for (const program of baselinePrograms) {
    if (!llmPrograms.has(program)) {
      mismatches.SCOPE_OR_DATE_MISMATCH.push({
        scope: "snapshot",
        key,
        message: `program missing in llm: ${program}`,
        baseline_path: baseline.path,
        llm_path: llm.path
      });
    }
  }

  for (const program of llmPrograms) {
    if (!baselinePrograms.has(program)) {
      mismatches.SCOPE_OR_DATE_MISMATCH.push({
        scope: "snapshot",
        key,
        message: `extra program in llm: ${program}`,
        baseline_path: baseline.path,
        llm_path: llm.path
      });
    }
  }

  for (const program of baselinePrograms) {
    if (!llmPrograms.has(program)) continue;

    const baselineBrackets = baselineProgramMap.get(program) ?? new Map();
    const llmBrackets = llmProgramMap.get(program) ?? new Map();

    for (const bracketId of baselineBrackets.keys()) {
      if (!llmBrackets.has(bracketId)) {
        mismatches.SCOPE_OR_DATE_MISMATCH.push({
          scope: "snapshot",
          key,
          message: `bracket missing in llm: ${program} ${bracketId}`,
          baseline_path: baseline.path,
          llm_path: llm.path
        });
      }
    }

    for (const bracketId of llmBrackets.keys()) {
      if (!baselineBrackets.has(bracketId)) {
        mismatches.SCOPE_OR_DATE_MISMATCH.push({
          scope: "snapshot",
          key,
          message: `extra bracket in llm: ${program} ${bracketId}`,
          baseline_path: baseline.path,
          llm_path: llm.path
        });
      }
    }

    for (const [bracketId, baselineBracket] of baselineBrackets.entries()) {
      const llmBracket = llmBrackets.get(bracketId);
      if (!llmBracket) continue;

      if (!compareNumbers(baselineBracket.surcharge_percent, llmBracket.surcharge_percent)) {
        mismatches.BRACKET_VALUE_MISMATCH.push({
          scope: "snapshot",
          key,
          message: `surcharge_percent mismatch for ${program} ${bracketId}`,
          baseline_path: baseline.path,
          llm_path: llm.path,
          details: {
            baseline: baselineBracket.surcharge_percent,
            llm: llmBracket.surcharge_percent
          }
        });
      }
    }
  }
}

function buildProgramBracketMap(
  snapshot: FscSnapshotParsed
): Map<string, Map<string, FscSnapshotParsed["tables"][number]["brackets"][number]>> {
  const map = new Map<string, Map<string, FscSnapshotParsed["tables"][number]["brackets"][number]>>();
  for (const table of snapshot.tables) {
    const programKey = table.program ?? "null";
    const bracketMap = map.get(programKey) ?? new Map();
    for (const bracket of table.brackets) {
      bracketMap.set(bracket.bracket_id, bracket);
    }
    map.set(programKey, bracketMap);
  }
  return map;
}

function compareDeltaGroups(
  baselineGroups: Map<string, DeltaEntry[]>,
  llmGroups: Map<string, DeltaEntry[]>,
  mismatches: CompareReport["mismatches"]
): void {
  const baselineKeys = new Set(baselineGroups.keys());
  const llmKeys = new Set(llmGroups.keys());

  for (const key of baselineKeys) {
    if (!llmKeys.has(key)) {
      mismatches.MISSING_IN_LLM.push({
        scope: "delta",
        key,
        message: "delta group missing in llm"
      });
    }
  }

  for (const key of llmKeys) {
    if (!baselineKeys.has(key)) {
      mismatches.EXTRA_IN_LLM.push({
        scope: "delta",
        key,
        message: "extra delta group in llm"
      });
    }
  }

  for (const key of baselineKeys) {
    if (!llmKeys.has(key)) continue;

    const baselineGroup = baselineGroups.get(key) ?? [];
    const llmGroup = llmGroups.get(key) ?? [];

    if (baselineGroup.length !== llmGroup.length) {
      mismatches.SCOPE_OR_DATE_MISMATCH.push({
        scope: "delta",
        key,
        message: "delta record count mismatch",
        details: {
          baseline: baselineGroup.length,
          llm: llmGroup.length
        }
      });
    }

    const baselineMap = new Map(
      baselineGroup.map((entry) => [entry.data.bracket_id, entry.data])
    );
    const llmMap = new Map(llmGroup.map((entry) => [entry.data.bracket_id, entry.data]));

    for (const bracketId of baselineMap.keys()) {
      if (!llmMap.has(bracketId)) {
        mismatches.SCOPE_OR_DATE_MISMATCH.push({
          scope: "delta",
          key,
          message: `delta bracket missing in llm: ${bracketId}`
        });
      }
    }

    for (const bracketId of llmMap.keys()) {
      if (!baselineMap.has(bracketId)) {
        mismatches.SCOPE_OR_DATE_MISMATCH.push({
          scope: "delta",
          key,
          message: `extra delta bracket in llm: ${bracketId}`
        });
      }
    }

    for (const [bracketId, baselineRecord] of baselineMap.entries()) {
      const llmRecord = llmMap.get(bracketId);
      if (!llmRecord) continue;

      if (!compareNumbers(baselineRecord.old_value, llmRecord.old_value)) {
        mismatches.BRACKET_VALUE_MISMATCH.push({
          scope: "delta",
          key,
          message: `old_value mismatch for ${bracketId}`,
          details: {
            baseline: baselineRecord.old_value,
            llm: llmRecord.old_value
          }
        });
      }

      if (!compareNumbers(baselineRecord.new_value, llmRecord.new_value)) {
        mismatches.BRACKET_VALUE_MISMATCH.push({
          scope: "delta",
          key,
          message: `new_value mismatch for ${bracketId}`,
          details: {
            baseline: baselineRecord.new_value,
            llm: llmRecord.new_value
          }
        });
      }
    }
  }
}

export async function compareRuns(baselineDir: string, llmDir: string): Promise<CompareReport> {
  const mismatches = buildMismatchReport();
  const baselineSnapshots = await loadSnapshots(baselineDir);
  const llmSnapshots = await loadSnapshots(llmDir);

  const baselineKeys = new Set(baselineSnapshots.keys());
  const llmKeys = new Set(llmSnapshots.keys());

  for (const key of baselineKeys) {
    if (!llmKeys.has(key)) {
      mismatches.MISSING_IN_LLM.push({
        scope: "snapshot",
        key,
        message: "snapshot missing in llm",
        baseline_path: baselineSnapshots.get(key)?.path
      });
    }
  }

  for (const key of llmKeys) {
    if (!baselineKeys.has(key)) {
      mismatches.EXTRA_IN_LLM.push({
        scope: "snapshot",
        key,
        message: "extra snapshot in llm",
        llm_path: llmSnapshots.get(key)?.path
      });
    }
  }

  for (const key of baselineKeys) {
    if (!llmKeys.has(key)) continue;
    const baseline = baselineSnapshots.get(key);
    const llm = llmSnapshots.get(key);
    if (!baseline || !llm) continue;
    compareSnapshotPair(baseline, llm, mismatches);
  }

  const baselineDeltas = await loadDeltaRecords(baselineDir);
  const llmDeltas = await loadDeltaRecords(llmDir);
  compareDeltaGroups(baselineDeltas, llmDeltas, mismatches);

  return {
    schema_version: "1.0",
    baseline_dir: baselineDir,
    llm_dir: llmDir,
    generated_at: nowUtcIsoSeconds(),
    mismatches
  };
}
