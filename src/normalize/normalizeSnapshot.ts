import {
  CandidateFscExtraction,
  CandidateFscExtractionSchema,
  CandidateWarning
} from "../validation/candidateSchema";
import { FscSnapshotParsed, ParsedTable } from "../types/fscSnapshotParsed";
import { NormalizationWarning } from "./types";
import { parseRangeText } from "./range";
import { parsePercentText } from "./percent";
import { normalizeDateText } from "./date";

export interface NormalizationContext {
  carrier: string;
  source_id: string;
  captured_at: string;
  source_url: string;
  content_type: string;
}

export interface ValidationErrorItem {
  path: string;
  message: string;
}

export interface ValidationReport {
  schema_version: "1.0";
  candidate_valid: boolean;
  errors: ValidationErrorItem[];
  candidate_warnings: CandidateWarning[];
  normalization_warnings: NormalizationWarning[];
  structural_error: boolean;
  table_count: number;
  effective_date: string | null;
}

export interface NormalizationResult {
  snapshot: FscSnapshotParsed;
  report: ValidationReport;
}

function formatCandidateWarning(warning: CandidateWarning): string {
  return `${warning.code}: ${warning.message}`.trim();
}

function formatNormalizationWarning(warning: NormalizationWarning): string {
  return `${warning.code}: ${warning.message}`.trim();
}

function candidateHasStructuralError(candidate: CandidateFscExtraction): boolean {
  return candidate.parse_warnings.some((warning) => warning.code === "PARSER_STRUCTURAL_ERROR");
}

export function normalizeCandidate(
  rawCandidate: unknown,
  context: NormalizationContext
): NormalizationResult {
  const parsed = CandidateFscExtractionSchema.safeParse(rawCandidate);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
    const messages = errors.map((error) => `SCHEMA_ERROR: ${error.path} ${error.message}`);
    messages.push("PARSER_STRUCTURAL_ERROR: Candidate schema validation failed.");

    const snapshot: FscSnapshotParsed = {
      schema_version: "1.0",
      carrier: context.carrier,
      source_id: context.source_id,
      captured_at: context.captured_at,
      source_url: context.source_url,
      content_type: context.content_type,
      effective_date: null,
      tables: [],
      parser_diagnostics: {
        structural_error: true,
        messages
      }
    };

    return {
      snapshot,
      report: {
        schema_version: "1.0",
        candidate_valid: false,
        errors,
        candidate_warnings: [],
        normalization_warnings: [],
        structural_error: true,
        table_count: 0,
        effective_date: null
      }
    };
  }

  const candidate = parsed.data;
  const normalizationWarnings: NormalizationWarning[] = [];
  const candidateWarnings = candidate.parse_warnings;

  if (candidate.carrier.toLowerCase() !== context.carrier.toLowerCase()) {
    normalizationWarnings.push({
      code: "SCOPE_AMBIGUOUS",
      message: `Candidate carrier ${candidate.carrier} did not match ${context.carrier}`,
      severity: "warning"
    });
  }

  if (candidate.source_id !== context.source_id) {
    normalizationWarnings.push({
      code: "SCOPE_AMBIGUOUS",
      message: `Candidate source_id ${candidate.source_id} did not match ${context.source_id}`,
      severity: "warning"
    });
  }

  const normalizedDate = normalizeDateText(candidate.effective_date);
  if (normalizedDate.warning) normalizationWarnings.push(normalizedDate.warning);

  const tables: ParsedTable[] = [];

  for (const program of candidate.programs) {
    const brackets = program.brackets.map((bracket) => {
      const rangeResult = parseRangeText(bracket.range_text);
      if (rangeResult.warning) normalizationWarnings.push(rangeResult.warning);

      const percentResult = parsePercentText(bracket.percent_text);
      if (percentResult.warning) normalizationWarnings.push(percentResult.warning);

      return {
        bracket_id: rangeResult.bracket_id,
        index_range: bracket.range_text,
        min_index: rangeResult.index_low,
        max_index: rangeResult.index_high,
        surcharge_percent: percentResult.value,
        surcharge_text: bracket.percent_text
      };
    });

    tables.push({
      program: program.program,
      effective_date: normalizedDate.value,
      brackets
    });
  }

  const hasStructuralError =
    candidateHasStructuralError(candidate) || candidate.programs.length === 0;

  if (candidate.programs.length === 0) {
    normalizationWarnings.push({
      code: "TABLE_NOT_FOUND",
      message: "No programs were extracted from the candidate.",
      severity: "error"
    });
  }

  const messages = [
    ...candidateWarnings.map(formatCandidateWarning),
    ...normalizationWarnings.map(formatNormalizationWarning)
  ];

  if (hasStructuralError && !candidateHasStructuralError(candidate)) {
    messages.push("PARSER_STRUCTURAL_ERROR: Structural parse failure.");
  }

  const snapshot: FscSnapshotParsed = {
    schema_version: "1.0",
    carrier: context.carrier,
    source_id: context.source_id,
    captured_at: context.captured_at,
    source_url: context.source_url,
    content_type: context.content_type,
    effective_date: normalizedDate.value,
    tables,
    parser_diagnostics: {
      structural_error: hasStructuralError,
      messages
    }
  };

  return {
    snapshot,
    report: {
      schema_version: "1.0",
      candidate_valid: true,
      errors: [],
      candidate_warnings: candidateWarnings,
      normalization_warnings: normalizationWarnings,
      structural_error: hasStructuralError,
      table_count: tables.length,
      effective_date: normalizedDate.value
    }
  };
}
