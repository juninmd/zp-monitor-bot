export type TelegramCommand =
  | { kind: "rcon"; command: string }
  | { kind: "ask"; question: string }
  | { kind: "status" }
  | { kind: "audit" }
  | { kind: "help" }
  | { kind: "unknown" };

export function parseTelegramCommand(text: string): TelegramCommand {
  const input = text.trim();
  const normalized = input.toLowerCase();

  if (normalized === "/start" || normalized === "/help") return { kind: "help" };
  if (normalized === "/status" || normalized === "/players") return { kind: "status" };
  if (normalized === "/audit") return { kind: "audit" };

  const rcon = input.match(/^\/rcon\s+(status|stats|users|zp_telemetry_snapshot)$/i);
  if (rcon?.[1]) return { kind: "rcon", command: rcon[1].toLowerCase() };

  const map = input.match(/^\/map\s+([a-z0-9_-]{3,32})$/i);
  if (map?.[1]) return { kind: "rcon", command: `changelevel ${map[1].toLowerCase()}` };

  const explicitQuestion = input.match(/^\/ask\s+(.{2,1000})$/is);
  if (explicitQuestion?.[1]) {
    return { kind: "ask", question: explicitQuestion[1].trim() };
  }

  if (!input.startsWith("/") && input.length >= 2 && input.length <= 1000) {
    return { kind: "ask", question: input };
  }

  return { kind: "unknown" };
}
