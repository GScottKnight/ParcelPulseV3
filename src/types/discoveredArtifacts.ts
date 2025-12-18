export interface ParserDiagnostics {
  structural_error: boolean;
  messages: string[];
}

export interface DiscoveredArtifact {
  url: string;
  effective_date: string | null;
  context_excerpt: string | null;
  child_source_id: string;
}

export interface DiscoveredArtifacts {
  schema_version: "1.0";
  carrier: string;
  source_id: string;
  captured_at: string;
  artifacts: DiscoveredArtifact[];
  parser_diagnostics: ParserDiagnostics;
}
