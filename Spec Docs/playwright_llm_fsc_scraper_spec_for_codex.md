# Playwright + LLM Assisted FSC Scraper — Spec for Codex

## Purpose
Build an **alternate FSC scraper** that uses **Playwright** for capture and an **LLM** for extraction, while still producing **the same final output schemas** as the deterministic scraper so we can A/B test accuracy.

The LLM is **not authoritative**. It produces **candidate extraction JSON** which must pass deterministic **validation + normalization gates** before writing the final `FscSnapshotParsed` outputs.

---

## Where this fits in the repo
Place this as a separate package at:

```
parcelpulse/
  scraper-fsc-llm/
    src/
    fixtures/
    tests/
    config/
    package.json
    README.md
```

It should import shared schemas/examples from:

```
parcelpulse/contracts/
```

It should write outputs under a separate root (to compare with baseline):

- Default: `./data/parcelpulse/scrape_out_llm`
- Override: `--out <OUT_DIR>`

---

## CLI
Binary name: `parcelpulse-scraper-llm`

### `scrape`
```
parcelpulse-scraper-llm scrape \
  --registry ./config/source-registry.json \
  --out ./data/parcelpulse/scrape_out_llm \
  --run-id 2026-01-05T10-00-00Z \
  --model gpt-5.2-chat-latest \
  --api-key-env OPENAI_API_KEY
```

### `validate`
```
parcelpulse-scraper-llm validate --run ./data/parcelpulse/scrape_out_llm/<run_id>
```

### `compare`
```
parcelpulse-scraper-llm compare \
  --baseline ./data/parcelpulse/scrape_out/<run_id> \
  --llm ./data/parcelpulse/scrape_out_llm/<run_id> \
  --out ./data/parcelpulse/compare_reports/<run_id>.json
```

---

## Output layout
Within each run folder:

```
{OUT_DIR}/{run_id}/
  run_manifest.json

  capture/{carrier}/{source_id}/{captured_at}/
    raw.html
    raw.mhtml                (optional)
    screenshot.png
    network.json             (optional)
    meta.json

  snapshots/{carrier}/{source_id}/{captured_at}/
    raw.html                 (copy/symlink from capture)
    raw.pdf                  (downloads)
    meta.json
    parsed.json              (FINAL normalized snapshot)

  discovery/{carrier}/{source_id}/{captured_at}/discovered_artifacts.json

  changes/{carrier}/{source_id}/{captured_at}/fsc_delta_records.jsonl

  llm/{carrier}/{source_id}/{captured_at}/
    extraction_request.json
    extraction_response.json
    validation_report.json
```

---

## Sources (same registry format as baseline)
Use the same `config/source-registry.json` as `scraper-fsc/`:
- `ups_fuel_surcharges` (DIRECT HTML)
- `fedex_fuel_surcharge` (DIRECT HTML)
- `fedex_shipping_updates` (DISCOVERY HTML → links)
- `fedex_fsc_pdf` (DIRECT PDF, URL supplied at runtime by discovery)

The LLM scraper must support the same **DIRECT** and **DISCOVERY** modes.

---

## Playwright capture requirements
For each HTML source:
1. Launch Chromium headless
2. Navigate to the URL
3. Wait for `networkidle`, then wait an additional 500–1000ms for DOM stability
4. Save:
   - `raw.html` = `page.content()`
   - `screenshot.png` full page
   - optional `raw.mhtml` if feasible (skip if not)
   - `meta.json` including:
     - `captured_at` (UTC ISO)
     - `final_url`
     - `status_code`
     - `content_hash_sha256` of `raw.html`
     - viewport + user agent
     - timings

For PDFs:
- Fetch/download and store `raw.pdf` with sha256
- Store provenance in `meta.json`:
  - `discovered_from` with parent `source_id`, `captured_at`, `content_hash`
  - `effective_date_hint` from discovery (if known)

---

## DOM Map generator (HTML accuracy feature)
Create a deterministic `DOM_MAP` text block to include in the LLM user message.

### DOM_MAP contents
- PAGE_TITLE
- Ordered H1–H4 headings
- Tables (DOM order):
  - NEAR_HEADING (closest previous heading)
  - HEADERS
  - ROWS_SAMPLE (up to 5)
  - TEXT_NEAR_TABLE_SAMPLE (up to ~200 chars)
- Links (filtered):
  - link text
  - href
  - NEAR_TEXT (up to ~120 chars)

### DOM_MAP generation rules
- Keep size bounded:
  - max headings 50, tables 15, links 50
  - truncate any field to <= 300 chars
- Links filter:
  - include if href ends in `.pdf` OR text contains any of: fuel, surcharge, table, effective, rate, pdf

---

## LLM extraction design
Two-phase design:

### Phase A — Candidate extraction (LLM)
Inputs:
- `ARTIFACT_TEXT` (visible page text extracted from HTML or PDF text)
- `DOM_MAP` (for HTML sources)
- carrier + source_id + artifact_type

Output:
- candidate extraction JSON (stored as `llm/.../extraction_response.json`)

### Phase B — Deterministic validation + normalization (code)
- Validate candidate JSON against `CandidateFscExtractionSchema` (zod)
- Normalize into final `FscSnapshotParsed`:
  - effective_date → ISO `YYYY-MM-DD` or null
  - `range_text` → index_low/high floats + `bracket_id`
  - percent_text → float `surcharge_percent`
  - program mapping → ground/air/international/unknown
- Emit `parse_warnings` when uncertain
- If structural failure: include `PARSER_STRUCTURAL_ERROR` warning and do not publish deltas
- Write final `parsed.json`
- Write `validation_report.json` describing gates passed/failed

---

## LLM system prompt (use exactly)

```
You are a data-extraction engine. Your job is to extract Fuel Surcharge (FSC) table data and related metadata from the provided artifact text and/or DOM map.

Hard rules:
- Output MUST be valid JSON only. No markdown, no commentary, no extra keys outside the schema.
- DO NOT guess. If a value is not explicitly present, set it to null and add a parse warning.
- All numbers must be copied exactly from the provided artifact. Never compute new numbers.
- Use evidence_snippet fields to quote a SHORT nearby fragment (<= 20 words) from the artifact that supports each extracted item (date, table title, bracket row, link).
- If you cannot confidently extract a table, return an empty programs array and include a PARSER_STRUCTURAL_ERROR warning.
- If multiple effective dates appear, pick the one that is explicitly labeled “Effective …” for the FSC change and add a warning that multiple dates were found.

Your output JSON must match the CandidateFscExtraction schema exactly.

CandidateFscExtraction schema (high level):
{
  "artifact_type": "html"|"pdf",
  "carrier": "UPS"|"FedEx",
  "source_id": string,
  "effective_date": string|null,
  "effective_date_evidence": string|null,
  "programs": [
    {
      "program": "ground"|"air"|"international"|"unknown",
      "table_title": string|null,
      "table_title_evidence": string|null,
      "basis_hint": "diesel"|"jet"|"gasoline"|"unknown"|null,
      "brackets": [
        {
          "range_text": string,
          "percent_text": string,
          "row_evidence": string
        }
      ],
      "table_evidence": string|null
    }
  ],
  "links": [
    {
      "href": string,
      "link_text": string|null,
      "effective_date": string|null,
      "evidence_snippet": string
    }
  ],
  "history_90d": {
    "rows": [
      {
        "week_of": string,
        "ground_percent_text": string|null,
        "air_percent_text": string|null,
        "row_evidence": string
      }
    ]
  }|null,
  "parse_warnings": [
    {
      "code": string,
      "message": string,
      "severity": "info"|"warning"|"error"
    }
  ]
}

Warning code guidance:
- "MISSING_EFFECTIVE_DATE"
- "MULTIPLE_EFFECTIVE_DATES_FOUND"
- "SCOPE_AMBIGUOUS"
- "TABLE_NOT_FOUND"
- "PARSER_STRUCTURAL_ERROR"
- "LINK_FOUND_NO_DATE"
- "HISTORY_PARSE_PARTIAL"

Return JSON only.
```

### LLM user message template

```
Extract FSC table data from this artifact.

carrier: <UPS|FedEx>
source_id: <source_id>
artifact_type: <html|pdf>

ARTIFACT_TEXT:
<<<
<artifact text>
>>>

DOM_MAP (if present):
<<<
<dom map>
>>>
```

---

## Candidate schema (zod) — enforce before normalization
Implement exactly:

```ts
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
```

---

## Deterministic normalization helpers (must implement)

### Range parser: `range_text` → bounds + bracket_id
Normalization steps:
1) Replace unicode dashes with `-`
2) Remove `$` and commas, lowercase, collapse whitespace
3) Match patterns in order:
- bounded: `low - high` or `low to high`
- open-high: `low+`, `>= low`, `low and above`
- open-low: `< high`, `under high`, `less than high`

Output:
- `index_low` float|null
- `index_high` float|null
- `bracket_id`:
  - bounded: `${low.toFixed(2)}_${high.toFixed(2)}`
  - open-high: `${low.toFixed(2)}_plus`
  - open-low: `lt_${high.toFixed(2)}`

If no match: warning `RANGE_PARSE_FAILED`.

### Percent parser
- Strip `%`, parse float
- If NaN: warning `PERCENT_PARSE_FAILED`.

### Date normalization
- Accept month-name dates (e.g., Dec. 1, 2025) and numeric (12/1/2025)
- Normalize to ISO `YYYY-MM-DD`
- If cannot normalize: set null + `MISSING_EFFECTIVE_DATE`

---

## Diffing (same as baseline)
Use the same diff engine semantics as deterministic scraper:
- load latest prior `parsed.json` for same carrier+source_id
- match brackets by `bracket_id`
- emit a `FscDeltaRecord` line for each bracket where old != new
- publishability is false when:
  - effective_date null
  - program unknown
  - structural parse error

---

## Comparator tool (`compare`)
Implement comparisons:

### Snapshot parity
- effective_date match
- program set match
- bracket_id sets match
- value match per bracket_id (tolerance 0.01)

### Delta parity
- group_key match
- record count match
- per-record delta match

Output a JSON report with mismatches categorized:
- `MISSING_IN_LLM`
- `EXTRA_IN_LLM`
- `BRACKET_VALUE_MISMATCH`
- `SCOPE_OR_DATE_MISMATCH`

---

## Tests (offline)
- HTML fixtures: UPS and FedEx pages saved locally
- PDF fixture: one FSC table PDF saved locally
- LLM mocked: provide a mocked `CandidateFscExtraction` JSON
- Validation tests: candidate → normalized snapshot
- Diff tests: normalized snapshots → delta JSONL
- DOM map test: known HTML fixture produces expected headings/tables/links structure
- Comparator test: baseline vs llm outputs produce a mismatch report

---

## Non-goals
- No shipper impact
- No narrative summaries
- No database
- No orchestration scheduling

---

## Acceptance criteria
- `scrape` produces capture artifacts + normalized outputs
- LLM never bypasses validation gates
- Deltas emit only when `old_value != new_value`
- Discovery follows FedEx FSC PDFs and parses them
- `compare` produces actionable mismatch reports

