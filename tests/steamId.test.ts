import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { cleanSteamIdParam, describeSteamId, formatDuration } from "../src/steamId";

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

test("cleanSteamIdParam rejeita vazio e BOT e limita o tamanho", () => {
  expect(cleanSteamIdParam("")).toBeNull();
  expect(cleanSteamIdParam("BOT")).toBeNull();
  expect(cleanSteamIdParam("STEAM_0:1:36728267")).toBe("STEAM_0:1:36728267");
  expect(cleanSteamIdParam("x".repeat(100))).toHaveLength(64);
});

test("o Elysia já decodifica :steamId; um segundo decodeURIComponent quebraria com % solto", async () => {
  const app = new Elysia().get("/p/:steamId", ({ params }) => cleanSteamIdParam(params.steamId));
  const get = async (path: string) =>
    (await app.handle(new Request(`http://localhost${path}`))).text();
  expect(await get("/p/STEAM_0%3A1%3A5")).toBe("STEAM_0:1:5");
  expect(await get("/p/100%25")).toBe("100%");
  expect(() => decodeURIComponent("100%")).toThrow(URIError);
});
