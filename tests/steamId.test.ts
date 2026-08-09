import { expect, test } from "bun:test";
import { describeSteamId, formatDuration } from "../src/steamId";

test("converte authid Steam real em SteamID64 + link de perfil", () => {
  const info = describeSteamId("STEAM_0:1:36728267");
  expect(info.steam64).toBe("76561198033722263");
  expect(info.profileUrl).toBe(`https://steamcommunity.com/profiles/${info.steam64}`);
  expect(info.origin).toBe("Steam");
});

test("não monta link para id sintético do ReUnion", () => {
  // Universos 2/3 são os ids que o ReUnion gera para cliente non-Steam; montar
  // a URL daria o perfil de um terceiro qualquer.
  for (const raw of ["STEAM_2:1:1301146026", "STEAM_3:1:454600656"]) {
    const info = describeSteamId(raw);
    expect(info.steam64).toBeNull();
    expect(info.profileUrl).toBeNull();
    expect(info.origin).toContain("non-Steam");
  }
});

test("não quebra em authid fora do formato", () => {
  const info = describeSteamId("BOT");
  expect(info.steam64).toBeNull();
  expect(info.origin).toBe("authid não reconhecido");
});

test("formata duração", () => {
  expect(formatDuration(45)).toBe("45s");
  expect(formatDuration(151)).toBe("2min 31s");
  expect(formatDuration(3731)).toBe("1h 2min");
});
