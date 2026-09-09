import { describe, expect, test } from "bun:test";
import { describeSignals, type SteamSignals } from "../src/steamSignals";

const base: SteamSignals = {
  vacBans: 0,
  gameBans: 0,
  communityBanned: false,
  daysSinceLastBan: null,
  csHours: [],
  ownsNoCs: false,
};

describe("describeSignals", () => {
  test("conta limpa e jogos privados não geram linha nenhuma", () => {
    expect(describeSignals(base)).toEqual([]);
    expect(describeSignals(null)).toEqual([]);
  });

  test("destaca bans com o tempo desde o último", () => {
    const lines = describeSignals({
      ...base,
      vacBans: 2,
      gameBans: 1,
      daysSinceLastBan: 412,
    });
    expect(lines[0]).toContain("2× VAC");
    expect(lines[0]).toContain("1× game ban");
    expect(lines[0]).toContain("412d");
  });

  test("lista horas de CS da maior para a menor", () => {
    const lines = describeSignals({
      ...base,
      csHours: [
        { game: "CS 1.6", hours: 14200 },
        { game: "CS: Source", hours: 30 },
      ],
    });
    expect(lines[0]).toContain("CS 1.6: 14.200h");
    expect(lines[0]).toContain("CS: Source: 30h");
  });

  test("lista de jogos visível e sem CS aponta provável non-steam", () => {
    expect(describeSignals({ ...base, ownsNoCs: true })[0]).toContain("non-steam");
    // Jogos privados (ownsNoCs=false, csHours vazio) não afirmam nada.
    expect(describeSignals(base)).toEqual([]);
  });
});
