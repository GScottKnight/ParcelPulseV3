#!/usr/bin/env node
import path from "path";
import dotenv from "dotenv";
import { Command } from "commander";
import pkg from "../../package.json";
import { runScrape } from "../commands/scrape";
import { runValidate } from "../commands/validate";
import { runCompare } from "../commands/compare";

function readArgValue(argv: string[], flag: string): string | undefined {
  const prefix = `${flag}=`;
  const inlineArg = argv.find((arg) => arg.startsWith(prefix));
  if (inlineArg) return inlineArg.slice(prefix.length);
  const index = argv.indexOf(flag);
  if (index >= 0) {
    return argv[index + 1];
  }
  return undefined;
}

function resolveEnvPath(argv: string[], fallback: string): string {
  const cliValue = readArgValue(argv, "--env-file");
  if (cliValue) return cliValue;
  return process.env.PARCELPULSE_ENV_FILE ?? process.env.DOTENV_CONFIG_PATH ?? fallback;
}

const defaultEnvPath = path.resolve(__dirname, "..", "..", ".env");
const envPath = resolveEnvPath(process.argv.slice(2), defaultEnvPath);
dotenv.config({ path: envPath });

const program = new Command();

program
  .name("parcelpulse-scraper-llm")
  .description("ParcelPulse FSC scraper (LLM-assisted)")
  .version(pkg.version);

program.option(
  "--env-file <path>",
  "Path to .env file (overrides PARCELPULSE_ENV_FILE/DOTENV_CONFIG_PATH)",
  envPath
);

program
  .command("scrape")
  .requiredOption("--registry <path>", "Path to source-registry.json")
  .option("--out <dir>", "Output directory", "./data/parcelpulse/scrape_out_llm")
  .requiredOption("--run-id <id>", "Run ID (e.g., 2026-01-05T10-00-00Z)")
  .option("--model <model>", "LLM model", "gpt-5.2-chat-latest")
  .option("--api-key-env <env>", "Env var with API key", "OPENAI_API_KEY")
  .action(async (opts) => {
    await runScrape({
      registryPath: opts.registry,
      outDir: opts.out,
      runId: opts.runId,
      model: opts.model,
      apiKeyEnv: opts.apiKeyEnv
    });
  });

program
  .command("validate")
  .requiredOption("--run <path>", "Run directory to validate")
  .action(async (opts) => {
    await runValidate({ runDir: opts.run });
  });

program
  .command("compare")
  .requiredOption("--baseline <path>", "Baseline run directory")
  .requiredOption("--llm <path>", "LLM run directory")
  .requiredOption("--out <path>", "Output report path")
  .action(async (opts) => {
    await runCompare({ baselineDir: opts.baseline, llmDir: opts.llm, outPath: opts.out });
  });

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
