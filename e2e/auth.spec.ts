import type { Page } from "@playwright/test";
import { E2E_COMPROMISED_PASSWORD, E2E_HIBP_FAILING_PASSWORD } from "./constants.ts";
import { expect, newAccount, signOut, signUp, test } from "./support.ts";

test.afterEach(({ consoleErrors }, testInfo) => {
  const allowed = testInfo.annotations.filter((a) => a.type === "allow-console").map((a) => a.description ?? "");
  const unexpected = consoleErrors.filter((text) => !allowed.some((pattern) => text.includes(pattern)));
  expect(unexpected, "erros inesperados na consola").toEqual([]);
});

async function fillSignUp(page: Page, account: { name: string; email: string; password: string }) {
  await page.goto("/criar-conta");
  await page.getByLabel("Nome").fill(account.name);
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Palavra-passe").fill(account.password);
  await page.getByRole("button", { name: "Criar conta" }).click();
}

const NO_EMAIL = "o e-mail não é verificado e não existe recuperação de palavra-passe";

test("registo entra diretamente; o aviso de projeto sem e-mail aparece no registo e em Conta", async ({ page }) => {
  await page.goto("/criar-conta");
  await expect(page.getByText(NO_EMAIL)).toBeVisible();
  const account = newAccount("Direto");
  await signUp(page, account);
  await page.getByRole("navigation", { name: "Área pessoal" }).getByRole("link", { name: "Conta" }).click();
  await expect(page.getByText(NO_EMAIL)).toBeVisible();

  // Login não oferece recuperação de palavra-passe.
  await signOut(page);
  await expect(page.getByRole("link", { name: /Esqueceu-se/ })).toHaveCount(0);
});

test("registo com e-mail já existente e outra palavra-passe: não entra na conta existente", async ({ page }) => {
  const account = newAccount("Duplicado");
  await signUp(page, account);
  await signOut(page);
  await fillSignUp(page, { ...account, password: "outra-frase-diferente-para-o-mesmo-email" });
  await expect(page.getByRole("alert")).toContainText("Não foi possível entrar automaticamente");
  await expect(page).toHaveURL(/\/criar-conta$/);
});

test("rotas antigas de e-mail e recuperação: indisponibilidade clara na web e 410 na API", async ({ page, request }) => {
  for (const path of ["/recuperar-acesso", "/redefinir-senha?token=abcdefghijklmnopqrstuvwx", "/verificar-email", "/confirmar-email?token=a.b.c"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Funcionalidade indisponível" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("não envia e-mails");
    await expect(page.locator("form")).toHaveCount(0);
  }
  for (const path of ["/api/auth/request-password-reset", "/api/auth/send-verification-email", "/api/auth/reset-password"]) {
    const response = await request.post(path, { data: { email: "alguem@example.test" }, headers: { Origin: "http://localhost:4173" } });
    expect(response.status(), path).toBe(410);
    expect(((await response.json()) as { code: string }).code).toBe("FEATURE_UNAVAILABLE");
  }
});

test("política no registo: curta, comprometida e HIBP indisponível (sem conta)", async ({ page }, testInfo) => {
  testInfo.annotations.push(
    { type: "allow-console", description: "status of 400" },
    { type: "allow-console", description: "status of 503" },
  );
  const account = newAccount("Politica");

  await fillSignUp(page, { ...account, password: "catorze-chars!" });
  await expect(page.getByText("Use pelo menos 15 caracteres.")).toBeVisible();
  await expect(page).toHaveURL(/\/criar-conta$/);

  await fillSignUp(page, { ...account, password: E2E_COMPROMISED_PASSWORD });
  await expect(page.getByRole("alert")).toContainText("aparece em fugas de dados conhecidas");

  await fillSignUp(page, { ...account, password: E2E_HIBP_FAILING_PASSWORD });
  await expect(page.getByRole("alert")).toContainText("Tente novamente dentro de alguns minutos");
  await expect(page).toHaveURL(/\/criar-conta$/);

  // Sem regras de composição: uma frase só com minúsculas e espaços é aceite.
  await fillSignUp(page, { ...account, password: "uma frase comprida so com letras" });
  await expect(page).toHaveURL(/\/app$/);
});

test("Express: rotas diretas com CSP, /api desconhecida em problem+json e asset inexistente 404", async ({ page, request }) => {
  for (const path of ["/app/treinos", "/entrar", "/demo/objetivo", "/qualquer/coisa"]) {
    const response = await request.get(path, { headers: { Accept: "text/html" } });
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^text\/html/);
    expect(response.headers()["cache-control"]).toBe("no-cache");
    expect(response.headers()["content-security-policy"]).toContain("script-src 'self'");
  }

  for (const path of ["/api/v1/nada", "/api/nada", "/API/v1/nada"]) {
    const response = await request.get(path, { headers: { Accept: "text/html" } });
    expect(response.status(), path).toBe(404);
    expect(response.headers()["content-type"]).toMatch(/^application\/problem\+json/);
  }

  const missing = await request.get("/assets/nao-existe.js");
  expect(missing.status()).toBe(404);
  expect(await missing.text()).not.toContain('<div id="root">');

  // Rota protegida aberta diretamente, sem sessão: a SPA carrega e redireciona.
  await page.goto("/app/treinos");
  await expect(page).toHaveURL(/\/entrar\?next=%2Fapp%2Ftreinos$/);
});
