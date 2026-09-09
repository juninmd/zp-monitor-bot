import { describe, expect, test } from "bun:test";
import { splitMarkedOutput } from "../src/podFiles";

const marked = (index: number, b64: string): string => `\n@@zpfile${index}@@\n${b64}`;

describe("splitMarkedOutput", () => {
  test("separa os blocos base64 de um único exec", () => {
    const text =
      marked(0, Buffer.from("txt").toString("base64")) +
      marked(1, Buffer.from("bmp").toString("base64"));
    const [first, second] = splitMarkedOutput(text, 2);
    expect(first?.toString()).toBe("txt");
    expect(second?.toString()).toBe("bmp");
  });

  test("arquivo ausente vira null sem contaminar o bloco seguinte", () => {
    const text = marked(0, "") + marked(1, Buffer.from("ok").toString("base64"));
    const [first, second] = splitMarkedOutput(text, 2);
    expect(first).toBeNull();
    expect(second?.toString()).toBe("ok");
  });

  test("saída truncada devolve null para os blocos que faltam", () => {
    expect(splitMarkedOutput(marked(0, "YQ=="), 3).slice(1)).toEqual([null, null]);
  });
});
