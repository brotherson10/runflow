import { LIMITS } from "@runflow/shared";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "../../src/db/client.ts";
import { fakeHibp, type HibpMode } from "../support/fake-network.ts";
import {
  AUTH,
  newUserInput,
  signedInClient,
  startAuthServer,
  TestClient,
  tokenFromMail,
  waitForMail,
  type AuthTestServer,
} from "./support/auth-harness.ts";
import { freshMigratedTestDatabase } from "./support/test-database.ts";

// Palavras-passe fictícias, só conhecidas do HIBP simulado (test/support/fake-network.ts).
const COMPROMISED = "palavra-passe-que-ja-vazou-2026";
const SAFE = "uma frase longa sem regras";
const UNAVAILABLE_MODES: HibpMode[] = ["unavailable", "network-error", "hang"];

interface Problem {
  code?: string;
  message?: string;
}

async function userExists(handle: DatabaseHandle, email: string): Promise<boolean> {
  const { rowCount } = await handle.pool.query(`select 1 from "user" where email = $1`, [email]);
  return rowCount === 1;
}

describe("política de palavra-passe (15–128, sem composição) e HIBP", () => {
  let handle: DatabaseHandle;
  let server: AuthTestServer;

  beforeAll(async () => {
    handle = await freshMigratedTestDatabase();
    // Timeout curto para o caso "hang": a recusa chega sem esperar 5 s.
    server = await startAuthServer(handle, { passwordBreachCheck: { enabled: true, timeoutMs: 300 } });
  });

  afterAll(async () => {
    await server.close();
    await handle.close();
  });

  it.each([
    ["14 caracteres", "a".repeat(14), 400, "PASSWORD_TOO_SHORT"],
    ["15 caracteres, só minúsculas", "a".repeat(15), 200, undefined],
    ["frase com espaços", SAFE, 200, undefined],
    ["128 caracteres", "p".repeat(128), 200, undefined],
    ["129 caracteres", "p".repeat(129), 400, "PASSWORD_TOO_LONG"],
  ])("registo com %s → %d", async (_label, password, status, code) => {
    const calls = fakeHibp.calls;
    const res = await new TestClient(server.baseUrl).post<Problem>(`${AUTH}/sign-up/email`, newUserInput({ password }));
    expect(res.status).toBe(status);
    if (code) expect(res.body.code).toBe(code);
    // Fora dos limites não há consulta externa; dentro, exatamente uma.
    expect(fakeHibp.calls - calls).toBe(status === 200 ? 1 : 0);
  });

  it("os limites partilhados são 15 e 128", () => {
    expect(LIMITS.passwordLength).toEqual({ min: 15, max: 128 });
  });

  it("palavra-passe comprometida: 400 no registo, também para e-mail já existente (neutro)", async () => {
    fakeHibp.compromised.set(COMPROMISED, 12_345);
    const { input } = await signedInClient(server);
    const fresh = newUserInput({ password: COMPROMISED });
    const forNew = await new TestClient(server.baseUrl).post<Problem>(`${AUTH}/sign-up/email`, fresh);
    const forExisting = await new TestClient(server.baseUrl).post<Problem>(`${AUTH}/sign-up/email`, {
      ...newUserInput({ password: COMPROMISED }),
      email: input.email,
    });
    expect(forNew.status).toBe(400);
    expect(forNew.body.code).toBe("PASSWORD_COMPROMISED");
    expect([forExisting.status, forExisting.body]).toEqual([forNew.status, forNew.body]);
    expect(await userExists(handle, fresh.email)).toBe(false);
  });

  it.each(UNAVAILABLE_MODES)("HIBP %s: registo recusado temporariamente (503), sem criar conta", async (mode) => {
    fakeHibp.mode = mode;
    const input = newUserInput();
    const res = await new TestClient(server.baseUrl).post<Problem>(`${AUTH}/sign-up/email`, input);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("PASSWORD_CHECK_UNAVAILABLE");
    expect(res.body.message).toMatch(/Tente novamente/);
    expect(res.text).not.toMatch(/pwnedpasswords|SHA|stack/i);
    expect(await userExists(handle, input.email)).toBe(false);
    expect(server.mailbox.find(input.email, "email-verification")).toHaveLength(0);
  });

  it("login de conta existente não depende do HIBP (nem o consulta)", async () => {
    const { input } = await signedInClient(server);
    fakeHibp.mode = "unavailable";
    const calls = fakeHibp.calls;
    const res = await new TestClient(server.baseUrl).post(`${AUTH}/sign-in/email`, {
      email: input.email,
      password: input.password,
    });
    expect(res.status).toBe(200);
    expect(fakeHibp.calls).toBe(calls);
  });

  it("conta antiga com palavra-passe de 8 caracteres continua a entrar", async () => {
    const id = `legado${String(Date.now())}`;
    const email = `${id}@example.test`;
    await handle.pool.query(
      `insert into "user" (id, name, email, email_verified, time_zone, created_at, updated_at)
       values ($1, 'Conta Antiga', $2, true, 'Europe/Lisbon', now(), now())`,
      [id, email],
    );
    await handle.pool.query(
      `insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       values ($1, $2, 'credential', $2, $3, now(), now())`,
      [`acc-${id}`, id, await hashPassword("curta-8!")],
    );
    const res = await new TestClient(server.baseUrl).post(`${AUTH}/sign-in/email`, { email, password: "curta-8!" });
    expect(res.status).toBe(200);
  });

  describe("redefinição: falhas do HIBP não consomem o token", () => {
    async function resetToken(email: string, count: number): Promise<string> {
      await new TestClient(server.baseUrl).post(`${AUTH}/request-password-reset`, { email });
      return tokenFromMail(await waitForMail(server.mailbox, email, "password-reset", count), "/redefinir-senha");
    }

    it("indisponível (503) e comprometida (400) mantêm o link válido; depois redefine", async () => {
      const { input } = await signedInClient(server);
      const token = await resetToken(input.email, 1);

      for (const mode of UNAVAILABLE_MODES) {
        fakeHibp.mode = mode;
        const res = await new TestClient(server.baseUrl).post<Problem>(`${AUTH}/reset-password`, {
          token,
          newPassword: "nova-palavra-passe-segura-9",
        });
        expect(res.status).toBe(503);
        expect(res.body.code).toBe("PASSWORD_CHECK_UNAVAILABLE");
      }
      fakeHibp.mode = "ok";
      fakeHibp.compromised.set(COMPROMISED, 7);
      const compromised = await new TestClient(server.baseUrl).post<Problem>(`${AUTH}/reset-password`, {
        token,
        newPassword: COMPROMISED,
      });
      expect(compromised.status).toBe(400);
      expect(compromised.body.code).toBe("PASSWORD_COMPROMISED");

      const { rowCount } = await handle.pool.query(`select 1 from verification where identifier = $1`, [
        `reset-password:${token}`,
      ]);
      expect(rowCount).toBe(1);

      const ok = await new TestClient(server.baseUrl).post(`${AUTH}/reset-password`, {
        token,
        newPassword: "nova-palavra-passe-segura-9",
      });
      expect(ok.status).toBe(200);
      const login = await new TestClient(server.baseUrl).post(`${AUTH}/sign-in/email`, {
        email: input.email,
        password: "nova-palavra-passe-segura-9",
      });
      expect(login.status).toBe(200);
    });
  });

  it("troca de palavra-passe: comprometida 400, indisponível 503, válida 200", async () => {
    const { client, input } = await signedInClient(server);
    fakeHibp.compromised.set(COMPROMISED, 3);
    const body = (newPassword: string) => ({ currentPassword: input.password, newPassword });

    const compromised = await client.post<Problem>(`${AUTH}/change-password`, body(COMPROMISED));
    expect(compromised.status).toBe(400);
    expect(compromised.body.code).toBe("PASSWORD_COMPROMISED");

    fakeHibp.mode = "unavailable";
    const unavailable = await client.post<Problem>(`${AUTH}/change-password`, body("outra-frase-bem-comprida"));
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.code).toBe("PASSWORD_CHECK_UNAVAILABLE");

    fakeHibp.mode = "ok";
    const ok = await client.post(`${AUTH}/change-password`, body("outra-frase-bem-comprida"));
    expect(ok.status).toBe(200);
  });
});
