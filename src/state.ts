export interface OnlinePlayer {
  name: string;
  uid: string;
  steamId: string;
  ip: string;
  isBot: boolean;
  connectedAt: number;
}

const online = new Map<string, OnlinePlayer>();
const distinctSteamIds = new Set<string>();

// Real (non-bot) clients can emit two "connected" lines with different uids
// for the same steamid during the Steam auth handshake before settling on
// one. Key humans by steamid so the second connect replaces the first
// instead of appearing as a second online player.
const onlineKey = (uid: string, steamId: string): string =>
  steamId === "BOT" ? `bot:${uid}` : `steam:${steamId}`;

/** Returns true if this player wasn't already tracked online (a genuine new join). */
export function playerConnected(p: Omit<OnlinePlayer, "isBot" | "connectedAt">): boolean {
  const isBot = p.steamId === "BOT";
  const key = onlineKey(p.uid, p.steamId);
  const prev = online.get(key);
  const isNew = !prev;
  online.set(key, { ...p, isBot, connectedAt: prev?.connectedAt ?? Date.now() });
  if (!isBot) distinctSteamIds.add(p.steamId);
  return isNew;
}

/** Returns how long the player stayed, in seconds (null if never seen online). */
export function playerDisconnected(uid: string, steamId: string): number | null {
  const key = onlineKey(uid, steamId);
  const p = online.get(key);
  online.delete(key);
  return p ? Math.round((Date.now() - p.connectedAt) / 1000) : null;
}

export function getOnline(): OnlinePlayer[] {
  return [...online.values()];
}

export function getStats() {
  const players = getOnline();
  const humans = players.filter((p) => !p.isBot);
  const bots = players.filter((p) => p.isBot);
  return {
    online: players.length,
    humans: humans.length,
    bots: bots.length,
    distinctPlayersSeen: distinctSteamIds.size,
  };
}
