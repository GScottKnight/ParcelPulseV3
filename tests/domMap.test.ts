import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { buildDomMap } from "../src/dom/domMap";

const fixturesDir = path.join(process.cwd(), "fixtures");

describe("DOM map", () => {
  it("captures headings and tables from UPS fixture", () => {
    const html = readFileSync(path.join(fixturesDir, "ups_fsc.html"), "utf8");
    const domMap = buildDomMap(html);

    expect(domMap).toContain("PAGE_TITLE: UPS Fuel Surcharges");
    expect(domMap).toContain("H2: UPS Ground Fuel Surcharge");
    expect(domMap).toContain("H2: UPS Air Fuel Surcharge");
    expect(domMap).toContain("HEADERS: Fuel Price | Surcharge");
    expect(domMap).toContain("TEXT_NEAR_TABLE_SAMPLE: Effective January 8, 2026");

    const tableLines = domMap.split("\n").filter((line) => line.startsWith("- TABLE"));
    expect(tableLines.length).toBe(2);
  });

  it("captures filtered links from FedEx updates fixture", () => {
    const html = readFileSync(path.join(fixturesDir, "fedex_updates.html"), "utf8");
    const domMap = buildDomMap(html);

    expect(domMap).toContain("Fuel surcharge tables (PDF)");
    expect(domMap).toContain("https://example.com/fedex_fuel_surcharge_table.pdf");
    expect(domMap).toContain("Effective March 3, 2026");

    expect(domMap).toContain("https://example.com/other.pdf");
  });
});
