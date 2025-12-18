import { compareRuns } from "../compare/compareSnapshots";
import { writeJson } from "../utils/fs";

export interface CompareOptions {
  baselineDir: string;
  llmDir: string;
  outPath: string;
}

export async function runCompare(options: CompareOptions): Promise<void> {
  const report = await compareRuns(options.baselineDir, options.llmDir);
  await writeJson(options.outPath, report);
}
