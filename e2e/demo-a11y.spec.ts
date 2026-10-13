import { mkdirSync } from "node:fs";
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { addWorkout, expect, newAccount, SCREENSHOT_DIR, signUp, test } from "./support.ts";

test.afterEach(({ consoleErrors }) => {
  expect(consoleErrors, "erros na consola").toEqual([]);
});

test("demo: só leitura, banner visível e sem pedidos à API", async ({ page }) => {
  const apiRequests: string[] = [];
  const scripts: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/")) apiRequests.push(request.url());
    if (pathname.endsWith(".js")) scripts.push(pathname);
  });

  const landing = await page.goto("/");
  // A web corre sob a CSP de publicação (packages/shared/src/security-headers.ts); violações
  // seriam erros na consola e falhariam o teste.
  const csp = landing?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  expect(landing?.headers()["x-frame-options"]).toBe("DENY");
  await page.getByRole("link", { name: "Ver a demo" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("note")).toContainText("Modo demonstração");
  await expect(page.locator(".stat").first()).toBeVisible();

  await page.getByRole("navigation", { name: "Demonstração" }).getByRole("link", { name: "Treinos" }).click();
  await expect(page.locator(".workout")).toHaveCount(5);
  await page.getByRole("button", { name: "Carregar mais" }).click();
  await expect(page.locator(".workout")).toHaveCount(10);
  await page.getByRole("navigation", { name: "Demonstração" }).getByRole("link", { name: "Objetivo" }).click();
  await expect(page.locator(".goal-card")).toContainText("Meia maratona da cidade");

  for (const label of [/Editar/, /Eliminar/, /Registar/, /Concluir/, /Substituir/, /Guardar/]) {
    await expect(page.getByRole("button", { name: label })).toHaveCount(0);
  }
  await expect(page.locator("form")).toHaveCount(0);
  expect(apiRequests).toEqual([]);
  // Divisão do bundle: landing e demo não descarregam o chunk do cliente Better Auth
  // (session-*.js) nem o da área privada.
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.filter((path) => /\/assets\/(session|app|public)-/.test(path))).toEqual([]);
});

const WIDTHS = [390, 820, 1440] as const;

async function checkPage(page: Page, name: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name} @${String(width)}px: overflow horizontal`).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact ?? "?"}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(summary, `${name} @${String(width)}px: violações axe`).toEqual([]);
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-${String(width)}.png`, fullPage: true });
}

test("acessibilidade (axe), overflow e capturas a 390/820/1440 px", async ({ page }) => {
  test.setTimeout(180_000);
  const publicPages = [
    ["landing", "/"],
    ["entrar", "/entrar"],
    ["criar-conta", "/criar-conta"],
    ["recuperar", "/recuperar-acesso"],
    ["demo-painel", "/demo"],
    ["demo-treinos", "/demo/treinos"],
    ["demo-objetivo", "/demo/objetivo"],
  ] as const;
  for (const [name, path] of publicPages) {
    await page.goto(path);
    for (const width of WIDTHS) await checkPage(page, name, width);
  }

  await signUp(page, newAccount("Visual"));
  await addWorkout(page, { km: "8,4", minutes: "44", seconds: "10", notes: "Treino de exemplo com uma observação um pouco mais longa para testar a quebra de linha." });
  await addWorkout(page, { km: "12", hours: "1", minutes: "5" });
  await page.goto("/app/objetivo");
  await page.getByLabel("Título").fill("Meia maratona");
  await page.getByLabel("Distância da prova (km)").fill("21,1");
  await page.getByRole("button", { name: "Criar objetivo" }).click();
  await expect(page.locator(".goal-card")).toBeVisible();

  const appPages = [
    ["app-painel", "/app"],
    ["app-treinos", "/app/treinos"],
    ["app-novo-treino", "/app/treinos/novo"],
    ["app-objetivo", "/app/objetivo"],
    ["app-conta", "/app/conta"],
  ] as const;
  for (const [name, path] of appPages) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    for (const width of WIDTHS) await checkPage(page, name, width);
  }

  // Diálogo de confirmação aberto também é verificado.
  await page.goto("/app/treinos");
  await page.locator(".workout").first().getByRole("button", { name: /Eliminar/ }).click();
  const results = await new AxeBuilder({ page }).include("dialog").analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/app-dialogo-eliminar-1440.png` });
});

test("teclado: skip link, foco visível na navegação e no menu", async ({ page }) => {
  await signUp(page, newAccount("Teclado"));
  // Esperar que a área protegida termine de verificar a sessão e renderize.
  await page.goto("/app");
  await expect(page.locator("h1")).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Saltar para o conteúdo" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#conteudo$/);

  await page.goto("/app");
  await expect(page.locator("h1")).toBeVisible();
  await page.keyboard.press("Tab"); // skip link
  await page.keyboard.press("Tab"); // marca
  await page.keyboard.press("Tab"); // Painel
  const focused = page.locator(":focus");
  await expect(focused).toHaveText("Painel");
  const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");

  // Período selecionável só com o teclado.
  await page.getByRole("radio", { name: "Este mês" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Este ano" })).toBeChecked();
});
