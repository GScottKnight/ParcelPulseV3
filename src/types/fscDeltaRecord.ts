export interface Publishability {
  is_publishable: boolean;
  reasons: string[];
}

export interface FscDeltaRecord {
  schema_version: "1.0";
  carrier: string;
  source_id: string;
  captured_at: string;
  prior_captured_at: string | null;
  program: string | null;
  effective_date: string | null;
  bracket_id: string;
  index_range: string | null;
  old_value: number | null;
  new_value: number | null;
  group_key: string;
  publishability: Publishability;
  parser_structural_error: boolean;
}
