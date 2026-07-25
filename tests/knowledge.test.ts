import { describe, expect, test } from "bun:test";
import { chunkKnowledge, toPgVector } from "../src/knowledge";

describe("knowledge preparation", () => {
  test("chunks on paragraphs without losing content", () => {
    const chunks = chunkKnowledge("Primeiro bloco.\n\nSegundo bloco bem maior.", 24);
    expect(chunks).toEqual(["Primeiro bloco.", "Segundo bloco bem maior."]);
  });

  test("serializes finite embeddings for pgvector", () => {
    expect(toPgVector([0.25, -1, 3])).toBe("[0.25,-1,3]");
    expect(() => toPgVector([Number.NaN])).toThrow("embedding inválido");
  });
});
