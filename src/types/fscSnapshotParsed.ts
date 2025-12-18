export interface ParserDiagnostics {
  structural_error: boolean;
  messages: string[];
}

export interface ParsedBracket {
  bracket_id: string;
  index_range: string;
  min_index: number | null;
  max_index: number | null;
  surcharge_percent: number | null;
  surcharge_text: string;
}

export interface ParsedTable {
  program: string | null;
  effective_date: string | null;
  brackets: ParsedBracket[];
}

export interface FscSnapshotParsed {
  schema_version: "1.0";
  carrier: string;
  source_id: string;
  captured_at: string;
  source_url: string;
  content_type: string;
  effective_date: string | null;
  tables: ParsedTable[];
  parser_diagnostics: ParserDiagnostics;
}
