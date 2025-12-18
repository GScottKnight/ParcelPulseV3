import path from "path";
import { Browser, Page } from "playwright";
import { CaptureMeta, ViewportSize } from "../types/captureMeta";
import { nowUtcIsoSeconds } from "../utils/time";
import { sha256 } from "../utils/hash";
import { writeBinary, writeJson } from "../utils/fs";
import { DEFAULT_SETTLE_MS, DEFAULT_VIEWPORT, newContext } from "./playwright";

export interface HtmlCaptureOptions {
  browser: Browser;
  url: string;
  outDir: string;
  settleMs?: number;
  viewport?: ViewportSize;
  capturedAt?: string;
  timeoutMs?: number;
  retryOnTimeout?: boolean;
  actions?: (page: Page) => Promise<void>;
}

export interface HtmlCaptureResult {
  meta: CaptureMeta;
  html: string;
  raw_html_path: string;
  screenshot_path: string;
  meta_path: string;
}

async function captureMhtml(page: Page): Promise<string | null> {
  try {
    const session = await page.context().newCDPSession(page);
    const result = await session.send("Page.captureSnapshot", { format: "mhtml" });
    return typeof result?.data === "string" ? result.data : null;
  } catch {
    return null;
  }
}

export async function captureHtml(options: HtmlCaptureOptions): Promise<HtmlCaptureResult> {
  const context = await newContext(options.browser, options.viewport ?? DEFAULT_VIEWPORT);
  const page = await context.newPage();

  try {
    const startTime = Date.now();
    const timeout = options.timeoutMs ?? 60000;
    let response;
    try {
      response = await page.goto(options.url, { waitUntil: "load", timeout });
    } catch (error) {
      if (options.retryOnTimeout && error instanceof Error && /Timeout/i.test(error.message)) {
        response = await page.goto(options.url, { waitUntil: "domcontentloaded", timeout });
      } else {
        throw error;
      }
    }
    const navigationMs = Date.now() - startTime;

    const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    if (settleMs > 0) {
      await page.waitForTimeout(settleMs);
    }

    if (options.actions) {
      await options.actions(page);
      if (settleMs > 0) {
        await page.waitForTimeout(settleMs);
      }
    }

    const html = await page.content();
    const screenshot = await page.screenshot({ fullPage: true });
    const finalUrl = page.url();
    const statusCode = response?.status() ?? null;
    const capturedAt = options.capturedAt ?? nowUtcIsoSeconds();
    const contentHash = sha256(html);

    const userAgent = await page.evaluate(() => navigator.userAgent);
    const meta: CaptureMeta = {
      captured_at: capturedAt,
      final_url: finalUrl,
      status_code: statusCode,
      content_hash_sha256: contentHash,
      viewport: options.viewport ?? DEFAULT_VIEWPORT,
      user_agent: userAgent,
      timings: {
        navigation_ms: navigationMs,
        settle_ms: settleMs,
        total_ms: Date.now() - startTime
      }
    };

    const rawHtmlPath = path.join(options.outDir, "raw.html");
    const screenshotPath = path.join(options.outDir, "screenshot.png");
    const metaPath = path.join(options.outDir, "meta.json");

    await writeBinary(rawHtmlPath, Buffer.from(html, "utf8"));
    await writeBinary(screenshotPath, screenshot);
    await writeJson(metaPath, meta);

    const mhtml = await captureMhtml(page);
    if (mhtml) {
      const mhtmlPath = path.join(options.outDir, "raw.mhtml");
      await writeBinary(mhtmlPath, Buffer.from(mhtml, "utf8"));
    }

    return {
      meta,
      html,
      raw_html_path: rawHtmlPath,
      screenshot_path: screenshotPath,
      meta_path: metaPath
    };
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}
