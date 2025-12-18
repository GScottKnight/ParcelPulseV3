import path from "path";
import { loadRegistry, getSourceById } from "../config/registry";
import { listFilesRecursive, pathExists, readJson, writeJson, writeJsonLines } from "../utils/fs";
import { normalizeCandidate } from "../normalize/normalizeSnapshot";
import { changesPath } from "../io/paths";
import { findPriorSnapshot } from "../io/priorSnapshot";
import { diffFscSnapshots } from "../diff/delta";
import { CaptureMeta } from "../types/captureMeta";
import { RunManifest } from "../types/runManifest";

export interface ValidateOptions {
  runDir: string;
}

function contentTypeFor(artifactType: "html" | "pdf"): string {
  return artifactType === "html" ? "text/html" : "application/pdf";
}

export async function runValidate(options: ValidateOptions): Promise<void> {
  const manifestPath = path.join(options.runDir, "run_manifest.json");
  const manifest = await readJson<RunManifest>(manifestPath);
  const outDir = path.resolve(manifest.out_dir);
  const registry = await loadRegistry(manifest.registry_path);

  const llmRoot = path.join(options.runDir, "llm");
  if (!(await pathExists(llmRoot))) {
    throw new Error(`LLM directory not found in ${options.runDir}`);
  }

  const responseFiles = await listFilesRecursive(llmRoot, (filePath) =>
    path.basename(filePath) === "extraction_response.json"
  );

  for (const filePath of responseFiles) {
    const relative = path.relative(options.runDir, filePath);
    const parts = relative.split(path.sep);
    if (parts.length < 5 || parts[0] !== "llm") {
      continue;
    }

    const carrier = parts[1];
    const sourceId = parts[2];
    const capturedAt = parts[3];

    const source = getSourceById(registry, sourceId);
    if (!source) {
      throw new Error(`Source ${sourceId} not found in registry`);
    }

    const candidate = await readJson<unknown>(filePath);

    const snapshotOutDir = path.join(
      options.runDir,
      "snapshots",
      carrier,
      sourceId,
      capturedAt
    );
    const metaPath = path.join(snapshotOutDir, "meta.json");
    const meta = await readJson<CaptureMeta>(metaPath);

    const sourceUrl = meta.final_url || source.url;
    if (!sourceUrl) {
      throw new Error(`Missing source URL for ${sourceId} at ${capturedAt}`);
    }

    const normalization = normalizeCandidate(candidate, {
      carrier,
      source_id: sourceId,
      captured_at: capturedAt,
      source_url: sourceUrl,
      content_type: contentTypeFor(source.artifact_type)
    });

    const parsedPath = path.join(snapshotOutDir, "parsed.json");
    await writeJson(parsedPath, normalization.snapshot);

    const validationPath = path.join(path.dirname(filePath), "validation_report.json");
    await writeJson(validationPath, normalization.report);

    if (source.diff_enabled) {
      const prior = await findPriorSnapshot(
        outDir,
        manifest.run_id,
        carrier,
        sourceId,
        capturedAt
      );
      const deltas = diffFscSnapshots(normalization.snapshot, prior?.parsed ?? null);
      const changesFilePath = changesPath(
        outDir,
        manifest.run_id,
        carrier,
        sourceId,
        capturedAt
      );
      await writeJsonLines(changesFilePath, deltas);
    }
  }
}
