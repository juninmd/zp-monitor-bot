import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/logParser";

describe("parseLine", () => {
  test("parses a real-player kill with weapon", () => {
    expect(
      parseLine(
        '"Menor<7><STEAM_0:0:12345><CT>" [-258 1340 18] killed "zumbi_pedro<8><STEAM_0:0:67890><TERRORIST>" [100 200 30] with "knife"',
      ),
    ).toEqual({
      type: "kill",
      killer: {
        name: "Menor",
        uid: "7",
        steamId: "STEAM_0:0:12345",
        team: "CT",
        pos: { x: -258, y: 1340, z: 18 },
      },
      victim: {
        name: "zumbi_pedro",
        uid: "8",
        steamId: "STEAM_0:0:67890",
        team: "TERRORIST",
        pos: { x: 100, y: 200, z: 30 },
      },
      weapon: "knife",
    });
  });

  test("parses kills involving bots (flag para filtrar nas métricas)", () => {
    const event = parseLine(
      '"Bot01<1><BOT><TERRORIST>" [1 2 3] killed "Jogador<9><STEAM_0:1:999><CT>" [4 5 6] with "weapon_ak47"',
    );
    expect(event).toEqual({
      type: "kill",
      killer: {
        name: "Bot01",
        uid: "1",
        steamId: "BOT",
        team: "TERRORIST",
        pos: { x: 1, y: 2, z: 3 },
      },
      victim: {
        name: "Jogador",
        uid: "9",
        steamId: "STEAM_0:1:999",
        team: "CT",
        pos: { x: 4, y: 5, z: 6 },
      },
      weapon: "weapon_ak47",
    });
  });

  test("ignores non-kill lines and keeps say/connect working", () => {
    expect(parseLine("blabla killed blabla")).toBeNull();
    expect(parseLine('"Fulano<1><STEAM_0:0:1><>" connected, address "1.2.3.4:27005"')).toEqual({
      type: "connect",
      name: "Fulano",
      uid: "1",
      steamId: "STEAM_0:0:1",
      ip: "1.2.3.4:27005",
    });
    expect(parseLine('"Fulano<1><STEAM_0:0:1><CT>" say "oi"')).toEqual({
      type: "say",
      name: "Fulano",
      uid: "1",
      steamId: "STEAM_0:0:1",
      team: "CT",
      teamOnly: false,
      message: "oi",
    });
  });
});
