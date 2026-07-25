import { readdir } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { database } from "./database";
import { embedText } from "./embeddings";
import { chunkKnowledge, toPgVector } from "./knowledge";

function hashChunk(content: string): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex");
}

export async function ingestKnowledgeDirectory(directory = config.knowledgeDir): Promise<number> {
  if (!database) return 0;
  const files = (await readdir(directory)).filter((file) => file.endsWith(".md")).sort();
  let ingested = 0;

  for (const file of files) {
    const source = path.basename(file);
    const text = await Bun.file(path.join(directory, file)).text();
    for (const content of chunkKnowledge(text)) {
      const chunkHash = hashChunk(`${source}\0${content}`);
      const existing = await database<{ embedding_model: string }[]>`
        SELECT embedding_model FROM knowledge_chunks WHERE chunk_hash = ${chunkHash}
      `;
      if (existing[0]?.embedding_model === config.embeddingModel) continue;
      const vector = toPgVector(await embedText(content));
      await database.unsafe(
        `INSERT INTO knowledge_chunks
          (source, chunk_hash, content, embedding_model, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)
         ON CONFLICT (chunk_hash) DO UPDATE SET
           content = EXCLUDED.content,
           embedding_model = EXCLUDED.embedding_model,
           embedding = EXCLUDED.embedding,
           updated_at = now()`,
        [source, chunkHash, content, config.embeddingModel, vector],
      );
      ingested++;
    }
  }
  return ingested;
}

export async function retrieveKnowledge(question: string, limit = 5): Promise<string[]> {
  if (!database) return [];
  const vector = toPgVector(await embedText(question));
  const rows = await database.unsafe<Array<{ source: string; content: string; distance: number }>>(
    `SELECT source, content, embedding <=> $1::vector AS distance
       FROM knowledge_chunks
      WHERE embedding_model = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [vector, config.embeddingModel, limit],
  );
  return rows.map((row) => `[${row.source}] ${row.content}`);
}
