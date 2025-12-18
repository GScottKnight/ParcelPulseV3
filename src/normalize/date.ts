import { NormalizationWarning } from "./types";

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  sept: "09",
  oct: "10",
  nov: "11",
  dec: "12"
};

export interface DateParseResult {
  value: string | null;
  warning?: NormalizationWarning;
}

export function normalizeDateText(dateText: string | null): DateParseResult {
  if (!dateText) {
    return {
      value: null,
      warning: {
        code: "MISSING_EFFECTIVE_DATE",
        message: "Effective date was missing.",
        severity: "warning"
      }
    };
  }

  const monthPattern =
    /(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}/i;
  const monthMatch = dateText.match(monthPattern);
  if (monthMatch) {
    const cleaned = monthMatch[0].replace(/,/g, "").replace(/\./g, "");
    const parts = cleaned.split(/\s+/);
    if (parts.length >= 3) {
      const month = MONTHS[parts[0].toLowerCase()];
      const day = parts[1].replace(/(st|nd|rd|th)$/i, "").padStart(2, "0");
      const year = parts[2];
      if (month && /^\d{4}$/.test(year)) {
        return { value: `${year}-${month}-${day}` };
      }
    }
  }

  const numericMatch = dateText.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (numericMatch) {
    const month = numericMatch[1].padStart(2, "0");
    const day = numericMatch[2].padStart(2, "0");
    const year = numericMatch[3];
    return { value: `${year}-${month}-${day}` };
  }

  return {
    value: null,
    warning: {
      code: "MISSING_EFFECTIVE_DATE",
      message: `Could not normalize effective date: ${dateText}`,
      severity: "warning"
    }
  };
}
