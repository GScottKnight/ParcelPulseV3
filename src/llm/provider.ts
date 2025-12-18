export type LlmRole = "system" | "user";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
}

export interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface LlmResponse {
  model: string;
  content: string;
  usage?: LlmUsage;
  raw: unknown;
}

export interface LlmProvider {
  name: string;
  invoke(request: LlmRequest): Promise<LlmResponse>;
}
