import type { LlmRequest, LlmResponse } from "@google/adk";
import { BaseLlm, type BaseLlmConnection } from "@google/adk";
import type { Content, FunctionDeclaration, Schema } from "@google/genai";

/**
 * ADK model backend talking to our own LiteLLM proxy's OpenAI-compatible
 * /v1/chat/completions endpoint. The bundled @google/adk package only ships a
 * native Gemini client, and LiteLLM's Gemini-API passthrough (/gemini/v1beta)
 * 404s for any model id containing a "/" (our "cloud/<provider>" aliases) -
 * so this talks OpenAI chat-completions shape directly and translates
 * to/from ADK's Gemini-shaped LlmRequest/LlmResponse.
 */
export class LiteLlmOpenAi extends BaseLlm {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(params: { model: string; apiKey: string; baseUrl: string }) {
    super({ model: params.model });
    this.apiKey = params.apiKey;
    this.baseUrl = params.baseUrl.replace(/\/$/, "");
  }

  async *generateContentAsync(
    llmRequest: LlmRequest,
    _stream = false,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void> {
    const messages = buildMessages(llmRequest);
    const tools = buildTools(llmRequest);

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal: abortSignal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `LiteLLM ${this.model} request failed (${res.status}): ${body.slice(0, 500)}`,
      );
    }

    const data = (await res.json()) as OpenAiChatCompletion;
    yield toLlmResponse(data);
  }

  async connect(): Promise<BaseLlmConnection> {
    throw new Error("LiteLlmOpenAi does not support live connections");
  }
}

interface OpenAiToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface OpenAiChatCompletion {
  choices: Array<{
    message: { role: string; content: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason: string;
  }>;
}

function toLlmResponse(data: OpenAiChatCompletion): LlmResponse {
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (!message) return { errorCode: "no_choice", errorMessage: "LiteLLM returned no choices" };

  const parts: Content["parts"] = [];
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // leave args empty on malformed JSON rather than crash the turn
      }
      parts.push({ functionCall: { id: call.id, name: call.function.name, args } });
    }
  } else if (message.content) {
    parts.push({ text: message.content });
  }

  return {
    content: { role: "model", parts },
    finishReason: message.tool_calls ? undefined : "STOP",
  } as LlmResponse;
}

function buildMessages(llmRequest: LlmRequest): unknown[] {
  const messages: unknown[] = [];

  const sysInstruction = llmRequest.config?.systemInstruction;
  const sysText =
    typeof sysInstruction === "string"
      ? sysInstruction
      : extractText(sysInstruction as Content | undefined);
  if (sysText) messages.push({ role: "system", content: sysText });

  for (const content of llmRequest.contents) {
    const role = content.role === "model" ? "assistant" : "user";
    const toolCalls = (content.parts ?? [])
      .flatMap((part) => (part.functionCall ? [part.functionCall] : []))
      .map((call) => ({
        id: call.id ?? call.name ?? "call",
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
        },
      }));

    const functionResponses = (content.parts ?? []).flatMap((part) =>
      part.functionResponse ? [part.functionResponse] : [],
    );
    if (functionResponses.length > 0) {
      for (const response of functionResponses) {
        messages.push({
          role: "tool",
          tool_call_id: response.id ?? response.name ?? "call",
          content: JSON.stringify(response.response ?? {}),
        });
      }
      continue;
    }

    if (toolCalls.length > 0) {
      messages.push({ role: "assistant", content: null, tool_calls: toolCalls });
      continue;
    }

    const text = extractText(content);
    if (text) messages.push({ role, content: text });
  }

  return messages;
}

function extractText(content?: Content): string {
  if (!content?.parts) return "";
  return content.parts
    .map((p) => p.text ?? "")
    .filter(Boolean)
    .join("\n");
}

function buildTools(llmRequest: LlmRequest): unknown[] {
  return Object.values(llmRequest.toolsDict)
    .map((tool) => tool._getDeclaration())
    .filter((decl): decl is FunctionDeclaration => Boolean(decl))
    .map((decl) => ({
      type: "function",
      function: {
        name: decl.name,
        description: decl.description,
        parameters: decl.parameters
          ? geminiSchemaToJsonSchema(decl.parameters)
          : { type: "object", properties: {} },
      },
    }));
}

/** Gemini Schema uses UPPERCASE type names (OBJECT/STRING/...); JSON Schema/OpenAI wants lowercase. */
function geminiSchemaToJsonSchema(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = { ...schema };
  if (typeof out.type === "string") out.type = (out.type as string).toLowerCase();
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, geminiSchemaToJsonSchema(v as Schema)]),
    );
  }
  if (schema.items) out.items = geminiSchemaToJsonSchema(schema.items as Schema);
  return out;
}
