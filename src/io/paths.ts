import path from "path";

export function runDir(outDir: string, runId: string): string {
  return path.join(outDir, runId);
}

export function runManifestPath(outDir: string, runId: string): string {
  return path.join(runDir(outDir, runId), "run_manifest.json");
}

export function captureDir(
  outDir: string,
  runId: string,
  carrier: string,
  sourceId: string,
  capturedAt: string
): string {
  return path.join(runDir(outDir, runId), "capture", carrier, sourceId, capturedAt);
}

export function snapshotDir(
  outDir: string,
  runId: string,
  carrier: string,
  sourceId: string,
  capturedAt: string
): string {
  return path.join(runDir(outDir, runId), "snapshots", carrier, sourceId, capturedAt);
}

export function discoveryPath(
  outDir: string,
  runId: string,
  carrier: string,
  sourceId: string,
  capturedAt: string
): string {
  return path.join(
    runDir(outDir, runId),
    "discovery",
    carrier,
    sourceId,
    capturedAt,
    "discovered_artifacts.json"
  );
}

export function changesPath(
  outDir: string,
  runId: string,
  carrier: string,
  sourceId: string,
  capturedAt: string
): string {
  return path.join(
    runDir(outDir, runId),
    "changes",
    carrier,
    sourceId,
    capturedAt,
    "fsc_delta_records.jsonl"
  );
}

export function llmDir(
  outDir: string,
  runId: string,
  carrier: string,
  sourceId: string,
  capturedAt: string
): string {
  return path.join(runDir(outDir, runId), "llm", carrier, sourceId, capturedAt);
}
