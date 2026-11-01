import { expect, test } from "bun:test";
import { monitorState } from "../src/monitorState";
import { chatContext, teamIcon } from "../src/notifier";

test("ícone de time: T é zumbi, CT é humano, o resto não ganha ícone", () => {
  expect(teamIcon("TERRORIST")).toBe("🧟 ");
  expect(teamIcon("CT")).toBe("🧍 ");
  expect(teamIcon("SPECTATOR")).toBe("");
});

test("contexto do chat traz reais x bots e o mapa escapado", () => {
  monitorState.connection.online = true;
  monitorState.playersSource = "status";
  monitorState.info = {
    name: "x",
    map: "zm_<a>",
    players: 3,
    maxplayers: 32,
    bots: 5,
    password: false,
    ping: null,
  };
  expect(chatContext()).toBe("👥 3 real(is) + 5 bot(s) · 🗺️ zm_&lt;a&gt;");
});
