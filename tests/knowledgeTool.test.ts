import { describe, expect, test } from "bun:test";
import type { Context } from "@google/adk";
import { buildKnowledgeTools } from "../src/agent/knowledgeTools";
import {
  type KnowledgeBackend,
  type KnowledgeChunk,
  KnowledgeService,
} from "../src/knowledgeStore";

class MemoryKnowledgeBackend implements KnowledgeBackend {
  readonly chunks = new Map<string, KnowledgeChunk>();

  async embeddingModelForHash(hash: string): Promise<string | undefined> {
    return this.chunks.get(hash)?.embeddingModel;
  }

  async upsert(chunk: KnowledgeChunk): Promise<void> {
    this.chunks.set(chunk.hash, chunk);
  }

  async search(): Promise<Array<{ source: string; content: string; distance: number }>> {
    return [...this.chunks.values()].map(({ source, content }) => ({
      source,
      content,
      distance: 0,
    }));
  }
}

describe("store_zombie_knowledge", () => {
  test("indexes tool-written information before returning, making it immediately retrievable", async () => {
    const backend = new MemoryKnowledgeBackend();
    const service = new KnowledgeService(backend, async () => [0.1, 0.2, 0.3], "test-embed");
    const audit: unknown[] = [];
    const [tool] = buildKnowledgeTools(
      { chatId: "123", actor: "@admin" },
      {
        store: (source, content) => service.storeText(source, content),
        audit: async (event) => {
          audit.push(event);
        },
      },
    );

    const result = await tool?.runAsync({
      args: {
        fact: "No servidor do Junin, o código rubi concede 17 Ammo Packs.",
        source: "homologacao",
      },
      toolContext: undefined as unknown as Context,
    });
    const retrieved = await service.retrieve("Quantos Ammo Packs o código rubi concede?");

    expect(result).toEqual({ ok: true, indexedChunks: 1, source: "tool:homologacao" });
    expect(retrieved).toContain(
      "[tool:homologacao] No servidor do Junin, o código rubi concede 17 Ammo Packs.",
    );
    expect(audit).toMatchObject([
      { action: "knowledge", status: "started" },
      { action: "knowledge", status: "success" },
    ]);
  });

  test("is idempotent for the same source, content, and embedding model", async () => {
    const backend = new MemoryKnowledgeBackend();
    let embeds = 0;
    const service = new KnowledgeService(
      backend,
      async () => {
        embeds++;
        return [0.1, 0.2, 0.3];
      },
      "test-embed",
    );

    expect(await service.storeText("tool:telegram", "Um fato persistente para homologação.")).toBe(
      1,
    );
    expect(await service.storeText("tool:telegram", "Um fato persistente para homologação.")).toBe(
      0,
    );
    expect(backend.chunks.size).toBe(1);
    expect(embeds).toBe(1);
  });

  test("audits a failed write and propagates the storage error", async () => {
    const audit: unknown[] = [];
    const [tool] = buildKnowledgeTools(
      { chatId: "123", actor: "@admin" },
      {
        store: async () => {
          throw new Error("pgvector unavailable");
        },
        audit: async (event) => {
          audit.push(event);
        },
      },
    );

    await expect(
      tool?.runAsync({
        args: { fact: "Um fato válido que não pode ser persistido.", source: "falha" },
        toolContext: undefined as unknown as Context,
      }),
    ).rejects.toThrow("pgvector unavailable");
    expect(audit).toMatchObject([
      { action: "knowledge", status: "started" },
      { action: "knowledge", status: "failed", response: "pgvector unavailable" },
    ]);
  });
});
