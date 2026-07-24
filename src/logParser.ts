export type LogEvent =
  | { type: "connect"; name: string; uid: string; steamId: string; ip: string }
  | { type: "validated"; name: string; uid: string; steamId: string }
  | { type: "entered"; name: string; uid: string; steamId: string; team: string }
  | { type: "disconnect"; name: string; uid: string; steamId: string; team: string; reason: string }
  | { type: "say"; name: string; uid: string; steamId: string; team: string; message: string; teamOnly: boolean };

const CONNECT_RE =
  /"(.+?)<(\d+)><(STEAM_[^>]+|BOT)><>" connected, address "([^"]*)"/;
const VALIDATED_RE = /"(.+?)<(\d+)><(STEAM_[^>]+|BOT)><>" STEAM USERID validated/;
const ENTERED_RE = /"(.+?)<(\d+)><(STEAM_[^>]+|BOT)><([^>]*)>" entered the game/;
const DISCONNECT_RE =
  /"(.+?)<(\d+)><(STEAM_[^>]+|BOT)><([^>]*)>" disconnected(?: \(reason "([^"]*)"\))?/;
const SAY_RE =
  /"(.+?)<(\d+)><(STEAM_[^>]+|BOT)><([^>]*)>" (say|say_team) "(.*)"/;

export function parseLine(line: string): LogEvent | null {
  let m = line.match(CONNECT_RE);
  if (m) return { type: "connect", name: m[1], uid: m[2], steamId: m[3], ip: m[4] };

  m = line.match(VALIDATED_RE);
  if (m) return { type: "validated", name: m[1], uid: m[2], steamId: m[3] };

  m = line.match(ENTERED_RE);
  if (m) return { type: "entered", name: m[1], uid: m[2], steamId: m[3], team: m[4] };

  m = line.match(DISCONNECT_RE);
  if (m)
    return {
      type: "disconnect",
      name: m[1],
      uid: m[2],
      steamId: m[3],
      team: m[4],
      reason: m[5] ?? "",
    };

  m = line.match(SAY_RE);
  if (m)
    return {
      type: "say",
      name: m[1],
      uid: m[2],
      steamId: m[3],
      team: m[4],
      teamOnly: m[5] === "say_team",
      message: m[6],
    };

  return null;
}
