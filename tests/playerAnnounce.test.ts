import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { announceJoin, announceLeave, joinLines, playerCountLine } from "../src/playerAnnounce";
import * as playerStore from "../src/playerStore";
import type { SteamProfile } from "../src/steamProfile";
import * as steamProfile from "../src/steamProfile";
import * as telegram from "../src/telegram";

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
      "Origem: Steam",
      "🎭 Perfil: Nick &lt;1&gt;",
      '🔗 <a href="https://steamcommunity.com/profiles/1">Perfil na Steam</a>',
    ]);
    expect(lines.join("\n")).not.toContain("Nome Real");
  });

  test("id non-Steam mostra origem ReUnion sem inventar perfil", () => {
    const lines = joinLines("STEAM_3:0:42", null, null);
    expect(lines).toContain("Origem: non-Steam (id gerado pelo ReUnion)");
    expect(lines.join("\n")).not.toContain("href");
  });
});

describe("announceJoin", () => {
  const ev = {
    type: "connect" as const,
    name: "junin",
    uid: "uid-1",
    steamId: "STEAM_0:1:0",
    ip: "127.0.0.1",
  };

  let telegramTexts: string[];
  let telegramPhotos: Array<{ caption?: string }>;
  let recordConnectMock: ReturnType<typeof spyOn<typeof playerStore, "recordConnect">>;
  let getSteamProfileMock: ReturnType<typeof spyOn<typeof steamProfile, "getSteamProfile">>;

  beforeEach(() => {
    telegramTexts = [];
    telegramPhotos = [];
    recordConnectMock = spyOn(playerStore, "recordConnect").mockResolvedValue({
      firstTime: true,
      visits: 0,
      lastSeen: null,
      totalSeconds: 0,
      previousNames: [],
    });
    getSteamProfileMock = spyOn(steamProfile, "getSteamProfile").mockResolvedValue(null);
    spyOn(telegram, "sendTelegram").mockImplementation((text) => {
      telegramTexts.push(text);
      return Promise.resolve();
    });
    spyOn(telegram, "sendTelegramPhotoTo").mockImplementation((_chatId, _photo, caption) => {
      telegramPhotos.push({ caption });
      return Promise.resolve();
    });
  });

  afterEach(() => {
    mock.restore();
  });

  test("mostra primeira visita quando o banco confirma", async () => {
    await announceJoin(ev);
    expect(telegramTexts.join("\n")).toContain("Primeira vez no servidor");
  });

  test("soma a visita atual: histórico anterior 5 vira 6ª visita", async () => {
    recordConnectMock.mockResolvedValueOnce({
      firstTime: false,
      visits: 5,
      lastSeen: new Date(),
      totalSeconds: 3600,
      previousNames: ["old <nick>"],
    });
    await announceJoin(ev);
    const body = telegramTexts.join("\n");
    expect(body).toContain("6ª visita");
    expect(body).toContain("Total: 1h 0min");
    expect(body).toContain("Já entrou como: old &lt;nick&gt;");
  });

  test("histórico desconhecido não inventa visitas", async () => {
    recordConnectMock.mockResolvedValueOnce(playerStore.UNKNOWN_HISTORY);
    await announceJoin(ev);
    const body = telegramTexts.join("\n");
    expect(body).not.toContain("visita");
    expect(body).not.toContain("Primeira vez");
  });

  test("avatar opcional vai na legenda sem cancelar aviso", async () => {
    getSteamProfileMock.mockResolvedValueOnce({
      ...profile("nick"),
      avatar: Buffer.from("png"),
    });
    await announceJoin(ev);
    expect(telegramPhotos).toHaveLength(1);
    expect(telegramPhotos[0]?.caption).toContain("entrou");
    expect(telegramTexts).toHaveLength(0);
  });

  test("perfil null não cancela aviso nem link", async () => {
    getSteamProfileMock.mockResolvedValueOnce(null);
    await announceJoin(ev);
    const body = telegramTexts.join("\n");
    expect(body).toContain("entrou");
    expect(body).toContain("Origem: Steam");
    expect(body).toContain("Perfil na Steam");
  });

  test("legenda acima de 1024 vai com headline e corpo separado", async () => {
    getSteamProfileMock.mockResolvedValueOnce({
      ...profile("n".repeat(2000)),
      avatar: Buffer.from("png"),
    });
    await announceJoin(ev);
    expect(telegramPhotos).toHaveLength(1);
    expect(telegramPhotos[0]?.caption).toContain("entrou");
    expect(telegramTexts).toHaveLength(1);
    expect(telegramTexts[0]).toContain("Jogadores:");
  });
});

describe("announceLeave", () => {
  let telegramTexts: string[];
  let telegramPhotos: Array<{ caption?: string }>;

  beforeEach(() => {
    telegramTexts = [];
    telegramPhotos = [];
    spyOn(steamProfile, "getSteamProfile").mockResolvedValue(null);
    spyOn(telegram, "sendTelegram").mockImplementation((text) => {
      telegramTexts.push(text);
      return Promise.resolve();
    });
    spyOn(telegram, "sendTelegramPhotoTo").mockImplementation((_chatId, _photo, caption) => {
      telegramPhotos.push({ caption });
      return Promise.resolve();
    });
  });

  afterEach(() => {
    mock.restore();
  });

  test("reaproveita perfil/origem e mostra duração", async () => {
    await announceLeave({
      name: "junin",
      steamId: "STEAM_0:1:0",
      reason: "Disconnect",
      seconds: 90,
    });
    const body = telegramTexts.join("\n");
    expect(body).toContain("saiu (Disconnect)");
    expect(body).toContain("Origem: Steam");
    expect(body).toContain("Ficou: 1min 30s");
  });

  test("avatar e link do perfil na saída", async () => {
    spyOn(steamProfile, "getSteamProfile").mockResolvedValueOnce({
      ...profile("nick"),
      avatar: Buffer.from("png"),
    });
    await announceLeave({
      name: "junin",
      steamId: "STEAM_0:1:0",
      reason: "Disconnect",
      seconds: 90,
    });
    expect(telegramPhotos).toHaveLength(1);
    expect(telegramPhotos[0]?.caption).toContain("saiu (Disconnect)");
    expect(telegramPhotos[0]?.caption).toContain("Perfil na Steam");
    expect(telegramTexts).toHaveLength(0);
  });

  test("escapa reason com HTML na saída", async () => {
    await announceLeave({
      name: "junin",
      steamId: "STEAM_0:1:0",
      reason: "<kick>&",
      seconds: null,
    });
    const body = telegramTexts.join("\n");
    expect(body).toContain("saiu (&lt;kick&gt;&amp;)");
  });

  test("sem duração conhecida, omite tempo em vez de inventar", async () => {
    await announceLeave({
      name: "junin",
      steamId: "STEAM_0:1:0",
      reason: "Timed out",
      seconds: null,
    });
    const body = telegramTexts.join("\n");
    expect(body).toContain("saiu (Timed out)");
    expect(body).not.toContain("Ficou");
  });
});
