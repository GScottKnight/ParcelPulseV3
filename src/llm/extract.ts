import path from "path";
import { nowUtcIsoSeconds } from "../utils/time";
import { writeJson } from "../utils/fs";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompts";
import { LlmProvider, LlmResponse } from "./provider";

export interface LlmExtractionInput {
  provider: LlmProvider;
  model: string;
  carrier: "UPS" | "FedEx";
  sourceId: string;
  artifactType: "html" | "pdf";
  artifactText: string;
  domMap?: string | null;
  outDir: string;
}

export interface LlmExtractionResult {
  candidate: unknown;
  response: LlmResponse;
  request_path: string;
  response_path: string;
}

export async function runLlmExtraction(options: LlmExtractionInput): Promise<LlmExtractionResult> {
  const userPrompt = buildUserMessage({
    carrier: options.carrier,
    sourceId: options.sourceId,
    artifactType: options.artifactType,
    artifactText: options.artifactText,
    domMap: options.domMap ?? null
  });

  const requestRecord = {
    model: options.model,
    provider: options.provider.name,
    created_at: nowUtcIsoSeconds(),
    system_prompt: SYSTEM_PROMPT,
    user_prompt: userPrompt
  };

  const requestPath = path.join(options.outDir, "extraction_request.json");
  await writeJson(requestPath, requestRecord);

  const response = await options.provider.invoke({
    model: options.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ]
  });

  let candidate: unknown;
  try {
    candidate = JSON.parse(response.content);
  } catch (error) {
    throw new Error(`Failed to parse LLM JSON output: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const responsePath = path.join(options.outDir, "extraction_response.json");
  await writeJson(responsePath, candidate);

  return {
    candidate,
    response,
    request_path: requestPath,
    response_path: responsePath
  };
}
