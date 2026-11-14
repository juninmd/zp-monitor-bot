import { describe, expect, test } from "bun:test";
import { parsePositionsReply, parseSnapshotReply } from "../src/rcon";

describe("rcon telemetry parsers", () => {
  test("parses intact and truncated zp_telemetry_snapshot payloads without throwing", () => {
    const truncated =
      '{"round":{"phase":"active","mode":"Nemesis","elapsed":48,"timeLimit":180},"zombies":5,"humans":7,"events":[{"kind":"infection","message":"Junin virou zumbi","t":120},{"kind":"nemesis","message":"Boss spawnou"';
    const parsed = parseSnapshotReply(truncated);
    expect(parsed).toEqual({
      round: { phase: "active", mode: "Nemesis", elapsed: 48, timeLimit: 180 },
      zombies: 5,
      humans: 7,
      events: [{ kind: "infection", message: "Junin virou zumbi", t: 120 }],
    });
  });

  test("returns null when snapshot header is missing", () => {
    expect(parseSnapshotReply("random rcon noise")).toBeNull();
  });

  test("salvages complete player coordinate objects from truncated positions reply", () => {
    const raw =
      '[{"t":"h","x":120,"y":-450,"a":90},{"t":"z","x":-30,"y":88,"a":180},{"t":"z","x":12';
    expect(parsePositionsReply(raw)).toEqual([
      { team: "h", x: 120, y: -450, angle: 90 },
      { team: "z", x: -30, y: 88, angle: 180 },
    ]);
  });
});
