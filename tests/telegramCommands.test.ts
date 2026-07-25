import { describe, expect, test } from "bun:test";
import { parseTelegramCommand } from "../src/telegramCommands";

describe("parseTelegramCommand", () => {
  test("accepts an allowlisted remote status command", () => {
    expect(parseTelegramCommand("/rcon status")).toEqual({
      kind: "rcon",
      command: "status",
    });
  });

  test("rejects command injection and commands outside the allowlist", () => {
    expect(parseTelegramCommand("/rcon status; quit")).toEqual({ kind: "unknown" });
    expect(parseTelegramCommand("/rcon quit")).toEqual({ kind: "unknown" });
  });

  test("normalizes safe map changes and questions", () => {
    expect(parseTelegramCommand("/map zm_dust2_2k15")).toEqual({
      kind: "rcon",
      command: "changelevel zm_dust2_2k15",
    });
    expect(parseTelegramCommand("/ask Como funciona o modo Nemesis?")).toEqual({
      kind: "ask",
      question: "Como funciona o modo Nemesis?",
    });
    expect(parseTelegramCommand("O que são Ammo Packs?")).toEqual({
      kind: "ask",
      question: "O que são Ammo Packs?",
    });
    expect(parseTelegramCommand("/audit")).toEqual({ kind: "audit" });
  });
});
