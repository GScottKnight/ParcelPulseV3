import pdfParse from "pdf-parse";
import { normalizeWhitespace } from "../utils/text";

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return normalizeWhitespace(result.text || "");
}
