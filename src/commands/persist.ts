import path from "path";
import { promises as fs } from "fs";
import { eq, and } from "drizzle-orm";
import { getDb, closePool } from "../db";
import * as schema from "../db/schema";
import { RunManifest, RunManifestSource, RunManifestChildArtifact } from "../types/runManifest";
import { FscSnapshotParsed } from "../types/fscSnapshotParsed";

interface PersistOptions {
  runDir: string;
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function resolvePath(baseDir: string, relativePath: string | null): string {
  if (!relativePath) throw new Error("Cannot resolve null path");
  return path.resolve(baseDir, relativePath);
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function insertRun(db: ReturnType<typeof getDb>, manifest: RunManifest): Promise<void> {
  await db
    .insert(schema.runs)
    .values({
      runId: manifest.run_id,
      outDir: manifest.out_dir,
      runDir: manifest.run_dir,
      registryPath: manifest.registry_path,
      startedAt: toDate(manifest.started_at) ?? new Date(),
      endedAt: toDate(manifest.ended_at) ?? new Date()
    })
    .onConflictDoNothing();
}

async function insertRunSource(
  db: ReturnType<typeof getDb>,
  runId: string,
  source: RunManifestSource
): Promise<void> {
  await db
    .insert(schema.runSources)
    .values({
      runId,
      sourceId: source.source_id,
      carrier: source.carrier,
      mode: source.mode,
      status: source.status,
      capturedAt: toDate(source.captured_at),
      snapshotDir: source.snapshot_dir,
      parsedPath: source.parsed_path,
      discoveryPath: source.discovery_path,
      changesPath: source.changes_path,
      error: source.error
    })
    .onConflictDoNothing({
      target: [schema.runSources.runId, schema.runSources.sourceId, schema.runSources.capturedAt]
    });
}

async function insertChildArtifact(
  db: ReturnType<typeof getDb>,
  runId: string,
  parentId: string,
  child: RunManifestChildArtifact
): Promise<void> {
  await db
    .insert(schema.childArtifacts)
    .values({
      runId,
      parentSourceId: parentId,
      sourceId: child.source_id,
      url: child.url,
      capturedAt: toDate(child.captured_at) ?? new Date(),
      snapshotDir: child.snapshot_dir,
      parsedPath: child.parsed_path,
      changesPath: child.changes_path,
      status: child.status,
      effectiveDateHint: child.effective_date_hint,
      error: child.error
    })
    .onConflictDoNothing({
      target: [
        schema.childArtifacts.runId,
        schema.childArtifacts.parentSourceId,
        schema.childArtifacts.sourceId,
        schema.childArtifacts.url,
        schema.childArtifacts.capturedAt
      ]
    });
}

async function insertSnapshotAndTables(
  db: ReturnType<typeof getDb>,
  runId: string,
  sourceId: string,
  capturedAt: string,
  parsed: FscSnapshotParsed
): Promise<void> {
  const capturedAtDate = toDate(capturedAt);
  if (!capturedAtDate) {
    throw new Error(`Invalid captured_at for snapshot ${sourceId}: ${capturedAt}`);
  }

  await db
    .insert(schema.snapshots)
    .values({
      runId,
      sourceId,
      capturedAt: capturedAtDate,
      carrier: parsed.carrier,
      sourceUrl: parsed.source_url,
      contentType: parsed.content_type,
      effectiveDate: parsed.effective_date,
      parserDiagnostics: parsed.parser_diagnostics,
      parsedJson: parsed
    })
    .onConflictDoNothing({
      target: [schema.snapshots.runId, schema.snapshots.sourceId, schema.snapshots.capturedAt]
    });

  // Remove any existing tables/brackets for this snapshot to keep the latest parse.
  await db
    .delete(schema.fscBrackets)
    .where(
      and(
        eq(schema.fscBrackets.runId, runId),
        eq(schema.fscBrackets.sourceId, sourceId),
        eq(schema.fscBrackets.capturedAt, capturedAtDate)
      )
    );
  await db
    .delete(schema.fscTables)
    .where(
      and(
        eq(schema.fscTables.runId, runId),
        eq(schema.fscTables.sourceId, sourceId),
        eq(schema.fscTables.capturedAt, capturedAtDate)
      )
    );

  for (const [tableIndex, table] of parsed.tables.entries()) {
    await db
      .insert(schema.fscTables)
      .values({
        runId,
        sourceId,
        capturedAt: capturedAtDate,
        tableIndex,
        program: table.program,
        effectiveDate: table.effective_date,
        bracketCount: table.brackets.length
      })
      .onConflictDoNothing({
        target: [
          schema.fscTables.runId,
          schema.fscTables.sourceId,
          schema.fscTables.capturedAt,
          schema.fscTables.tableIndex
        ]
      });

    for (const [bracketIndex, bracket] of table.brackets.entries()) {
      await db
        .insert(schema.fscBrackets)
        .values({
          runId,
          sourceId,
          capturedAt: capturedAtDate,
          tableIndex,
          bracketIndex,
          bracketId: bracket.bracket_id,
          indexRange: bracket.index_range,
          minIndex: bracket.min_index,
          maxIndex: bracket.max_index,
          surchargePercent: bracket.surcharge_percent,
          surchargeText: bracket.surcharge_text
        })
        .onConflictDoNothing({
          target: [
            schema.fscBrackets.runId,
            schema.fscBrackets.sourceId,
            schema.fscBrackets.capturedAt,
            schema.fscBrackets.tableIndex,
            schema.fscBrackets.bracketIndex
          ]
        });
    }
  }
}

async function persistRun(options: PersistOptions): Promise<void> {
  const runDir = path.resolve(options.runDir);
  const manifestPath = path.join(runDir, "run_manifest.json");
  const manifest = await readJson<RunManifest>(manifestPath);
  const db = getDb();

  await db.transaction(async (tx) => {
    await insertRun(tx, manifest);

    for (const source of manifest.sources) {
      await insertRunSource(tx, manifest.run_id, source);

      if (source.parsed_path && source.captured_at) {
        const parsedPath = resolvePath(runDir, source.parsed_path);
        const parsed = await readJson<FscSnapshotParsed>(parsedPath);
        await insertSnapshotAndTables(tx, manifest.run_id, source.source_id, source.captured_at, parsed);
      }

      for (const child of source.child_artifacts) {
        await insertChildArtifact(tx, manifest.run_id, source.source_id, child);
        if (child.parsed_path && child.captured_at) {
          const parsedPath = resolvePath(runDir, child.parsed_path);
          const parsed = await readJson<FscSnapshotParsed>(parsedPath);
          await insertSnapshotAndTables(tx, manifest.run_id, child.source_id, child.captured_at, parsed);
        }
      }
    }
  });
}

export async function runPersistCommand(opts: PersistOptions): Promise<void> {
  try {
    await persistRun(opts);
    console.log(`Persisted run at ${opts.runDir} to database.`);
  } finally {
    await closePool().catch(() => undefined);
  }
}
