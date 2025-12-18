import { promises as fs } from "fs";
import path from "path";
import { pathExists, readJson } from "../utils/fs";
import { FscSnapshotParsed } from "../types/fscSnapshotParsed";

interface PriorSnapshotResult {
  parsed: FscSnapshotParsed;
  path: string;
}

export async function findPriorSnapshot(
  outDir: string,
  currentRunId: string,
  carrier: string,
  sourceId: string,
  currentCapturedAt: string
): Promise<PriorSnapshotResult | null> {
  let best: PriorSnapshotResult | null = null;
  let bestTime = -Infinity;

  let runDirs: string[] = [];
  try {
    runDirs = await fs.readdir(outDir);
  } catch {
    return null;
  }

  for (const runId of runDirs) {
    if (runId === currentRunId) continue;
    const snapshotRoot = path.join(outDir, runId, "snapshots", carrier, sourceId);
    if (!(await pathExists(snapshotRoot))) continue;

    let capturedDirs: string[] = [];
    try {
      capturedDirs = await fs.readdir(snapshotRoot);
    } catch {
      continue;
    }

    for (const capturedAt of capturedDirs) {
      const parsedPath = path.join(snapshotRoot, capturedAt, "parsed.json");
      if (!(await pathExists(parsedPath))) continue;

      const parsed = await readJson<FscSnapshotParsed>(parsedPath);
      const parsedTime = Date.parse(parsed.captured_at);
      const currentTime = Date.parse(currentCapturedAt);
      if (Number.isNaN(parsedTime) || parsedTime >= currentTime) continue;

      if (parsedTime > bestTime) {
        bestTime = parsedTime;
        best = { parsed, path: parsedPath };
      }
    }
  }

  return best;
}
