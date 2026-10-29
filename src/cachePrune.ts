/** Remove entradas vencidas de um cache por TTL; sem isso o Map só cresce a cada jogador/IP novo. */
export function pruneExpired(cache: Map<string, { at: number }>, ttlMs: number): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.at >= ttlMs) cache.delete(key);
  }
}
