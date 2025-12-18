import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  serial,
  index,
  uniqueIndex
} from "drizzle-orm/pg-core";

export const runs = pgTable("runs", {
  runId: text("run_id").primaryKey(),
  outDir: text("out_dir").notNull(),
  runDir: text("run_dir").notNull(),
  registryPath: text("registry_path").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const runSources = pgTable(
  "run_sources",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.runId),
    sourceId: text("source_id").notNull(),
    carrier: text("carrier").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    snapshotDir: text("snapshot_dir"),
    parsedPath: text("parsed_path"),
    discoveryPath: text("discovery_path"),
    changesPath: text("changes_path"),
    error: jsonb("error")
  },
  (table) => ({
    runSourceUnique: uniqueIndex("run_sources_run_source_captured_idx").on(
      table.runId,
      table.sourceId,
      table.capturedAt
    ),
    runSourceRunIdx: index("run_sources_run_idx").on(table.runId)
  })
);

export const childArtifacts = pgTable(
  "child_artifacts",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.runId),
    parentSourceId: text("parent_source_id").notNull(),
    sourceId: text("source_id").notNull(),
    url: text("url").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    snapshotDir: text("snapshot_dir"),
    parsedPath: text("parsed_path"),
    changesPath: text("changes_path"),
    status: text("status").notNull(),
    effectiveDateHint: text("effective_date_hint"),
    error: jsonb("error")
  },
  (table) => ({
    childArtifactUnique: uniqueIndex("child_artifacts_unique_idx").on(
      table.runId,
      table.parentSourceId,
      table.sourceId,
      table.url,
      table.capturedAt
    ),
    childArtifactRunIdx: index("child_artifacts_run_idx").on(table.runId)
  })
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.runId),
    sourceId: text("source_id").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    carrier: text("carrier").notNull(),
    sourceUrl: text("source_url").notNull(),
    contentType: text("content_type").notNull(),
    effectiveDate: text("effective_date"),
    parserDiagnostics: jsonb("parser_diagnostics").notNull(),
    parsedJson: jsonb("parsed_json").notNull()
  },
  (table) => ({
    snapshotsUnique: uniqueIndex("snapshots_unique_idx").on(
      table.runId,
      table.sourceId,
      table.capturedAt
    ),
    snapshotsRunIdx: index("snapshots_run_idx").on(table.runId, table.sourceId)
  })
);

export const fscTables = pgTable(
  "fsc_tables",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.runId),
    sourceId: text("source_id").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    tableIndex: integer("table_index").notNull(),
    program: text("program"),
    effectiveDate: text("effective_date"),
    bracketCount: integer("bracket_count").notNull()
  },
  (table) => ({
    fscTablesUnique: uniqueIndex("fsc_tables_unique_idx").on(
      table.runId,
      table.sourceId,
      table.capturedAt,
      table.tableIndex
    ),
    fscTablesRunIdx: index("fsc_tables_run_idx").on(table.runId, table.sourceId)
  })
);

export const fscBrackets = pgTable(
  "fsc_brackets",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.runId),
    sourceId: text("source_id").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    tableIndex: integer("table_index").notNull(),
    bracketIndex: integer("bracket_index").notNull(),
    bracketId: text("bracket_id"),
    indexRange: text("index_range"),
    minIndex: numeric("min_index", { precision: 12, scale: 4 }),
    maxIndex: numeric("max_index", { precision: 12, scale: 4 }),
    surchargePercent: numeric("surcharge_percent", { precision: 12, scale: 4 }),
    surchargeText: text("surcharge_text").notNull()
  },
  (table) => ({
    fscBracketsUnique: uniqueIndex("fsc_brackets_unique_idx").on(
      table.runId,
      table.sourceId,
      table.capturedAt,
      table.tableIndex,
      table.bracketIndex
    ),
    fscBracketsRunIdx: index("fsc_brackets_run_idx").on(table.runId, table.sourceId)
  })
);

export const fuelPricesRaw = pgTable(
  "fuel_prices_raw",
  {
    id: serial("id").primaryKey(),
    seriesId: text("series_id").notNull(),
    period: text("period").notNull(), // YYYY-MM-DD
    value: numeric("value", { precision: 12, scale: 4 }).notNull(),
    units: text("units").notNull(),
    description: text("description").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    fuelPricesRawUnique: uniqueIndex("fuel_prices_raw_unique_idx").on(table.seriesId, table.period)
  })
);

export const appliedFsc = pgTable(
  "applied_fsc",
  {
    id: serial("id").primaryKey(),
    carrier: text("carrier").notNull(),
    program: text("program").notNull(), // ground, air, international, unknown
    weekEndingDate: text("week_ending_date").notNull(), // YYYY-MM-DD
    tableEffectiveDate: text("table_effective_date").notNull(), // YYYY-MM-DD
    bracketId: text("bracket_id"),
    bracketRange: text("bracket_range"),
    appliedPercent: numeric("applied_percent", { precision: 8, scale: 4 }).notNull(),
    fuelPrice: numeric("fuel_price", { precision: 12, scale: 4 }),
    fuelIndex: text("fuel_index"),
    reason: text("reason").notNull(), // table_change | fuel_tier_change | both | no_change
    sourceRunId: text("source_run_id"), // optional link to scraper run
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    appliedFscUnique: uniqueIndex("applied_fsc_unique_idx").on(
      table.carrier,
      table.program,
      table.weekEndingDate
    )
  })
);
