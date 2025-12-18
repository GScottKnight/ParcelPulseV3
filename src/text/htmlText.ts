import * as cheerio from "cheerio";
import { normalizeWhitespace } from "../utils/text";

export function extractVisibleText(html: string): string {
  const $ = cheerio.load(html);

  $("script, style, noscript, svg, head, meta, link").remove();
  $("[aria-hidden='true'], [hidden]").remove();
  $("[style*='display:none'], [style*='display: none']").remove();
  $("[style*='visibility:hidden'], [style*='visibility: hidden']").remove();

  const text = $("body").text() || $.root().text();
  return normalizeWhitespace(text);
}
