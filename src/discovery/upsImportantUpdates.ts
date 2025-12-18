import { Page } from "playwright";

const UPS_ACCORDION_SELECTORS = [
  "[aria-expanded]",
  "button[aria-controls]",
  "summary",
  ".accordion",
  ".accordion__header",
  ".accordion-title"
];

/**
 * Expand the UPS "Important Updates" accordions so the LLM sees all FSC links.
 * Best-effort: clicks every likely accordion trigger and waits briefly after.
 */
export async function expandUpsImportantUpdates(page: Page): Promise<void> {
  for (const selector of UPS_ACCORDION_SELECTORS) {
    const headers = await page.$$(selector);
    for (const header of headers) {
      try {
        await header.click({ timeout: 2000 });
      } catch {
        // best effort
      }
    }
  }
}
