import { describe, expect, test } from "bun:test";
import { buildRconPacket, parseChallengeReply, stripRconReply } from "../src/goldsrcRcon";

describe("GoldSrc RCON protocol", () => {
  test("builds the challenge packet with the GoldSrc header and terminator", () => {
    expect([...buildRconPacket("challenge rcon")]).toEqual([
      255,
      255,
      255,
      255,
      ...Buffer.from("challenge rcon\0", "ascii"),
    ]);
  });

  test("parses challenge and strips packet framing from replies", () => {
    expect(
      parseChallengeReply(
        Buffer.concat([
          Buffer.from([255, 255, 255, 255]),
          Buffer.from("challenge rcon 12345\0", "ascii"),
        ]),
      ),
    ).toBe("12345");
    expect(
      stripRconReply(
        Buffer.concat([Buffer.from([255, 255, 255, 255]), Buffer.from("lstatus reply\0", "ascii")]),
      ),
    ).toBe("status reply");
  });
});
