import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { normalizeWhitespace, truncate } from "../utils/text";

const MAX_HEADINGS = 50;
const MAX_TABLES = 15;
const MAX_LINKS = 50;
const FIELD_MAX = 300;
const TABLE_TEXT_MAX = 200;
const LINK_NEAR_TEXT_MAX = 120;

interface HeadingEntry {
  level: string;
  text: string;
}

function textFromElement(element: cheerio.Cheerio<AnyNode>): string {
  return normalizeWhitespace(element.text());
}

function limit(text: string, max: number): string {
  return truncate(text, max);
}

function findNearestHeading($table: cheerio.Cheerio<AnyNode>): string {
  const heading = $table.prevAll("h1,h2,h3,h4").first();
  return limit(textFromElement(heading), FIELD_MAX);
}

function extractHeaders($: cheerio.CheerioAPI, $table: cheerio.Cheerio<AnyNode>): string {
  const headerRow = $table.find("thead tr").first();
  const headerCells = headerRow.find("th,td");
  const fallbackRow = $table.find("tr").first();
  const cells = headerCells.length ? headerCells : fallbackRow.find("th,td");
  const headers = cells
    .toArray()
    .map((cell) => limit(textFromElement($(cell)), FIELD_MAX))
    .filter((text) => text.length > 0);
  return headers.join(" | ");
}

function extractRowSamples($: cheerio.CheerioAPI, $table: cheerio.Cheerio<AnyNode>): string[] {
  const rows = $table.find("tr").toArray();
  if (!rows.length) return [];

  const firstRow = $(rows[0]);
  const hasHeaderRow =
    firstRow.find("th").length > 0 || $table.find("thead").length > 0;
  const startIndex = hasHeaderRow ? 1 : 0;
  const sampleRows = rows.slice(startIndex, startIndex + 5);

  return sampleRows
    .map((row) => {
      const cells = $(row).find("th,td");
      const values = cells
        .toArray()
        .map((cell) => limit(textFromElement($(cell)), FIELD_MAX))
        .filter((text) => text.length > 0);
      return values.join(" | ");
    })
    .filter((row) => row.length > 0);
}

function extractNearTableText($table: cheerio.Cheerio<AnyNode>): string {
  const previous = $table.prevAll().first();
  let text = textFromElement(previous);
  if (!text) {
    const next = $table.nextAll().first();
    text = textFromElement(next);
  }
  return limit(text, TABLE_TEXT_MAX);
}

function linkFilter(linkText: string, href: string): boolean {
  const text = linkText.toLowerCase();
  const hrefLower = href.toLowerCase();
  const hrefBase = hrefLower.split(/[?#]/)[0];
  if (hrefBase.endsWith(".pdf")) return true;

  const keywords = ["fuel", "surcharge", "table", "effective", "rate", "pdf"];
  return keywords.some((keyword) => text.includes(keyword));
}

function extractNearLinkText($link: cheerio.Cheerio<AnyNode>, linkText: string): string {
  const parentText = normalizeWhitespace($link.parent().text());
  let nearText = parentText;
  if (linkText) {
    nearText = normalizeWhitespace(parentText.replace(linkText, ""));
  }
  if (!nearText) nearText = linkText;
  return limit(nearText, LINK_NEAR_TEXT_MAX);
}

export function buildDomMap(html: string): string {
  const $ = cheerio.load(html);

  const titleText = limit(normalizeWhitespace($("title").first().text()), FIELD_MAX);
  const headings: HeadingEntry[] = $("h1,h2,h3,h4")
    .toArray()
    .slice(0, MAX_HEADINGS)
    .map((node) => {
      const element = $(node);
      const level = node.tagName ? node.tagName.toUpperCase() : "H";
      return {
        level,
        text: limit(textFromElement(element), FIELD_MAX)
      };
    })
    .filter((entry) => entry.text.length > 0);

  const tables = $("table").toArray().slice(0, MAX_TABLES);

  const links = $("a")
    .toArray()
    .map((node) => $(node))
    .map((link) => {
      const href = link.attr("href")?.trim() ?? "";
      const text = limit(textFromElement(link), FIELD_MAX);
      if (!href || !linkFilter(text, href)) return null;
      return {
        href: limit(href, FIELD_MAX),
        text,
        nearText: extractNearLinkText(link, text)
      };
    })
    .filter((entry): entry is { href: string; text: string; nearText: string } => Boolean(entry))
    .slice(0, MAX_LINKS);

  const lines: string[] = [];
  lines.push(`PAGE_TITLE: ${titleText || ""}`);
  lines.push("HEADINGS:");
  for (const heading of headings) {
    lines.push(`- ${heading.level}: ${heading.text}`);
  }

  lines.push("TABLES:");
  tables.forEach((tableNode, index) => {
    const table = $(tableNode);
    const nearHeading = findNearestHeading(table);
    const headers = extractHeaders($, table);
    const rows = extractRowSamples($, table);
    const nearText = extractNearTableText(table);

    lines.push(`- TABLE ${index + 1}`);
    lines.push(`  NEAR_HEADING: ${nearHeading || ""}`);
    lines.push(`  HEADERS: ${headers || ""}`);
    lines.push("  ROWS_SAMPLE:");
    for (const row of rows) {
      lines.push(`    - ${row}`);
    }
    lines.push(`  TEXT_NEAR_TABLE_SAMPLE: ${nearText || ""}`);
  });

  lines.push("LINKS:");
  for (const link of links) {
    lines.push(`- TEXT: ${link.text || ""}`);
    lines.push(`  HREF: ${link.href}`);
    lines.push(`  NEAR_TEXT: ${link.nearText || ""}`);
  }

  return lines.join("\n");
}
