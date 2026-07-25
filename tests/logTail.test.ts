import { describe, expect, test } from "bun:test";
import { selectLogPod } from "../src/logTail";

describe("selectLogPod", () => {
  test("prefers the newest running pod and ignores terminating pods", () => {
    expect(
      selectLogPod([
        {
          metadata: {
            name: "old",
            creationTimestamp: "2026-07-25T10:00:00Z",
            deletionTimestamp: "2026-07-25T11:00:00Z",
          },
          status: { phase: "Running" },
        },
        {
          metadata: { name: "pending", creationTimestamp: "2026-07-25T12:00:00Z" },
          status: { phase: "Pending" },
        },
        {
          metadata: { name: "current", creationTimestamp: "2026-07-25T11:00:00Z" },
          status: { phase: "Running" },
        },
      ]),
    ).toBe("current");
  });
});
