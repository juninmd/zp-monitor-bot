import { readdir } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";
import { database } from "./database";
import { embedText } from "./embeddings";
import { chunkKnowledge, toPgVector } from "./knowledge";

export interface KnowledgeChunk {
  source: string;
  hash: string;
  content: string;
  embeddingModel: string;
  vector: string;
}

export interface KnowledgeBackend {
  embeddingModelForHash(hash: string): Promise<string | undefined>;
  upsert(chunk: KnowledgeChunk): Promise<void>;
  search(
    vector: string,
    embeddingModel: string,
    limit: number,
  ): Promise<Array<{ source: string; content: string; distance: number }>>;
}

function hashChunk(source: string, content: string): string {
  return new Bun.CryptoHasher("sha256").update(`${source}\0${content}`).digest("hex");
}

export class KnowledgeService {
  constructor(
    private readonly backend: KnowledgeBackend,
    private readonly embed: (text: string) => Promise<number[]>,
    private readonly embeddingModel: string,
  ) {}

  async storeText(source: string, text: string): Promise<number> {
    let indexed = 0;
    for (const content of chunkKnowledge(text)) {
      const hash = hashChunk(source, content);
      if ((await this.backend.embeddingModelForHash(hash)) === this.embeddingModel) continue;
      await this.backend.upsert({
        source,
        hash,
        content,
        embeddingModel: this.embeddingModel,
        vector: toPgVector(await this.embed(content)),
      });
      indexed++;
    }
    return indexed;
  }

  async retrieve(question: string, limit = 5): Promise<string[]> {
    const vector = toPgVector(await this.embed(question));
    const rows = await this.backend.search(vector, this.embeddingModel, limit);
    return rows.map((row) => `[${row.source}] ${row.content}`);
  }
}

class SqlKnowledgeBackend implements KnowledgeBackend {
  async embeddingModelForHash(hash: string): Promise<string | undefined> {
    if (!database) return undefined;
    const rows = await database<{ embedding_model: string }[]>`
      SELECT embedding_model FROM knowledge_chunks WHERE chunk_hash = ${hash}
    `;
    return rows[0]?.embedding_model;
  }

  async upsert(chunk: KnowledgeChunk): Promise<void> {
    if (!database) return;
    await database.unsafe(
      `INSERT INTO knowledge_chunks
        (source, chunk_hash, content, embedding_model, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (chunk_hash) DO UPDATE SET
         source = EXCLUDED.source,
         content = EXCLUDED.content,
         embedding_model = EXCLUDED.embedding_model,
         embedding = EXCLUDED.embedding,
         updated_at = now()`,
      [chunk.source, chunk.hash, chunk.content, chunk.embeddingModel, chunk.vector],
    );
  }

  async search(
    vector: string,
    embeddingModel: string,
    limit: number,
  ): Promise<Array<{ source: string; content: string; distance: number }>> {
    if (!database) return [];
    return database.unsafe(
      `SELECT source, content, embedding <=> $1::vector AS distance
         FROM knowledge_chunks
        WHERE embedding_model = $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      [vector, embeddingModel, limit],
    );
  }
}

const service = database
  ? new KnowledgeService(new SqlKnowledgeBackend(), embedText, config.embeddingModel)
  : null;

export async function storeKnowledgeText(source: string, text: string): Promise<number> {
  return service?.storeText(source, text) ?? 0;
}

export async function ingestKnowledgeDirectory(directory = config.knowledgeDir): Promise<number> {
  if (!service) return 0;
  const files = (await readdir(directory)).filter((file) => file.endsWith(".md")).sort();
  let ingested = 0;
  for (const file of files) {
    ingested += await service.storeText(
      path.basename(file),
      await Bun.file(path.join(directory, file)).text(),
    );
  }
  return ingested;
}

export async function retrieveKnowledge(question: string, limit = 5): Promise<string[]> {
  return service?.retrieve(question, limit) ?? [];
}

export interface KnowledgeStats {
  totalChunks: number;
  toolChunks: number;
  latestUpdate: string | null;
}

export async function knowledgeStats(): Promise<KnowledgeStats> {
  if (!database) return { totalChunks: 0, toolChunks: 0, latestUpdate: null };
  const rows = await database<
    Array<{ total_chunks: number; tool_chunks: number; latest_update: Date | null }>
  >`
    SELECT
      count(*)::int AS total_chunks,
      count(*) FILTER (WHERE source LIKE 'tool:%')::int AS tool_chunks,
      max(updated_at) AS latest_update
    FROM knowledge_chunks
  `;
  const row = rows[0];
  return {
    totalChunks: row?.total_chunks ?? 0,
    toolChunks: row?.tool_chunks ?? 0,
    latestUpdate: row?.latest_update?.toISOString() ?? null,
  };
}
