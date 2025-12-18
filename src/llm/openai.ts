import { LlmProvider, LlmRequest, LlmResponse } from "./provider";

export interface OpenAiConfig {
  apiKey: string;
  baseUrl?: string;
}

export class OpenAiProvider implements LlmProvider {
  name = "openai";
  private baseUrl: string;
  private apiKey: string;

  constructor(config: OpenAiConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  }

  async invoke(request: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages
    };
    if (typeof request.temperature === "number") {
      body.temperature = request.temperature;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI response missing message content");
    }

    return {
      model: data.model ?? request.model,
      content,
      usage: data.usage,
      raw: data
    };
  }
}
