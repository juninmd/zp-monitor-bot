import { describe, expect, test } from "bun:test";
import { countryFlag, parseProfileXml } from "../src/steamProfile";

describe("steamProfile", () => {
  test("parseProfileXml lê o perfil XML público", () => {
    expect(
      parseProfileXml(`<profile>
  <steamID>junin_gamer</steamID>
  <realName>Junior</realName>
  <country>BR</country>
  <avatarFull>https://avatars.akamai.steamstatic.com/abc_full.jpg</avatarFull>
</profile>`),
    ).toEqual({
      profileName: "junin_gamer",
      realName: "Junior",
      countryCode: "BR",
      avatarUrl: "https://avatars.akamai.steamstatic.com/abc_full.jpg",
    });
    expect(parseProfileXml("<profile></profile>").profileName).toBeNull();
  });

  test("countryFlag vira emoji regional, e rejeita código inválido", () => {
    expect(countryFlag("BR")).toBe("🇧🇷");
    expect(countryFlag("br")).toBe("");
    expect(countryFlag(null)).toBe("");
  });
});
