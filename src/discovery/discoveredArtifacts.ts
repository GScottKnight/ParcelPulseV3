import { CandidateFscExtractionSchema, CandidateFscExtraction } from "../validation/candidateSchema";
import { normalizeDateText } from "../normalize/date";
import { DiscoveredArtifacts, DiscoveredArtifact } from "../types/discoveredArtifacts";

export interface DiscoveryBuildParams {
  candidate: unknown;
  carrier: string;
  sourceId: string;
  capturedAt: string;
  childSourceId: string;
  baseUrl?: string;
  pdfOnly?: boolean;
}

export interface DiscoveryBuildResult {
  discovered: DiscoveredArtifacts;
  links: DiscoveredArtifact[];
}

function warningMessages(candidate: CandidateFscExtraction): string[] {
  return candidate.parse_warnings.map((warning) => `${warning.code}: ${warning.message}`.trim());
}

function resolveHref(href: string, baseUrl?: string): string | null {
  try {
    if (baseUrl) {
      return new URL(href, baseUrl).toString();
    }
    return new URL(href).toString();
  } catch {
    return null;
  }
}

function normalizeCandidateLinks(candidate: unknown, baseUrl?: string): unknown {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !("links" in candidate) ||
    !Array.isArray((candidate as any).links)
  ) {
    return candidate;
  }

  const copy = { ...(candidate as Record<string, unknown>) };
  const links = (copy.links as any[]).map((link) => {
    if (!link || typeof link !== "object" || !("href" in link)) return link;
    const resolved = resolveHref(String(link.href), baseUrl);
    return resolved ? { ...link, href: resolved } : link;
  });
  copy.links = links;
  return copy;
}

export function buildDiscoveredArtifacts(params: DiscoveryBuildParams): DiscoveryBuildResult {
  const normalizedCandidate = normalizeCandidateLinks(params.candidate, params.baseUrl);
  const parsed = CandidateFscExtractionSchema.safeParse(normalizedCandidate);

  if (!parsed.success) {
    const issueMessages = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`
    );
    const discovered: DiscoveredArtifacts = {
      schema_version: "1.0",
      carrier: params.carrier,
      source_id: params.sourceId,
      captured_at: params.capturedAt,
      artifacts: [],
      parser_diagnostics: {
        structural_error: true,
        messages: ["PARSER_STRUCTURAL_ERROR: Candidate schema validation failed.", ...issueMessages]
      }
    };
    return { discovered, links: [] };
  }

  const candidate = parsed.data;
  const artifacts: DiscoveredArtifact[] = candidate.links
    .map((link): DiscoveredArtifact | null => {
      const resolved = resolveHref(link.href, params.baseUrl);
      if (!resolved) return null;
      if (params.pdfOnly && !resolved.toLowerCase().endsWith(".pdf")) return null;
      const normalizedDate = normalizeDateText(link.effective_date ?? null);
      return {
        url: resolved,
        effective_date: normalizedDate.value,
        context_excerpt: link.evidence_snippet ?? null,
        child_source_id: params.childSourceId
      };
    })
    .filter((entry): entry is DiscoveredArtifact => entry !== null);

  const messages = warningMessages(candidate);
  const structuralError = candidate.parse_warnings.some(
    (warning) => warning.code === "PARSER_STRUCTURAL_ERROR"
  );

  if (artifacts.length === 0) {
    messages.push("LINKS_NOT_FOUND: No discoverable artifacts were found.");
  }

  const discovered: DiscoveredArtifacts = {
    schema_version: "1.0",
    carrier: params.carrier,
    source_id: params.sourceId,
    captured_at: params.capturedAt,
    artifacts,
    parser_diagnostics: {
      structural_error: structuralError || artifacts.length === 0,
      messages
    }
  };

  return { discovered, links: artifacts };
}
