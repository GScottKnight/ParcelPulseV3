import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { extractPdfText } from "../src/text/pdfText";

const fixturesDir = path.join(process.cwd(), "fixtures");

describe("PDF text extraction", () => {
  it("extracts text from PDF fixture", async () => {
    const buffer = readFileSync(path.join(fixturesDir, "fedex_fsc.pdf"));
    const text = await extractPdfText(buffer);

    expect(text.length).toBeGreaterThan(20);
    expect(text).toMatch(/\d/);
  });
});
