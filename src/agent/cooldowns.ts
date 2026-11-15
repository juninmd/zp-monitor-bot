const lastUse = new Map<string, number>();

function pruneCooldowns(now: number, maxAgeMs: number): void {
  if (lastUse.size < 200) return;
  for (const [k, at] of lastUse) {
    if (now - at >= maxAgeMs) lastUse.delete(k);
  }
}

/** Returns true and records use if `key` is off cooldown, else false. */
export function tryConsume(key: string, cooldownMin: number): boolean {
  const now = Date.now();
  const windowMs = cooldownMin * 60 * 1000;
  pruneCooldowns(now, windowMs);
  const last = lastUse.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  lastUse.set(key, now);
  return true;
}

export function remainingMin(key: string, cooldownMin: number): number {
  const last = lastUse.get(key);
  if (last === undefined) return 0;
  const remainMs = cooldownMin * 60 * 1000 - (Date.now() - last);
  return Math.max(0, Math.ceil(remainMs / 60000));
}
