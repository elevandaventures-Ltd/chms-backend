import { describe, expect, it } from "vitest";
import { allowedNextStatuses, canTransition } from "./member-status.js";

describe("canTransition", () => {
  it("allows documented lifecycle moves", () => {
    expect(canTransition("prospect", "visitor")).toBe(true);
    expect(canTransition("visitor", "active")).toBe(true);
    expect(canTransition("active", "inactive")).toBe(true);
    expect(canTransition("inactive", "active")).toBe(true);
    expect(canTransition("active", "transferred")).toBe(true);
    expect(canTransition("archived", "active")).toBe(true);
  });

  it("rejects disallowed moves", () => {
    expect(canTransition("deceased", "active")).toBe(false);
    expect(canTransition("prospect", "deceased")).toBe(false);
    expect(canTransition("transferred", "inactive")).toBe(false);
    expect(canTransition("visitor", "deceased")).toBe(false);
  });

  it("treats a same-status move as an allowed no-op", () => {
    expect(canTransition("active", "active")).toBe(true);
    expect(canTransition("deceased", "deceased")).toBe(true);
  });
});

describe("allowedNextStatuses", () => {
  it("returns the configured targets and excludes the current status", () => {
    expect(allowedNextStatuses("deceased")).toEqual(["archived"]);
    expect(allowedNextStatuses("active")).toContain("inactive");
    expect(allowedNextStatuses("active")).not.toContain("active");
  });
});
