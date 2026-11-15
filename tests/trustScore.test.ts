import { describe, expect, test } from "bun:test";
import type { SteamSignals } from "../src/steamSignals";
import {
  evaluateTrust,
  getRecentKillsPerMin,
  recordKillTimestamp,
  shouldSendTrustAlert,
} from "../src/trustScore";

function cleanSignals(overrides: Partial<SteamSignals> = {}): SteamSignals {
  return {
    vacBans: 0,
    gameBans: 0,
    daysSinceLastBan: null,
    communityBanned: false,
    csHours: [{ game: "Counter-Strike", hours: 350 }],
    ownsNoCs: false,
    ...overrides,
  };
}

describe("trustScore", () => {
  test("classifies veteran Steam player with high CS hours as trusted", () => {
    const res = evaluateTrust({
      origin: "Steam",
      signals: cleanSignals(),
      previousNamesCount: 1,
      visits: 12,
      recentKillsPerMin: 2,
    });
    expect(res.level).toBe("trusted");
    expect(res.score).toBe(95);
    expect(res.reasons.some((r) => r.includes("veterano"))).toBe(true);
    expect(res.reasons.some((r) => r.includes("350h de CS"))).toBe(true);
  });

  test("flags non-Steam newcomer without CS and many aliases as watch", () => {
    const res = evaluateTrust({
      origin: "non-Steam",
      signals: cleanSignals({ csHours: [], ownsNoCs: true }),
      previousNamesCount: 4,
      visits: 0,
      recentKillsPerMin: 9,
    });
    expect(res.level).toBe("watch");
    expect(res.score).toBeLessThan(40);
    expect(res.reasons).toEqual(
      expect.arrayContaining([
        "primeira visita",
        "4 nicks anteriores",
        "cliente non-Steam (ReUnion)",
        "sem CS na conta Steam",
        "pico de 9 kills/min",
      ]),
    );
  });

  test("marks VAC / Game / Community bans as high_risk and triggers alert once per window", () => {
    const steamId = "STEAM_0:1:999888";
    const summary = evaluateTrust({
      origin: "Steam",
      signals: cleanSignals({ vacBans: 2, daysSinceLastBan: 14, gameBans: 1 }),
      previousNamesCount: 0,
      visits: 3,
    });
    expect(summary.level).toBe("high_risk");
    expect(summary.score).toBe(0);
    expect(shouldSendTrustAlert(steamId, summary)).toBe(true);
    // Deduplicado dentro da janela de 6h
    expect(shouldSendTrustAlert(steamId, summary)).toBe(false);
  });

  test("never alerts on non-high_risk profiles", () => {
    const neutral = evaluateTrust({
      origin: "Steam",
      signals: null,
      previousNamesCount: 0,
      visits: 2,
    });
    expect(neutral.level).toBe("neutral");
    expect(shouldSendTrustAlert("STEAM_0:0:123456", neutral)).toBe(false);
  });

  test("tracks rolling 60s kill timestamps and ignores BOT", () => {
    expect(recordKillTimestamp("BOT", 10_000)).toBe(0);
    const id = "STEAM_0:1:555111";
    expect(recordKillTimestamp(id, 10_000)).toBe(1);
    expect(recordKillTimestamp(id, 20_000)).toBe(2);
    expect(recordKillTimestamp(id, 75_000)).toBe(2); // 10_000 expired (>60s), 20_000 & 75_000 active
    expect(getRecentKillsPerMin(id, 75_000)).toBe(2);
    expect(getRecentKillsPerMin(id, 200_000)).toBe(0);
  });
});
