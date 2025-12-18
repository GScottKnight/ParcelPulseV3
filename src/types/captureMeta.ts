export interface ViewportSize {
  width: number;
  height: number;
}

export interface CaptureTimings {
  navigation_ms?: number;
  settle_ms?: number;
  total_ms: number;
}

export interface CaptureProvenance {
  source_id: string;
  captured_at: string;
  content_hash: string;
}

export interface CaptureMeta {
  captured_at: string;
  final_url: string;
  status_code: number | null;
  content_hash_sha256: string;
  viewport?: ViewportSize;
  user_agent?: string;
  timings: CaptureTimings;
  discovered_from?: CaptureProvenance | null;
  effective_date_hint?: string | null;
}
