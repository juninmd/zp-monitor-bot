import { describe, expect, test } from "bun:test";
import {
  type GameMasterDependencies,
  handleGameMasterKill,
  handleGameMasterMode,
  resetPlayerStreak,
} from "../src/gameMaster";

function makeDeps(overrides: Partial<GameMasterDependencies> = {}): {
  deps: GameMasterDependencies;
  said: string[];
} {
  const said: string[] = [];
  const deps: GameMasterDependencies = {
    enabled: true,
    cooldownMin: 3,
    consume: () => true,
    say: async (text) => {
      said.push(text);
    },
    ...overrides,
  };
  return { deps, said };
}

describe("gameMaster", () => {
  test("announces kill streaks at 5 and 10 and resets when player dies", async () => {
    const { deps, said } = makeDeps();
    const killer = { steamId: "STEAM_0:1:100", name: "Junin" };
    const victim = { steamId: "STEAM_0:1:200", name: "Zumbi" };

    resetPlayerStreak(killer.steamId);
    for (let i = 0; i < 4; i++) {
      expect(await handleGameMasterKill(killer, victim, "ak47", deps)).toBeNull();
    }
    const fifth = await handleGameMasterKill(killer, victim, "ak47", deps);
    expect(fifth).toContain("5 kills seguidos");
    expect(fifth).toContain("ak47");
    expect(said).toHaveLength(1);

    for (let i = 0; i < 4; i++) {
      await handleGameMasterKill(killer, victim, "ak47", deps);
    }
    const tenth = await handleGameMasterKill(killer, victim, "ak47", deps);
    expect(tenth).toContain("10 kills");
    expect(said).toHaveLength(2);

    // Killer dies -> streak resets
    await handleGameMasterKill(victim, killer, "infection", deps);
    expect(await handleGameMasterKill(killer, victim, "ak47", deps)).toBeNull();
    resetPlayerStreak(killer.steamId);
  });

  test("ignores BOT kills and respects global cooldown / disabled flag", async () => {
    const { deps, said } = makeDeps();
    expect(
      await handleGameMasterKill(
        { steamId: "BOT", name: "PodBot" },
        { steamId: "STEAM_0:1:200", name: "Zumbi" },
        "m4a1",
        deps,
      ),
    ).toBeNull();

    const blocked = makeDeps({ consume: () => false });
    const k = { steamId: "STEAM_0:1:300", name: "Alpha" };
    const v = { steamId: "STEAM_0:1:200", name: "Beta" };
    resetPlayerStreak(k.steamId);
    for (let i = 0; i < 5; i++) {
      await handleGameMasterKill(k, v, "awp", blocked.deps);
    }
    expect(blocked.said).toHaveLength(0);

    const disabled = makeDeps({ enabled: false });
    expect(await handleGameMasterMode("nemesis", disabled.deps)).toBeNull();
    expect(said).toHaveLength(0);
  });

  test("announces ZP special modes once per transition", async () => {
    const { deps, said } = makeDeps();
    const msg = await handleGameMasterMode("Nemesis", deps);
    expect(msg).toContain("MODO NEMESIS");
    // Same mode repeated -> ignored
    expect(await handleGameMasterMode("nemesis", deps)).toBeNull();
    // New mode -> announced
    const plague = await handleGameMasterMode("Plague", deps);
    expect(plague).toContain("MODO PLAGUE");
    expect(said).toHaveLength(2);
  });
});
