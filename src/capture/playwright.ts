import { chromium, Browser, BrowserContext } from "playwright";

export const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
export const DEFAULT_SETTLE_MS = 750;
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
export const DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9";

export async function launchChromium(): Promise<Browser> {
  return chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"]
  });
}

export async function newContext(
  browser: Browser,
  viewport = DEFAULT_VIEWPORT
): Promise<BrowserContext> {
  return browser.newContext({
    viewport,
    userAgent: DEFAULT_USER_AGENT,
    locale: "en-US",
    extraHTTPHeaders: {
      "Accept-Language": DEFAULT_ACCEPT_LANGUAGE
    }
  });
}
