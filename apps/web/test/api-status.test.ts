import { describe, expect, it, vi } from "vitest";
import { API_BASE, checkApiHealth } from "../src/api-status.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("checkApiHealth", () => {
  it("usa o caminho relativo /api/v1 (nunca localhost)", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ status: "ok" })));
    await checkApiHealth(fetchFn);
    expect(API_BASE).toBe("/api/v1");
    expect(fetchFn).toHaveBeenCalledWith("/api/v1/health", expect.any(Object));
  });

  it("online quando a API responde { status: 'ok' }", async () => {
    await expect(checkApiHealth(() => Promise.resolve(jsonResponse({ status: "ok" })))).resolves.toBe(
      "online",
    );
  });

  it.each([
    ["erro HTTP", () => Promise.resolve(jsonResponse({ status: "ok" }, 503))],
    ["corpo inesperado", () => Promise.resolve(jsonResponse({ status: "down" }))],
    ["corpo não JSON", () => Promise.resolve(new Response("<html>", { status: 200 }))],
    ["falha de rede", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("offline com %s", async (_label, fetchFn) => {
    await expect(checkApiHealth(fetchFn)).resolves.toBe("offline");
  });
});
