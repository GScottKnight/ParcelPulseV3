import { z } from "zod";

const SourceSchema = z.object({
  id: z.string(),
  carrier: z.string(),
  mode: z.enum(["DIRECT", "DISCOVERY"]),
  url: z.string().url().nullable(),
  parser_id: z.string(),
  artifact_type: z.enum(["html", "pdf"]),
  diff_enabled: z.boolean(),
  child_source_id: z.string().optional(),
  discovered_only: z.boolean().optional()
});

export const SourceRegistrySchema = z.object({
  version: z.string(),
  sources: z.array(SourceSchema)
});

export type SourceRegistry = z.infer<typeof SourceRegistrySchema>;
export type SourceConfig = z.infer<typeof SourceSchema>;
