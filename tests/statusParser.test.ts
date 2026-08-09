import { expect, test } from "bun:test";
import { parseStatus, splitByStatus } from "../src/statusParser";

const REPLY = `hostname:  [BR] ZOMBIE PLAGUE
version :  48/1.1.2.7/Stdio 4419 secure  (10)
tcp/ip  :  0.0.0.0:27015
map     :  zm_dust2_2k15 at: 0 x, 0 y, 0 z
players :  3 active (32 max)

#      name userid uniqueid frag time ping loss adr
# 1  "Menor" 1 BOT  31 47:09    0    0
# 2 "Camper99" 2 BOT  20 47:09    0    0
# 3 "Junin" 3 STEAM_0:1:36728267  4 1:02:11   26    0 179.104.218.53:27005
3 users
`;

test("lê o flag BOT/STEAM de cada cliente do status", () => {
  const clients = parseStatus(REPLY);
  expect(clients.map((c) => [c.name, c.isBot])).toEqual([
    ["Menor", true],
    ["Camper99", true],
    ["Junin", false],
  ]);
  expect(clients[2]?.uniqueId).toBe("STEAM_0:1:36728267");
  expect(clients[2]?.time).toBe(3731);
  expect(clients[2]?.ping).toBe(26);
  expect(clients[0]?.time).toBe(2829);
});

test("descarta linhas truncadas em vez de parsear pela metade", () => {
  expect(parseStatus('# 1  "Menor" 1 BOT  31 47:0')).toEqual([]);
});

test("separa humano de bot mesmo quando o humano é o cliente mais antigo", () => {
  // O caso que a heurística do gamedig erra: o humano atravessou uma troca de
  // mapa, então o timer dele é maior que o de qualquer bot.
  const listed = [
    { name: "Menor", time: 2829 },
    { name: "Camper99", time: 2829 },
    { name: "Junin", time: 3731 },
  ];
  const split = splitByStatus(listed, parseStatus(REPLY));
  expect(split?.humans.map((p) => p.name)).toEqual(["Junin"]);
  expect(split?.bots.map((p) => p.name)).toEqual(["Menor", "Camper99"]);
});

test("consome um match por vez quando o nick se repete", () => {
  const clients = parseStatus(`# 1 "Menor" 1 BOT 0 1:00 0 0
# 2 "Menor" 2 STEAM_0:0:1 0 1:00 30 0 1.2.3.4:27005`);
  const split = splitByStatus([{ name: "Menor" }, { name: "Menor" }], clients);
  expect(split?.humans).toHaveLength(1);
  expect(split?.bots).toHaveLength(1);
});

test("devolve null quando o status está vazio ou truncado", () => {
  expect(splitByStatus([{ name: "a" }], [])).toBeNull();
  const partial = parseStatus('# 1 "Menor" 1 BOT 0 1:00 0 0');
  expect(splitByStatus([{ name: "Menor" }, { name: "Junin" }], partial)).toBeNull();
});
