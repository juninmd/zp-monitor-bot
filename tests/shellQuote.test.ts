import { describe, expect, test } from "bun:test";
import { shellQuote } from "../src/podFiles";

/**
 * O nome do mapa vem do servidor e entra no `sh -c` do kubectl exec: se o
 * quoting quebrar, um mapa com aspa vira execução de comando.
 */
describe("shellQuote", () => {
  test("envolve o caminho em aspas simples", () => {
    expect(shellQuote("overviews/de_dust2.bmp")).toBe("'overviews/de_dust2.bmp'");
  });

  test("aspa simples vira a sequência POSIX fecha-escapa-reabre", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  test("tentativa de sair das aspas continua sendo um argumento só", () => {
    // A aspa injetada sai escapada, então `; id` fica dentro do literal.
    expect(shellQuote("x'; id #")).toBe("'x'\\''; id #'");
  });
});
