import { runDir, runManifestPath } from "./paths";
import { writeJson } from "../utils/fs";
import { RunManifest, RunManifestSource } from "../types/runManifest";

export interface RunManifestParams {
  runId: string;
  outDir: string;
  registryPath: string;
  startedAt: string;
  endedAt: string;
  sources: RunManifestSource[];
}

export function buildRunManifest(params: RunManifestParams): RunManifest {
  return {
    schema_version: "1.0",
    run_id: params.runId,
    out_dir: params.outDir,
    run_dir: runDir(params.outDir, params.runId),
    registry_path: params.registryPath,
    started_at: params.startedAt,
    ended_at: params.endedAt,
    sources: params.sources
  };
}

export async function writeRunManifest(manifest: RunManifest): Promise<void> {
  const filePath = runManifestPath(manifest.out_dir, manifest.run_id);
  await writeJson(filePath, manifest);
}
