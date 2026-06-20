import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWelcomeMessage, isSmsConfigured, sendSms } from "./sms.js";

const log = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as FastifyBaseLogger;

describe("buildWelcomeMessage", () => {
  it("fills the church name into the template", () => {
    expect(buildWelcomeMessage("Grace Chapel")).toBe(
      "Welcome to Grace Chapel! We're glad you're here.",
    );
  });
});

describe("sendSms — unconfigured (test env has no AT credentials)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports SMS as not configured", () => {
    expect(isSmsConfigured()).toBe(false);
  });

  it("no-ops without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await sendSms("+254700000000", "hi", log);
    expect(result).toEqual({ sent: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sendSms — configured", () => {
  afterEach(() => {
    delete process.env.AT_USERNAME;
    delete process.env.AT_API_KEY;
    delete process.env.AT_SENDER_ID;
    vi.unstubAllGlobals();
  });

  it("POSTs to the AT messaging endpoint with the apiKey header and a form body", async () => {
    process.env.AT_USERNAME = "sandbox";
    process.env.AT_API_KEY = "test-key";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendSms("+254700000000", "Welcome!", log);

    expect(result).toEqual({ sent: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://api.africastalking.com/version1/messaging");
    expect(init.method).toBe("POST");
    expect(init.headers.apiKey).toBe("test-key");
    const body = init.body as URLSearchParams;
    expect(body.get("username")).toBe("sandbox");
    expect(body.get("to")).toBe("+254700000000");
    expect(body.get("message")).toBe("Welcome!");
  });

  it("returns sent:false on a non-2xx response", async () => {
    process.env.AT_USERNAME = "sandbox";
    process.env.AT_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const result = await sendSms("+254700000000", "hi", log);
    expect(result).toEqual({ sent: false });
  });
});
