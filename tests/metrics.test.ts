import { describe, expect, test } from "bun:test";
import {
  getMetrics,
  recordHumanChat,
  recordHumanSeen,
  recordKill,
  samplePeakHumans,
} from "../src/metrics";

describe("metrics diárias", () => {
  test("conta kills e mortes apenas com humanos reais", () => {
    recordKill({
      killerName: "A",
      killerSteamId: "STEAM_0:0:1",
      victimName: "B",
      victimSteamId: "STEAM_0:0:2",
      weapon: "knife",
    });
    // Matar bot não infla o placar.
    recordKill({
      killerName: "A",
      killerSteamId: "STEAM_0:0:1",
      victimName: "Bot01",
      victimSteamId: "BOT",
      weapon: "ak47",
    });
    // Morrer para bot conta como morte do humano.
    recordKill({
      killerName: "Bot01",
      killerSteamId: "BOT",
      victimName: "C",
      victimSteamId: "STEAM_0:0:3",
      weapon: "deagle",
    });
    const metrics = getMetrics();
    expect(metrics.kills).toBe(1);
    expect(metrics.deaths).toBe(2);
    // Top fraggers só lista quem matou; C (0 kills, 1 morte) fica de fora.
    expect(metrics.topFraggers).toEqual([{ name: "A", kills: 1, deaths: 0 }]);
    expect(metrics.topWeapons).toEqual([["knife", 1]]);
  });

  test("acumula chat, distintos e pico de humanos", () => {
    recordHumanChat();
    recordHumanChat();
    recordHumanSeen("STEAM_0:0:1");
    recordHumanSeen("STEAM_0:0:2");
    samplePeakHumans(2);
    samplePeakHumans(5);
    samplePeakHumans(3);
    const metrics = getMetrics();
    expect(metrics.chatLines).toBe(2);
    expect(metrics.distinctHumans).toBe(2);
    expect(metrics.peakHumans).toBe(5);
  });
});
