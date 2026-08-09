export interface StatusClient {
  slot: number;
  name: string;
  uniqueId: string;
  isBot: boolean;
  frags: number;
  /** Seconds connected, as reported by the engine. */
  time: number;
  ping: number;
}

// "# 1  "Menor" 1 BOT  31 47:09    0    0"
// The name is greedy up to the LAST quote on the line so nicknames containing
// a quote still parse (the engine does not escape them).
const CLIENT_RE =
  /^#\s*(\d+)\s+"(.*)"\s+(\d+)\s+(\S+)\s+(-?\d+)\s+(\d+:\d+(?::\d+)?)\s+(\d+)\s+(\d+)/;

function clockToSeconds(clock: string): number {
  return clock.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

/**
 * Parses a GoldSrc `status` RCON reply into one entry per connected client.
 *
 * This is the only source that says whether a client is a bot: A2S_PLAYER has
 * no bot flag on GoldSrc, and the bots here are deliberately renamed to look
 * like players (zp50_bot_names), so nothing about the name gives them away.
 *
 * RCON replies can be truncated mid-line, so lines that don't fully match are
 * skipped instead of parsed partially. Callers must handle a short list.
 */
export function parseStatus(text: string): StatusClient[] {
  const clients: StatusClient[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(CLIENT_RE);
    if (!m) continue;
    const uniqueId = m[4] ?? "";
    clients.push({
      slot: Number(m[1]),
      name: m[2] ?? "",
      uniqueId,
      isBot: uniqueId === "BOT",
      frags: Number(m[5]),
      time: clockToSeconds(m[6] ?? "0:00"),
      ping: Number(m[7]),
    });
  }
  return clients;
}

/**
 * Splits an A2S player list into humans and bots using a `status` table as
 * ground truth, matching by name and consuming each match so duplicated
 * nicknames are handled one-for-one.
 *
 * Returns null when the table can't decide (empty, or truncated so it doesn't
 * cover every listed player) — the caller must then fall back.
 */
export function splitByStatus<T extends { name: string }>(
  listed: T[],
  clients: StatusClient[],
): { humans: T[]; bots: T[] } | null {
  if (!clients.length || clients.length < listed.length) return null;

  const remainingBots = new Map<string, number>();
  for (const client of clients) {
    if (!client.isBot) continue;
    remainingBots.set(client.name, (remainingBots.get(client.name) ?? 0) + 1);
  }

  const humans: T[] = [];
  const bots: T[] = [];
  for (const player of listed) {
    const left = remainingBots.get(player.name) ?? 0;
    if (left > 0) {
      remainingBots.set(player.name, left - 1);
      bots.push(player);
      continue;
    }
    humans.push(player);
  }
  return { humans, bots };
}
