import { afterEach, describe, expect, test } from "bun:test";
import { positiveNumber } from "../src/config";

const KEY = "ZP_TEST_POSITIVE_NUMBER";

afterEach(() => {
  delete process.env[KEY];
});

describe("positiveNumber", () => {
  test("uses the fallback when the env var is unset", () => {
    expect(positiveNumber(KEY, "3000")).toBe(3000);
  });

  // A blank ConfigMap/Helm value arrives as "" and must not crash startup.
  test("treats blank values as unset", () => {
    process.env[KEY] = "";
    expect(positiveNumber(KEY, "3000")).toBe(3000);
    process.env[KEY] = "   ";
    expect(positiveNumber(KEY, "3000")).toBe(3000);
  });

  test("reads a valid value", () => {
    process.env[KEY] = " 5000 ";
    expect(positiveNumber(KEY, "3000")).toBe(5000);
  });

  test("still rejects zero, negative and non-numeric values", () => {
    for (const v of ["0", "-1", "abc"]) {
      process.env[KEY] = v;
      expect(() => positiveNumber(KEY, "3000")).toThrow(`${KEY} must be a positive number`);
    }
  });
});
