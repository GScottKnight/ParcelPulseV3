import { NormalizationWarning } from "./types";

export interface RangeParseResult {
  index_low: number | null;
  index_high: number | null;
  bracket_id: string;
  warning?: NormalizationWarning;
}

const UNICODE_DASH = /[\u2012\u2013\u2014\u2212]/g;

function formatIndex(value: number): string {
  return value.toFixed(2);
}

function fallbackBracketId(rangeText: string): string {
  const cleaned = rangeText
    .replace(UNICODE_DASH, "-")
    .replace(/[$,]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return cleaned || "unknown_range";
}

export function parseRangeText(rangeText: string): RangeParseResult {
  const cleaned = rangeText
    .replace(UNICODE_DASH, "-")
    .replace(/[$,]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  const boundedMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/);
  if (boundedMatch) {
    const low = Number(boundedMatch[1]);
    const high = Number(boundedMatch[2]);
    return {
      index_low: low,
      index_high: high,
      bracket_id: `${formatIndex(low)}_${formatIndex(high)}`
    };
  }

  const openHighMatch = cleaned.match(/(\d+(?:\.\d+)?)(?:\s*\+|\s*and\s+above)/);
  if (openHighMatch) {
    const low = Number(openHighMatch[1]);
    return {
      index_low: low,
      index_high: null,
      bracket_id: `${formatIndex(low)}_plus`
    };
  }

  const openHighGteMatch = cleaned.match(/>=\s*(\d+(?:\.\d+)?)/);
  if (openHighGteMatch) {
    const low = Number(openHighGteMatch[1]);
    return {
      index_low: low,
      index_high: null,
      bracket_id: `${formatIndex(low)}_plus`
    };
  }

  const openLowMatch = cleaned.match(/(?:<|under|less\s+than)\s*(\d+(?:\.\d+)?)/);
  if (openLowMatch) {
    const high = Number(openLowMatch[1]);
    return {
      index_low: null,
      index_high: high,
      bracket_id: `lt_${formatIndex(high)}`
    };
  }

  return {
    index_low: null,
    index_high: null,
    bracket_id: fallbackBracketId(rangeText),
    warning: {
      code: "RANGE_PARSE_FAILED",
      message: `Could not parse range: ${rangeText}`,
      severity: "warning"
    }
  };
}
