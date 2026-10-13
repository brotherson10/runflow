import type { Page } from "@playwright/test";
import { E2E_COMPROMISED_PASSWORD, E2E_HIBP_FAILING_PASSWORD } from "./constants.ts";
import { expect, newAccount, readMailLink, signIn, test, waitForMailLink } from "./support.ts";

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

test("registo → e-mail capturado → login bloqueado → reenvio → confirmação → login", async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: "allow-console", description: "status of 403" });
  const account = newAccount("Confirma");
  await fillSignUp(page, account);
  await expect(page).toHaveURL(/\/verificar-email$/);
  await expect(page.getByRole("status")).toContainText("Se for possível criar a conta com este e-mail");
  const firstLink = await waitForMailLink(account.email, "email-verification", "/confirmar-email");

  // Conta por confirmar: login recusado (com a palavra-passe certa) e oferta de reenvio.
  await signIn(page, account);
  await expect(page.getByRole("alert")).toContainText("Confirme o seu e-mail antes de entrar");
  await expect(page).toHaveURL(/\/entrar$/);
  await page.getByRole("link", { name: "Enviar novo link de confirmação" }).click();
  await expect(page).toHaveURL(/\/verificar-email$/);
  await expect(page.getByLabel("E-mail da conta")).toHaveValue(account.email);
  await page.getByRole("button", { name: "Enviar novo link" }).click();
  await expect(page.getByRole("status")).toContainText("Se existir uma conta por confirmar com esse e-mail");
  const secondLink = await waitForMailLink(account.email, "email-verification", "/confirmar-email", firstLink);
  expect(secondLink).not.toBe(firstLink);

  // A página do link não confirma sozinha: só depois do clique.
  await page.goto(secondLink);
  await expect(page).toHaveURL(/\/confirmar-email$/); // token retirado da barra de endereço
  await expect(page.getByRole("button", { name: "Confirmar e-mail" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar e-mail" }).click();
  await expect(page.getByRole("status")).toContainText("E-mail confirmado");
  await page.getByRole("link", { name: "Entrar" }).last().click();
  await expect(page).toHaveURL(/\/entrar\?confirmado=1$/);
  await expect(page.getByText("E-mail confirmado. Já pode entrar.")).toBeVisible();
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Palavra-passe").fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: `Olá, ${account.name}` })).toBeVisible();
});

test("registo com e-mail já existente: mesma página e nenhum e-mail novo", async ({ page }) => {
  const account = newAccount("Duplicado");
  await fillSignUp(page, account);
  await expect(page).toHaveURL(/\/verificar-email$/);
  const link = await waitForMailLink(account.email, "email-verification", "/confirmar-email");
  const firstText = await page.getByRole("status").textContent();

  await fillSignUp(page, { ...account, password: "outra-frase-diferente-para-o-mesmo-email" });
  await expect(page).toHaveURL(/\/verificar-email$/);
  expect(await page.getByRole("status").textContent()).toBe(firstText);
  await page.waitForTimeout(500);
  expect(readMailLink(account.email, "email-verification", "/confirmar-email")).toBe(link);
});

test("link de confirmação inválido, adulterado ou expirado", async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: "allow-console", description: "status of 401" });
  // Sem formato de JWT: recusado sem chamar a API.
  let verifyCalls = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/verify-email") verifyCalls += 1;
  });
  await page.goto("/confirmar-email?token=abc");
  await expect(page.getByRole("alert")).toContainText("Este link de confirmação não é válido.");
  expect(verifyCalls).toBe(0);

  // JWT com assinatura errada: recusado pelo servidor (401 INVALID_TOKEN).
  await page.goto("/confirmar-email?token=eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFAYi5wdCJ9.assinatura-falsa");
  await page.getByRole("button", { name: "Confirmar e-mail" }).click();
  await expect(page.getByRole("alert")).toContainText("Este link de confirmação não é válido.");
  await expect(page.getByRole("link", { name: "Pedir novo link" })).toBeVisible();
  expect(verifyCalls).toBe(1);

  // Expiração real (24 h) é testada contra a API em auth-email-verification.db.test.ts;
  // aqui simula-se só a resposta TOKEN_EXPIRED para verificar a interface.
  await page.route("**/api/auth/verify-email**", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "TOKEN_EXPIRED", message: "token expired" }) }),
  );
  await page.goto("/confirmar-email?token=eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFAYi5wdCJ9.expirado");
  await page.getByRole("button", { name: "Confirmar e-mail" }).click();
  await expect(page.getByRole("alert")).toContainText("Este link de confirmação expirou.");
});

test("política no registo: curta, comprometida e HIBP indisponível (sem conta nem e-mail)", async ({ page }, testInfo) => {
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

  await page.waitForTimeout(500);
  expect(readMailLink(account.email, "email-verification", "/confirmar-email")).toBeNull();

  // Sem regras de composição: uma frase só com minúsculas e espaços é aceite.
  await fillSignUp(page, { ...account, password: "uma frase comprida so com letras" });
  await expect(page).toHaveURL(/\/verificar-email$/);
});

test("Express: rotas diretas com CSP, /api desconhecida em problem+json e asset inexistente 404", async ({ page, request }) => {
  for (const path of ["/app/treinos", "/confirmar-email", "/demo/objetivo", "/qualquer/coisa"]) {
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
