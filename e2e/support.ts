import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test as base, type Page } from "@playwright/test";
import { MAIL_DIR, WEB_ORIGIN } from "./constants.ts";

export { MAIL_DIR, WEB_ORIGIN };
export const SCREENSHOT_DIR = process.env["E2E_SCREENSHOT_DIR"] ?? ".e2e/screenshots";

let ipCounter = Math.floor(Math.random() * 200);

/** Um IP distinto por teste (encaminhado pelo proxy de loopback confiável). */
function nextIp(): string {
  ipCounter += 1;
  return `10.88.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter % 250) + 1)}`;
}

interface Fixtures {
  consoleErrors: string[];
}

/**
 * `context` próprio por teste, com IP simulado; `consoleErrors` recolhe erros da
 * consola e exceções da página, verificados no fim de cada teste.
 */
export const test = base.extend<Fixtures>({
  context: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      locale: "pt-PT",
      timezoneId: "Europe/Lisbon",
      extraHTTPHeaders: { "X-Forwarded-For": nextIp() },
    });
    await use(context);
    await context.close();
  },
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => {
      errors.push(`pageerror: ${error.message}`);
    });
    await use(errors);
  },
});

export { expect };

let userCounter = 0;

export interface Account {
  name: string;
  email: string;
  password: string;
}

export function newAccount(label: string): Account {
  userCounter += 1;
  return {
    name: `${label} E2E`,
    email: `e2e.${label.toLowerCase()}.${String(Date.now())}.${String(userCounter)}@example.test`,
    password: `palavra-passe-${label.toLowerCase()}-segura`,
  };
}

export async function signUp(page: Page, account: Account): Promise<void> {
  await page.goto("/criar-conta");
  await page.getByLabel("Nome").fill(account.name);
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Palavra-passe").fill(account.password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/verificar-email$/);
  await confirmEmail(page, account.email);
  await signIn(page, account);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: `Olá, ${account.name}` })).toBeVisible();
}

/** Abre o link de confirmação do último e-mail capturado e confirma pela interface. */
export async function confirmEmail(page: Page, email: string): Promise<void> {
  await page.goto(await waitForMailLink(email, "email-verification", "/confirmar-email"));
  await page.getByRole("button", { name: "Confirmar e-mail" }).click();
  await expect(page.getByRole("status").filter({ hasText: "E-mail confirmado" })).toBeVisible();
}

export async function signIn(page: Page, account: Account, path = "/entrar"): Promise<void> {
  await page.goto(path);
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Palavra-passe").fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Terminar sessão" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
}

/** Regista um treino pela interface (data por omissão: hoje). */
export async function addWorkout(
  page: Page,
  input: { km: string; minutes: string; hours?: string; seconds?: string; notes?: string; date?: string },
): Promise<void> {
  await page.goto("/app/treinos/novo");
  if (input.date) await page.getByLabel("Data").fill(input.date);
  await page.getByLabel("Distância (km)").fill(input.km);
  await page.getByLabel("Horas").fill(input.hours ?? "");
  await page.getByLabel("Minutos").fill(input.minutes);
  await page.getByLabel("Segundos").fill(input.seconds ?? "");
  if (input.notes !== undefined) await page.getByLabel("Observações (opcional)").fill(input.notes);
  await page.getByRole("button", { name: "Guardar treino" }).click();
  await expect(page).toHaveURL(/\/app\/treinos$/);
  await expect(page.getByRole("status").filter({ hasText: "Treino registado." })).toBeVisible();
}

/** Valor de uma estatística do painel ("Distância", "Treinos", ...). */
export function stat(page: Page, label: string) {
  return page.locator(".stat").filter({ has: page.locator("dt", { hasText: label }) }).locator("dd");
}


/**
 * Link do último e-mail capturado localmente para `email` e do tipo indicado. O
 * link é identificado por parsing de URL (origem da app, caminho exato e um único
 * `token`), não por padrões de texto.
 */
export function readMailLink(email: string, kind: string, pathname: string): string | null {
  let files: string[];
  try {
    files = readdirSync(MAIL_DIR);
  } catch {
    return null;
  }
  const sorted = files
    .filter((name) => name.includes(`-${kind}-`))
    .map((name) => join(MAIL_DIR, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const file of sorted) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim());
    if (!lines.includes(`Para: ${email}`)) continue;
    for (const word of lines.flatMap((line) => line.split(/\s+/))) {
      const url = URL.parse(word);
      if (url?.origin !== WEB_ORIGIN || url.pathname !== pathname) continue;
      if (url.searchParams.getAll("token").length === 1) return url.toString();
    }
  }
  return null;
}

/** Espera pelo e-mail (enviado em segundo plano) e devolve o link mais recente. */
export async function waitForMailLink(email: string, kind: string, pathname: string, previous?: string): Promise<string> {
  const found: { link: string | null } = { link: null };
  await expect
    .poll(
      () => {
        found.link = readMailLink(email, kind, pathname);
        return found.link !== null && found.link !== previous;
      },
      { message: `e-mail ${kind} para ${email}` },
    )
    .toBe(true);
  if (found.link === null) throw new Error(`Sem e-mail ${kind} para ${email}.`);
  return found.link;
}

/** Link de redefinição do último e-mail capturado para `email`. */
export function readResetLink(email: string): string {
  const link = readMailLink(email, "password-reset", "/redefinir-senha");
  if (link === null) throw new Error(`Nenhum e-mail de recuperação para ${email}.`);
  const token = new URL(link).searchParams.get("token") ?? "";
  if (!/^[A-Za-z0-9]{16,128}$/.test(token)) throw new Error("Token de recuperação com formato inesperado.");
  return link;
}
