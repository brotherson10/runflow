import { QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api.ts";
import {
  createQueryClient,
  resetToSignedOut,
  SESSION_EXPIRED_KEY,
  SESSION_KEY,
  setUnauthorizedHandler,
  userKeys,
} from "../src/lib/query.ts";

const user = { id: "u1", name: "Corredora", email: "corredora@example.test", timeZone: "Europe/Lisbon" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("resetToSignedOut (sessão expirada / logout)", () => {
  it("o observador da sessão já ligado vê null e os dados privados desaparecem", async () => {
    const client = createQueryClient();
    client.setQueryData(SESSION_KEY, { user });
    client.setQueryData(userKeys.goal(user.id), { goal: { id: "g1" } });
    client.setQueryData(userKeys.workouts(user.id), { items: [] });
    const session = new QueryObserver(client, {
      queryKey: SESSION_KEY,
      queryFn: () => Promise.resolve({ user }),
      staleTime: Infinity,
    });
    const seen: unknown[] = [];
    const unsubscribe = session.subscribe((result) => seen.push(result.data));

    resetToSignedOut(client);
    await tick();

    // Com client.clear() este observador ficaria preso à query removida (ainda com o utilizador).
    expect(session.getCurrentResult().data).toBeNull();
    expect(seen.at(-1)).toBeNull();
    expect(client.getQueryData(userKeys.goal(user.id))).toBeUndefined();
    expect(client.getQueryData(userKeys.workouts(user.id))).toBeUndefined();
    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([SESSION_KEY]);
    unsubscribe();
  });

  it("401: o handler põe a sessão a null e marca-a como expirada (sem novas tentativas)", async () => {
    const client = createQueryClient();
    client.setQueryData(SESSION_KEY, { user });
    setUnauthorizedHandler(() => {
      resetToSignedOut(client);
      client.setQueryData(SESSION_EXPIRED_KEY, true);
    });
    let calls = 0;
    const page = new QueryObserver(client, {
      queryKey: userKeys.goal(user.id),
      queryFn: () => {
        calls += 1;
        return Promise.reject(new ApiError(401, "UNAUTHENTICATED", "Sessão em falta."));
      },
    });
    const unsubscribe = page.subscribe(() => undefined);
    await tick();
    await tick();
    unsubscribe();
    setUnauthorizedHandler(() => undefined);

    expect(calls).toBe(1);
    expect(client.getQueryData(SESSION_KEY)).toBeNull();
    expect(client.getQueryData(SESSION_EXPIRED_KEY)).toBe(true);
  });
});
