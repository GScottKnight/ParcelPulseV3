import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { extractVisibleText } from "../src/text/htmlText";

const fixturesDir = path.join(process.cwd(), "fixtures");

describe("HTML visible text extraction", () => {
  it("extracts normalized visible text", () => {
    const html = readFileSync(path.join(fixturesDir, "ups_fsc.html"), "utf8");
    const text = extractVisibleText(html);

    expect(text).toContain("UPS Ground Fuel Surcharge");
    expect(text).toContain("Effective January 8, 2026");
    expect(text).toContain("$1.50 - $1.99");
  });
});
