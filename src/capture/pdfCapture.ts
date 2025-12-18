import path from "path";
import { CaptureMeta, CaptureProvenance } from "../types/captureMeta";
import { nowUtcIsoSeconds } from "../utils/time";
import { sha256 } from "../utils/hash";
import { writeBinary, writeJson } from "../utils/fs";

export interface PdfCaptureOptions {
  url: string;
  outDir: string;
  discoveredFrom?: CaptureProvenance | null;
  effectiveDateHint?: string | null;
  capturedAt?: string;
}

export interface PdfCaptureResult {
  meta: CaptureMeta;
  pdf_path: string;
  meta_path: string;
}

export async function capturePdf(options: PdfCaptureOptions): Promise<PdfCaptureResult> {
  const startTime = Date.now();
  const response = await fetch(options.url);
  if (!response.ok) {
    throw new Error(`PDF fetch failed (${response.status}) for ${options.url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentHash = sha256(buffer);
  const capturedAt = options.capturedAt ?? nowUtcIsoSeconds();

  const meta: CaptureMeta = {
    captured_at: capturedAt,
    final_url: response.url,
    status_code: response.status,
    content_hash_sha256: contentHash,
    timings: {
      total_ms: Date.now() - startTime
    },
    discovered_from: options.discoveredFrom ?? null,
    effective_date_hint: options.effectiveDateHint ?? null
  };

  const pdfPath = path.join(options.outDir, "raw.pdf");
  const metaPath = path.join(options.outDir, "meta.json");

  await writeBinary(pdfPath, buffer);
  await writeJson(metaPath, meta);

  return {
    meta,
    pdf_path: pdfPath,
    meta_path: metaPath
  };
}
