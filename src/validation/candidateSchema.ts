import { z } from "zod";

export const CandidateWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "error"])
});

export const CandidateBracketSchema = z.object({
  range_text: z.string().min(1),
  percent_text: z.string().min(1),
  row_evidence: z.string().min(1).max(300)
});

export const CandidateProgramSchema = z.object({
  program: z.enum(["ground", "air", "international", "unknown"]),
  table_title: z.string().min(1).max(200).nullable(),
  table_title_evidence: z.string().min(1).max(300).nullable(),
  basis_hint: z.enum(["diesel", "jet", "gasoline", "unknown"]).nullable(),
  brackets: z.array(CandidateBracketSchema).default([]),
  table_evidence: z.string().min(1).max(300).nullable()
});

export const CandidateLinkSchema = z.object({
  href: z.string().url(),
  link_text: z.string().min(1).max(200).nullable(),
  effective_date: z.string().min(4).max(32).nullable(),
  evidence_snippet: z.string().min(1).max(300)
});

export const CandidateHistoryRowSchema = z.object({
  week_of: z.string().min(4).max(32),
  ground_percent_text: z.string().min(1).max(32).nullable(),
  air_percent_text: z.string().min(1).max(32).nullable(),
  row_evidence: z.string().min(1).max(300)
});

export const CandidateHistorySchema = z.object({
  rows: z.array(CandidateHistoryRowSchema).default([])
});

export const CandidateFscExtractionSchema = z.object({
  artifact_type: z.enum(["html", "pdf"]),
  carrier: z.enum(["UPS", "FedEx"]),
  source_id: z.string().min(1),

  effective_date: z.string().min(4).max(32).nullable(),
  effective_date_evidence: z.string().min(1).max(300).nullable(),

  programs: z.array(CandidateProgramSchema).default([]),
  links: z.array(CandidateLinkSchema).default([]),
  history_90d: CandidateHistorySchema.nullable(),
  parse_warnings: z.array(CandidateWarningSchema).default([])
});

export type CandidateFscExtraction = z.infer<typeof CandidateFscExtractionSchema>;
export type CandidateWarning = z.infer<typeof CandidateWarningSchema>;
