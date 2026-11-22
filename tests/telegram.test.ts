import { afterEach, describe, expect, mock, test } from "bun:test";
import { sendTelegramPhotoTo, sendTelegramTo } from "../src/telegram";

const realFetch = globalThis.fetch;

const tooMany = () =>
  new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 0 } }), {
    status: 429,
  });
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("sendTelegramTo rate limit", () => {
  // A busy group answers 429; dropping the message loses the alert silently.
  test("retries after a 429 instead of dropping the message", async () => {
    const fetchMock = mock().mockResolvedValueOnce(tooMany()).mockResolvedValueOnce(ok());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegramTo("1", "alerta");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("gives up after a bounded number of 429s", async () => {
    const fetchMock = mock(async () => tooMany());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegramTo("1", "alerta");

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("photos get the same retry", async () => {
    const fetchMock = mock().mockResolvedValueOnce(tooMany()).mockResolvedValueOnce(ok());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegramPhotoTo("1", Buffer.from([1, 2, 3]), "legenda");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
