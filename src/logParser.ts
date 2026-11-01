export type LogEvent =
  | { type: "connect"; name: string; uid: string; steamId: string; ip: string }
  | { type: "validated"; name: string; uid: string; steamId: string }
  | { type: "entered"; name: string; uid: string; steamId: string; team: string }
  | { type: "disconnect"; name: string; uid: string; steamId: string; team: string; reason: string }
  | {
      type: "say";
      name: string;
      uid: string;
      steamId: string;
      team: string;
      message: string;
      teamOnly: boolean;
    }
  | {
      type: "kill";
      killer: { name: string; uid: string; steamId: string; team: string };
      victim: { name: string; uid: string; steamId: string; team: string };
      weapon: string;
      /** Posição de mundo da vítima na hora da morte (alimenta o heatmap). */
      victimPos: { x: number; y: number };
    };

const CONNECT_RE = /"(.+?)<(\d+)><(STEAM_[^>]+|BOT)><>" connected, address "([^"]*)"/;
const VALIDATED_RE = /"(.+?)<(\d+)><(STEAM_[^>]+|BOT)><>" STEAM USERID validated/;
const ENTERED_RE = /"(.+?)<(\d+)><(STEAM_[^>]+|BOT)><([^>]*)>" entered the game/;
const DISCONNECT_RE =
  /"(.+?)<(\d+)><(STEAM_[^>]+|BOT)><([^>]*)>" disconnected(?: \(reason "([^"]*)"\))?/;
const SAY_RE = /"(.+?)<(\d+)><(STEAM_[^>]+|BOT)><([^>]*)>" (say|say_team) "(.*)"/;
// "Fulano<7><STEAM_0:0:123><CT>" [-258 1340 18] killed "Cicrano<8><STEAM_0:0:456><T>" [100 200 30] with "knife"
const KILL_RE =
  /^"(.+?)<(\d+)><(STEAM_[^>]+|BOT)><([^>]*)>" \[\s*-?\d+\s+-?\d+\s+-?\d+\s*\] killed "(.+?)<(\d+)><(STEAM_[^>]+|BOT)><([^>]*)>" \[\s*(-?\d+)\s+(-?\d+)\s+-?\d+\s*\] with "([^"]*)"/;

export function parseLine(line: string): LogEvent | null {
  let m = line.match(CONNECT_RE);
  if (m)
    return {
      type: "connect",
      name: m[1] ?? "",
      uid: m[2] ?? "",
      steamId: m[3] ?? "",
      ip: m[4] ?? "",
    };

  m = line.match(VALIDATED_RE);
  if (m)
    return {
      type: "validated",
      name: m[1] ?? "",
      uid: m[2] ?? "",
      steamId: m[3] ?? "",
    };

  m = line.match(ENTERED_RE);
  if (m)
    return {
      type: "entered",
      name: m[1] ?? "",
      uid: m[2] ?? "",
      steamId: m[3] ?? "",
      team: m[4] ?? "",
    };

  m = line.match(DISCONNECT_RE);
  if (m)
    return {
      type: "disconnect",
      name: m[1] ?? "",
      uid: m[2] ?? "",
      steamId: m[3] ?? "",
      team: m[4] ?? "",
      reason: m[5] ?? "",
    };

  m = line.match(SAY_RE);
  if (m)
    return {
      type: "say",
      name: m[1] ?? "",
      uid: m[2] ?? "",
      steamId: m[3] ?? "",
      team: m[4] ?? "",
      teamOnly: m[5] === "say_team",
      message: m[6] ?? "",
    };

  m = line.match(KILL_RE);
  if (m)
    return {
      type: "kill",
      killer: {
        name: m[1] ?? "",
        uid: m[2] ?? "",
        steamId: m[3] ?? "",
        team: m[4] ?? "",
      },
      victim: {
        name: m[5] ?? "",
        uid: m[6] ?? "",
        steamId: m[7] ?? "",
        team: m[8] ?? "",
      },
      weapon: m[11] ?? "",
      victimPos: { x: Number(m[9]), y: Number(m[10]) },
    };

  return null;
}
