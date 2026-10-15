import { expect, test as base, type Page } from "@playwright/test";
import { WEB_ORIGIN } from "./constants.ts";

export { WEB_ORIGIN };
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
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: `Olá, ${account.name}` })).toBeVisible();
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
