import { describe, expect, test } from "bun:test";
import { joinLines, playerCountLine } from "../src/playerAnnounce";
import type { SteamProfile } from "../src/steamProfile";

const profile = (profileName: string | null): SteamProfile => ({
  steam64: "76561197960265729",
  profileName,
  realName: "Nome Real",
  countryCode: "BR",
  avatarUrl: null,
  avatar: null,
  createdAt: null,
  visibility: "public",
});

describe("playerCountLine", () => {
  test("separa reais de bots e mostra o mapa atual", () => {
    expect(playerCountLine({ humans: 3, bots: 5 }, "zm_dust", 32)).toBe(
      "👥 Jogadores: <b>3</b> real(is) + 5 bot(s) de 32 · 🗺️ <b>zm_dust</b>",
    );
  });

  test("sem leitura A2S ainda, omite mapa e capacidade em vez de inventar", () => {
    expect(playerCountLine({ humans: 0, bots: 0 }, null, null)).toBe(
      "👥 Jogadores: <b>0</b> real(is) + 0 bot(s)",
    );
  });

  test("escapa nome de mapa para não quebrar o parse_mode HTML", () => {
    expect(playerCountLine({ humans: 1, bots: 0 }, "<x>&", 10)).toContain("&lt;x&gt;&amp;");
  });
});

describe("joinLines", () => {
  test("traz SteamID, nome do perfil e link, sem dados pessoais extras", () => {
    const lines = joinLines(
      "STEAM_0:1:0",
      "https://steamcommunity.com/profiles/1",
      profile("Nick <1>"),
    );
    expect(lines).toEqual([
      "🆔 <code>STEAM_0:1:0</code>",
      "🎭 Perfil: Nick &lt;1&gt;",
      '🔗 <a href="https://steamcommunity.com/profiles/1">Perfil na Steam</a>',
    ]);
    expect(lines.join("\n")).not.toContain("Nome Real");
  });

  test("id non-Steam sem perfil fica só com o SteamID", () => {
    expect(joinLines("STEAM_3:0:42", null, null)).toEqual(["🆔 <code>STEAM_3:0:42</code>"]);
  });
});
