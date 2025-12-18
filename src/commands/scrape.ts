import path from "path";
import { promises as fs } from "fs";
import { loadRegistry, getSourceById } from "../config/registry";
import { SourceConfig } from "../config/sourceRegistry";
import { buildRunManifest, writeRunManifest } from "../io/runManifest";
import { runDir, captureDir, snapshotDir, discoveryPath, changesPath, llmDir } from "../io/paths";
import { findPriorSnapshot } from "../io/priorSnapshot";
import { buildDiscoveredArtifacts } from "../discovery/discoveredArtifacts";
import { captureHtml, HtmlCaptureOptions } from "../capture/htmlCapture";
import { capturePdf } from "../capture/pdfCapture";
import { launchChromium } from "../capture/playwright";
import { buildDomMap } from "../dom/domMap";
import { extractVisibleText } from "../text/htmlText";
import { extractPdfText } from "../text/pdfText";
import { runLlmExtraction } from "../llm/extract";
import { OpenAiProvider } from "../llm/openai";
import { normalizeCandidate } from "../normalize/normalizeSnapshot";
import { diffFscSnapshots } from "../diff/delta";
import { copyFile, ensureDir, writeJson, writeJsonLines } from "../utils/fs";
import { nowUtcIsoSeconds } from "../utils/time";
import { CaptureMeta } from "../types/captureMeta";
import { RunManifestChildArtifact, RunManifestSource } from "../types/runManifest";
import { expandUpsImportantUpdates } from "../discovery/upsImportantUpdates";
import { Page } from "playwright";

export interface ScrapeOptions {
  registryPath: string;
  outDir: string;
  runId: string;
  model: string;
  apiKeyEnv: string;
}

interface ArtifactProcessResult {
  capturedAt: string;
  captureMeta: CaptureMeta;
  snapshotDir: string;
  parsedPath: string;
  changesPath: string | null;
  llmDir: string;
  candidate: unknown;
}

interface DiscoveryProcessResult {
  capturedAt: string;
  discoveryPath: string;
  artifacts: { url: string; effective_date: string | null }[];
}

async function showUpsCurrentTables(page: Page): Promise<void> {
  const accept = await page.$("#onetrust-accept-btn-handler");
  if (accept) {
    try {
      await accept.click({ timeout: 2000 });
    } catch {
      // best effort
    }
  }

  const anchorSelectors = ['a[href="#link2"]', 'a[href="#link3"]', 'a[href="#link4"]'];
  for (const selector of anchorSelectors) {
    const anchor = await page.$(selector);
    if (!anchor) continue;
    try {
      await anchor.click({ timeout: 3000 });
    } catch {
      // best effort
    }
  }

  await page.waitForSelector("#link2 table tr", { timeout: 20000 }).catch(() => undefined);
  await page.waitForSelector("#link3 table tr", { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(2000);
}

function carrierToLlm(carrier: string): "UPS" | "FedEx" {
  const lower = carrier.toLowerCase();
  if (lower === "ups") return "UPS";
  if (lower === "fedex") return "FedEx";
  throw new Error(`Unsupported carrier: ${carrier}`);
}

function contentTypeFor(artifactType: "html" | "pdf"): string {
  return artifactType === "html" ? "text/html" : "application/pdf";
}

function relativeToRun(runDirPath: string, targetPath: string): string {
  return path.relative(runDirPath, targetPath);
}

async function copyCaptureToSnapshot(
  captureMeta: CaptureMeta,
  captureOutDir: string,
  snapshotOutDir: string,
  artifactType: "html" | "pdf"
): Promise<void> {
  const rawName = artifactType === "html" ? "raw.html" : "raw.pdf";
  await copyFile(path.join(captureOutDir, rawName), path.join(snapshotOutDir, rawName));
  await writeJson(path.join(snapshotOutDir, "meta.json"), captureMeta);
}

async function processArtifact(
  source: SourceConfig,
  url: string,
  options: {
    outDir: string;
    runId: string;
    model: string;
    provider: OpenAiProvider;
    browser: Awaited<ReturnType<typeof launchChromium>>;
    discoveredFrom?: { source_id: string; captured_at: string; content_hash: string } | null;
    effectiveDateHint?: string | null;
    capturedAt?: string;
    timeoutMs?: number;
    htmlActions?: HtmlCaptureOptions["actions"];
  }
): Promise<ArtifactProcessResult> {
  const capturedAt = options.capturedAt ?? nowUtcIsoSeconds();
  const captureOutDir = captureDir(options.outDir, options.runId, source.carrier, source.id, capturedAt);
  const snapshotOutDir = snapshotDir(options.outDir, options.runId, source.carrier, source.id, capturedAt);
  const llmOutDir = llmDir(options.outDir, options.runId, source.carrier, source.id, capturedAt);

  let captureMeta: CaptureMeta;
  let artifactText = "";
  let domMap: string | null = null;

  if (source.artifact_type === "html") {
    const capture = await captureHtml({
      browser: options.browser,
      url,
      outDir: captureOutDir,
      capturedAt,
      timeoutMs: options.timeoutMs,
      retryOnTimeout: true,
      actions: options.htmlActions
    });
    captureMeta = capture.meta;
    domMap = buildDomMap(capture.html);
    artifactText = extractVisibleText(capture.html);
  } else {
    const capture = await capturePdf({
      url,
      outDir: captureOutDir,
      capturedAt,
      discoveredFrom: options.discoveredFrom ?? null,
      effectiveDateHint: options.effectiveDateHint ?? null
    });
    captureMeta = capture.meta;
    const buffer = await fs.readFile(capture.pdf_path);
    artifactText = await extractPdfText(buffer);
  }

  await ensureDir(snapshotOutDir);
  await copyCaptureToSnapshot(captureMeta, captureOutDir, snapshotOutDir, source.artifact_type);

  const extraction = await runLlmExtraction({
    provider: options.provider,
    model: options.model,
    carrier: carrierToLlm(source.carrier),
    sourceId: source.id,
    artifactType: source.artifact_type,
    artifactText,
    domMap,
    outDir: llmOutDir
  });

  const normalization = normalizeCandidate(extraction.candidate, {
    carrier: source.carrier,
    source_id: source.id,
    captured_at: capturedAt,
    source_url: captureMeta.final_url,
    content_type: contentTypeFor(source.artifact_type)
  });

  const parsedPath = path.join(snapshotOutDir, "parsed.json");
  await writeJson(parsedPath, normalization.snapshot);
  await writeJson(path.join(llmOutDir, "validation_report.json"), normalization.report);

  let changePath: string | null = null;
  if (source.diff_enabled) {
    const prior = await findPriorSnapshot(
      options.outDir,
      options.runId,
      source.carrier,
      source.id,
      capturedAt
    );
    const deltas = diffFscSnapshots(normalization.snapshot, prior?.parsed ?? null);
    const changesFilePath = changesPath(
      options.outDir,
      options.runId,
      source.carrier,
      source.id,
      capturedAt
    );
    await writeJsonLines(changesFilePath, deltas);
    changePath = changesFilePath;
  }

  return {
    capturedAt,
    captureMeta,
    snapshotDir: snapshotOutDir,
    parsedPath,
    changesPath: changePath,
    llmDir: llmOutDir,
    candidate: extraction.candidate
  };
}

export async function runScrape(options: ScrapeOptions): Promise<void> {
  const apiKey = process.env[options.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing API key in env var ${options.apiKeyEnv}`);
  }

  const registryPath = path.resolve(options.registryPath);
  const outDir = path.resolve(options.outDir);
  const registry = await loadRegistry(registryPath);
  const runRoot = runDir(outDir, options.runId);
  await ensureDir(runRoot);

  const provider = new OpenAiProvider({ apiKey });
  const browser = await launchChromium();
  const startedAt = nowUtcIsoSeconds();
  const sources: RunManifestSource[] = [];

  try {
    for (const source of registry.sources) {
      if (source.discovered_only) continue;
      const sourceResult: RunManifestSource = {
        source_id: source.id,
        carrier: source.carrier,
        mode: source.mode,
        status: "success",
        captured_at: null,
        snapshot_dir: null,
        parsed_path: null,
        discovery_path: null,
        changes_path: null,
        error: null,
        child_artifacts: []
      };

      try {
        if (!source.url) {
          throw new Error(`Source ${source.id} is missing a URL`);
        }

        const htmlActions =
          source.mode === "DISCOVERY" && source.parser_id === "ups_updates_v1"
            ? expandUpsImportantUpdates
            : source.id === "ups_current_fuel_surcharge"
              ? showUpsCurrentTables
              : undefined;

        const artifact = await processArtifact(source, source.url, {
          outDir,
          runId: options.runId,
          model: options.model,
          provider,
          browser,
          timeoutMs: 60000,
          htmlActions
        });

        sourceResult.captured_at = artifact.capturedAt;
        sourceResult.snapshot_dir = relativeToRun(runRoot, artifact.snapshotDir);
        sourceResult.parsed_path = relativeToRun(runRoot, artifact.parsedPath);
        sourceResult.changes_path = artifact.changesPath ? relativeToRun(runRoot, artifact.changesPath) : null;

        if (source.mode === "DISCOVERY") {
          const childSourceId = source.child_source_id;
          if (!childSourceId) {
            throw new Error(`Discovery source ${source.id} missing child_source_id`);
          }

          const childSource = getSourceById(registry, childSourceId);
          if (!childSource) {
            throw new Error(`Child source ${childSourceId} not found in registry`);
          }

          const discovered = buildDiscoveredArtifacts({
            candidate: artifact.candidate,
            carrier: source.carrier,
            sourceId: source.id,
            capturedAt: artifact.capturedAt,
            childSourceId,
            baseUrl: artifact.captureMeta.final_url,
            pdfOnly: childSource.artifact_type === "pdf"
          });

          const discoveryFilePath = discoveryPath(
            outDir,
            options.runId,
            source.carrier,
            source.id,
            artifact.capturedAt
          );
          await writeJson(discoveryFilePath, discovered.discovered);
          sourceResult.discovery_path = relativeToRun(runRoot, discoveryFilePath);

          for (const link of discovered.links) {
            const childCapturedAt = nowUtcIsoSeconds();
            const childSnapshotDir = snapshotDir(
              outDir,
              options.runId,
              childSource.carrier,
              childSource.id,
              childCapturedAt
            );

            const childResult: RunManifestChildArtifact = {
              source_id: childSourceId,
              url: link.url,
              captured_at: childCapturedAt,
              snapshot_dir: relativeToRun(runRoot, childSnapshotDir),
              parsed_path: null,
              changes_path: null,
              status: "success",
              error: null,
              effective_date_hint: link.effective_date
            };

            try {
              const childArtifact = await processArtifact(childSource, link.url, {
                outDir,
                runId: options.runId,
                model: options.model,
                provider,
                browser,
                discoveredFrom: {
                  source_id: source.id,
                  captured_at: artifact.capturedAt,
                  content_hash: artifact.captureMeta.content_hash_sha256
                },
                effectiveDateHint: link.effective_date,
                capturedAt: childCapturedAt,
                timeoutMs: 60000
              });

              childResult.captured_at = childArtifact.capturedAt;
              childResult.snapshot_dir = relativeToRun(runRoot, childArtifact.snapshotDir);
              childResult.parsed_path = relativeToRun(runRoot, childArtifact.parsedPath);
              childResult.changes_path = childArtifact.changesPath
                ? relativeToRun(runRoot, childArtifact.changesPath)
                : null;
            } catch (error) {
              childResult.status = "error";
              childResult.error = {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
              };
            }

            sourceResult.child_artifacts.push(childResult);
          }
        }
      } catch (error) {
        sourceResult.status = "error";
        sourceResult.error = {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        };
      }

      sources.push(sourceResult);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const endedAt = nowUtcIsoSeconds();
  const manifest = buildRunManifest({
    runId: options.runId,
    outDir,
    registryPath,
    startedAt,
    endedAt,
    sources
  });

  await writeRunManifest(manifest);
}
