import { beforeEach, describe, expect, test } from "bun:test";
import {
  getRtvStatus,
  handleInGameCommand,
  type InGameCommandDeps,
  resetRtvVotes,
} from "../src/inGameCommands";

function createDeps(overrides: Partial<InGameCommandDeps> = {}) {
  const said: string[] = [];
  const rconCalls: string[] = [];
  const telegrams: string[] = [];
  const audits: Array<Record<string, unknown>> = [];

  const deps: InGameCommandDeps = {
    say: async (text) => {
      said.push(text);
    },
    runRcon: async (cmd) => {
      rconCalls.push(cmd);
      return "OK";
    },
    notifyTelegram: (text) => {
      telegrams.push(text);
    },
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    getHumansCount: () => 3,
    getRank: async () => ({ rank: 2, totalRanked: 18, kills: 42, deaths: 14 }),
    getRivals: async () => ({
      fregues: { name: "ZombieKing", kills: 9 },
      algoz: { name: "NemesisX", deaths: 5 },
    }),
    getDailyMetrics: () => ({
      day: "2026-11-14",
      kills: 100,
      deaths: 50,
      peakHumans: 12,
      distinctHumans: 20,
      chatLines: 30,
      topFraggers: [],
      topWeapons: [],
    }),
    consume: () => true,
    cooldownRemaining: () => 4,
    rtvEnabled: true,
    rtvCooldownMin: 10,
    ...overrides,
  };

  return { deps, said, rconCalls, telegrams, audits };
}

describe("inGameCommands", () => {
  beforeEach(() => {
    resetRtvVotes();
  });

  test("handles !comandos, !stats, and !rival without triggering LLM", async () => {
    const { deps, said } = createDeps();
    const player = { name: "Junin", steamId: "STEAM_0:1:42" };

    expect(await handleInGameCommand(player, "!comandos", deps)).toBe(true);
    expect(said[0]).toContain("!stats");

    expect(await handleInGameCommand(player, "!stats", deps)).toBe(true);
    expect(said[1]).toContain("#2/18");
    expect(said[1]).toContain("42 kills");
    expect(said[1]).toContain("K/D 3.00");

    expect(await handleInGameCommand(player, "!rival", deps)).toBe(true);
    expect(said[2]).toContain("Fregues: ZombieKing (9x)");
    expect(said[2]).toContain("Algoz: NemesisX (5x)");

    expect(await handleInGameCommand(player, "ola galera", deps)).toBe(false);
  });

  test("accumulates !rtv votes and executes changelevel at majority", async () => {
    const { deps, said, rconCalls, telegrams, audits } = createDeps({
      getHumansCount: () => 3, // needed = ceil(3/2) = 2
    });

    await handleInGameCommand({ name: "P1", steamId: "STEAM_0:1:1" }, "!rtv zm_dust2_2k15", deps);
    expect(getRtvStatus()).toEqual([{ map: "zm_dust2_2k15", votes: 1 }]);
    expect(rconCalls).toHaveLength(0);
    expect(said[0]).toContain("1/2 votos");

    await handleInGameCommand({ name: "P2", steamId: "STEAM_0:1:2" }, "!rtv zm_dust2_2k15", deps);
    expect(rconCalls).toEqual(["changelevel zm_dust2_2k15"]);
    expect(telegrams).toHaveLength(1);
    expect(telegrams[0]).toContain("zm_dust2_2k15");
    expect(audits).toHaveLength(2);
    expect(audits[1]?.status).toBe("success");
    expect(getRtvStatus()).toEqual([]);
  });

  test("respects RTV cooldown and disabled state", async () => {
    const blocked = createDeps({
      getHumansCount: () => 1,
      consume: () => false,
      cooldownRemaining: () => 7,
    });
    await handleInGameCommand(
      { name: "P1", steamId: "STEAM_0:1:1" },
      "!rtv zm_ice_attack",
      blocked.deps,
    );
    expect(blocked.rconCalls).toHaveLength(0);
    expect(blocked.said[0]).toContain("aguarde 7 min");

    const disabled = createDeps({ rtvEnabled: false });
    await handleInGameCommand(
      { name: "P1", steamId: "STEAM_0:1:1" },
      "!rtv zm_ice_attack",
      disabled.deps,
    );
    expect(disabled.said[0]).toContain("desativada");
  });
});
