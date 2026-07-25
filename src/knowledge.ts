export function chunkKnowledge(text: string, maxChars = 1200): string[] {
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if (current.length + 2 + paragraph.length <= maxChars) {
      current += `\n\n${paragraph}`;
    } else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function toPgVector(embedding: number[]): string {
  if (embedding.length === 0 || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error("embedding inválido");
  }
  return `[${embedding.join(",")}]`;
}
