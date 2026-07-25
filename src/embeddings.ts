import { config } from "./config";

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

export async function embedText(text: string): Promise<number[]> {
  const response = await fetch(`${config.litellmBaseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.litellmApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: config.embeddingModel, input: text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `LiteLLM embeddings falhou (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  }
  const payload = (await response.json()) as EmbeddingResponse;
  const embedding = payload.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error("LiteLLM retornou embedding inválido");
  }
  return embedding;
}
