import { beforeEach, describe, expect, test } from "bun:test";
import { clearMapKills, deathSpots, recordMapKill, summarizeMap } from "../src/killFeed";

const kill = (map: string, killer: string, steam: string, weapon = "ak47") => ({
  map,
  killerName: killer,
  killerSteamId: steam,
  victimSteamId: "BOT",
  weapon,
  x: 1,
  y: 2,
});

describe("killFeed", () => {
  beforeEach(clearMapKills);

  test("separa os pontos de morte por mapa", () => {
    recordMapKill(kill("zm_a", "A", "STEAM_0:0:1"));
    recordMapKill(kill("zm_b", "A", "STEAM_0:0:1"));
    expect(deathSpots("zm_a")).toEqual([{ x: 1, y: 2 }]);
  });

  test("MVP ignora bots e ordena por kills; drop limpa só aquele mapa", () => {
    recordMapKill(kill("zm_a", "Junin", "STEAM_0:0:1"));
    recordMapKill(kill("zm_a", "Junin", "STEAM_0:0:1", "m4a1"));
    recordMapKill(kill("zm_a", "Menor", "STEAM_0:0:2"));
    recordMapKill(kill("zm_a", "Bot", "BOT"));
    recordMapKill(kill("zm_b", "Outro", "STEAM_0:0:3"));
    const summary = summarizeMap("zm_a", true);
    expect(summary?.kills).toBe(4);
    expect(summary?.topFraggers).toEqual([
      { name: "Junin", kills: 2 },
      { name: "Menor", kills: 1 },
    ]);
    expect(summary?.topWeapon).toEqual({ weapon: "ak47", kills: 2 });
    expect(summarizeMap("zm_a")).toBeNull();
    expect(deathSpots("zm_b")).toHaveLength(1);
  });
});
