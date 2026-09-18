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

  test("lê CDATA sem decodificar entidades literais dentro dele", () => {
    const parsed = parseProfileXml(`<profile>
      <steamID><![CDATA[ Nick <tag> &amp; ]]></steamID>
      <avatarFull><![CDATA[https://avatars.akamai.steamstatic.com/abc_full.jpg?a=1&b=2]]></avatarFull>
    </profile>`);
    expect(parsed.profileName).toBe("Nick <tag> &amp;");
    expect(parsed.avatarUrl).toBe("https://avatars.akamai.steamstatic.com/abc_full.jpg?a=1&b=2");
  });

  test("decodifica entidades XML uma vez e preserva referências inválidas", () => {
    const parsed = parseProfileXml(`<profile>
      <steamID>&lt;Nick&gt; &amp; &quot;x&quot; &apos;y&apos; &#65; &#x42; &amp;lt; &#x110000;</steamID>
      <avatarFull>https://avatars.akamai.steamstatic.com/a.jpg?a=1&amp;b=2</avatarFull>
      <realName><![CDATA[ ]]></realName>
    </profile>`);
    expect(parsed.profileName).toBe("<Nick> & \"x\" 'y' A B &lt; &#x110000;");
    expect(parsed.avatarUrl).toBe("https://avatars.akamai.steamstatic.com/a.jpg?a=1&b=2");
    expect(parsed.realName).toBeNull();
  });

  test("countryFlag vira emoji regional, e rejeita código inválido", () => {
    expect(countryFlag("BR")).toBe("🇧🇷");
    expect(countryFlag("br")).toBe("");
    expect(countryFlag(null)).toBe("");
  });
});
