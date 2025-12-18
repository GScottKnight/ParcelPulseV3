export interface RunManifestError {
  message: string;
  stack?: string;
}

export interface RunManifestChildArtifact {
  source_id: string;
  url: string;
  captured_at: string;
  snapshot_dir: string;
  parsed_path: string | null;
  changes_path: string | null;
  status: "success" | "error";
  error: RunManifestError | null;
  effective_date_hint: string | null;
}

export interface RunManifestSource {
  source_id: string;
  carrier: string;
  mode: "DIRECT" | "DISCOVERY";
  status: "success" | "error";
  captured_at: string | null;
  snapshot_dir: string | null;
  parsed_path: string | null;
  discovery_path: string | null;
  changes_path: string | null;
  error: RunManifestError | null;
  child_artifacts: RunManifestChildArtifact[];
}

export interface RunManifest {
  schema_version: "1.0";
  run_id: string;
  out_dir: string;
  run_dir: string;
  registry_path: string;
  started_at: string;
  ended_at: string;
  sources: RunManifestSource[];
}
