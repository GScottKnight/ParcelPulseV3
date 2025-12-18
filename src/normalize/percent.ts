import { NormalizationWarning } from "./types";

export interface PercentParseResult {
  value: number | null;
  warning?: NormalizationWarning;
}

export function parsePercentText(percentText: string): PercentParseResult {
  const cleaned = percentText.replace(/[%\s,]/g, "");
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) {
    return {
      value: null,
      warning: {
        code: "PERCENT_PARSE_FAILED",
        message: `Could not parse percent: ${percentText}`,
        severity: "warning"
      }
    };
  }
  return { value };
}
