import {
  addWorkout,
  expect,
  newAccount,
  readResetLink,
  signIn,
  signOut,
  signUp,
  stat,
  test,
} from "./support.ts";
import { E2E_COMPROMISED_PASSWORD, E2E_HIBP_FAILING_PASSWORD } from "./constants.ts";

test.afterEach(({ consoleErrors }, testInfo) => {
  // Testes que simulam falhas de rede/sessão anotam os erros esperados.
  const allowed = testInfo.annotations.filter((a) => a.type === "allow-console").map((a) => a.description ?? "");
  const unexpected = consoleErrors.filter((text) => !allowed.some((pattern) => text.includes(pattern)));
  expect(unexpected, "erros inesperados na consola").toEqual([]);
});

test("cadastro, CRUD de treino e dashboard recalculado", async ({ page }) => {
  const account = newAccount("Ana");
  await page.goto("/");
  await page.getByRole("link", { name: "Criar conta" }).first().click();
  await expect(page).toHaveURL(/\/criar-conta$/);
  await signUp(page, account);
  await expect(stat(page, "Treinos")).toHaveText("0");
  await expect(page.getByText("Ainda não registou treinos.")).toBeVisible();

  await addWorkout(page, { km: "5", minutes: "25", notes: "Rodagem E2E" });
  await addWorkout(page, { km: "10", hours: "1", minutes: "0" });
  await expect(page.locator(".workout")).toHaveCount(2);

  await page.getByRole("link", { name: "Painel" }).click();
  await expect(stat(page, "Distância")).toHaveText("15 km");
  await expect(stat(page, "Treinos")).toHaveText("2");
  await expect(stat(page, "Tempo total")).toHaveText("1 h 25 min");
  await expect(stat(page, "Ritmo médio")).toHaveText("5:40 /km");

  // Editar: 5 km → 6 km.
  await page.getByRole("link", { name: "Treinos" }).click();
  const rodagem = page.locator(".workout").filter({ hasText: "Rodagem E2E" });
  await rodagem.getByRole("link", { name: /Editar/ }).click();
  await expect(page.getByLabel("Distância (km)")).toHaveValue("5");
  await page.getByLabel("Distância (km)").fill("6");
  await page.getByRole("button", { name: "Guardar alterações" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Treino atualizado." })).toBeVisible();
  await page.getByRole("link", { name: "Painel" }).click();
  await expect(stat(page, "Distância")).toHaveText("16 km");

  // Eliminar: cancelar primeiro, depois confirmar.
  await page.getByRole("link", { name: "Treinos" }).click();
  await page.locator(".workout").filter({ hasText: "Rodagem E2E" }).getByRole("button", { name: /Eliminar/ }).click();
  const dialog = page.getByRole("dialog", { name: "Eliminar treino?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".workout")).toHaveCount(2);
  await page.locator(".workout").filter({ hasText: "Rodagem E2E" }).getByRole("button", { name: /Eliminar/ }).click();
  await dialog.getByRole("button", { name: "Eliminar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Treino eliminado." })).toBeVisible();
  await expect(page.locator(".workout")).toHaveCount(1);
  await page.getByRole("link", { name: "Painel" }).click();
  await expect(stat(page, "Distância")).toHaveText("10 km");
  await expect(stat(page, "Treinos")).toHaveText("1");
});

test("conteúdo HTML é mostrado literalmente (sem executar)", async ({ page }) => {
  await signUp(page, newAccount("Html"));
  const payload = '<img src=x onerror="window.__xss=1"><b>negrito</b>';
  await addWorkout(page, { km: "3", minutes: "18", notes: payload });
  const notes = page.locator(".workout-notes");
  await expect(notes).toHaveText(payload);
  await expect(page.locator(".workout-notes img, .workout-notes b")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("envio duplicado bloqueado durante o pedido", async ({ page }) => {
  await signUp(page, newAccount("Duplo"));
  let posts = 0;
  await page.route("**/api/v1/workouts", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    await route.continue();
  });
  await page.goto("/app/treinos/novo");
  await page.getByLabel("Distância (km)").fill("4");
  await page.getByLabel("Minutos").fill("22");
  const submit = page.getByRole("button", { name: "Guardar treino" });
  await submit.dblclick();
  await expect(page.getByRole("button", { name: "A guardar…" })).toBeDisabled();
  await expect(page).toHaveURL(/\/app\/treinos$/);
  expect(posts).toBe(1);
  await expect(page.locator(".workout")).toHaveCount(1);
});

test("troca de conta A → B sem dados anteriores no ecrã ou na cache", async ({ page }) => {
  const a = newAccount("ContaA");
  const b = newAccount("ContaB");
  await signUp(page, a);
  await addWorkout(page, { km: "7", minutes: "35", notes: "SEGREDO-DA-CONTA-A" });
  await signOut(page);

  // Voltar atrás depois do logout não mostra dados de A.
  await page.goBack();
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.getByText("SEGREDO-DA-CONTA-A")).toHaveCount(0);

  await signUp(page, b);
  await expect(stat(page, "Treinos")).toHaveText("0");
  await expect(page.getByText("SEGREDO-DA-CONTA-A")).toHaveCount(0);
  await page.getByRole("link", { name: "Treinos" }).click();
  await expect(page.getByText("Ainda não registou treinos.")).toBeVisible();
  await expect(page.getByText("SEGREDO-DA-CONTA-A")).toHaveCount(0);

  // A volta a ver só os seus dados.
  await signOut(page);
  await signIn(page, a);
  await expect(page).toHaveURL(/\/app$/);
  await page.getByRole("link", { name: "Treinos" }).click();
  await expect(page.getByText("SEGREDO-DA-CONTA-A")).toBeVisible();
});

test("sessão expirada: redireciona uma vez para /entrar e regressa ao destino", async ({ page, context }, testInfo) => {
  testInfo.annotations.push({ type: "allow-console", description: "401" });
  const account = newAccount("Expira");
  await signUp(page, account);
  await addWorkout(page, { km: "2", minutes: "12" });
  await page.getByRole("link", { name: "Painel" }).click();
  await expect(page.locator(".stat").first()).toBeVisible();

  await context.clearCookies();
  const navigations: string[] = [];
  const goalRequests: number[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/v1/goal")) goalRequests.push(response.status());
  });
  // Destino com dados ainda fora da cache: o pedido à API é obrigatório e recebe 401.
  // (Dados frescos em cache, como a lista de treinos, são mostrados sem pedido; a
  // sessão expirada só é detetada no pedido seguinte.)
  await page.getByRole("navigation", { name: "Área pessoal" }).getByRole("link", { name: "Objetivo" }).click();
  await expect(page).toHaveURL(/\/entrar\?next=%2Fapp%2Fobjetivo&motivo=sessao$/);
  await expect(page.getByText("A sua sessão terminou.")).toBeVisible();
  expect(goalRequests).toContain(401);
  await page.waitForTimeout(1000);
  expect(navigations.filter((url) => url.includes("/entrar")).length).toBeLessThanOrEqual(1);
  // Sem ciclo de pedidos: a página aberta é desmontada depois do primeiro 401.
  expect(goalRequests.length, `pedidos a /goals: ${goalRequests.join(",")}`).toBeLessThanOrEqual(2);

  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Palavra-passe").fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/app\/objetivo$/);
  await expect(page.locator("h1")).toHaveText("Objetivo");
  await page.getByRole("navigation", { name: "Área pessoal" }).getByRole("link", { name: "Treinos" }).click();
  await expect(page.locator(".workout")).toHaveCount(1);
});

test("redirect externo depois do login é ignorado (sem open redirect)", async ({ page }) => {
  const account = newAccount("Redirect");
  await signUp(page, account);
  await signOut(page);
  for (const next of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
    await signIn(page, account, `/entrar?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(/\/app$/);
    await signOut(page);
  }
});

test("API indisponível: estado de erro e nova tentativa", async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: "allow-console", description: "net::ERR_FAILED" });
  await signUp(page, newAccount("Offline"));
  await page.route("**/api/v1/dashboard**", (route) => route.abort("failed"));
  await page.reload();
  const error = page.getByRole("alert").filter({ hasText: "Sem ligação ao servidor" });
  await expect(error).toBeVisible();
  await page.unroute("**/api/v1/dashboard**");
  await error.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(stat(page, "Treinos")).toHaveText("0");
});

test("objetivo: criar, editar, concluir e substituir com confirmação", async ({ page }) => {
  await signUp(page, newAccount("Objetivo"));
  await page.getByRole("link", { name: "Objetivo" }).first().click();
  await page.getByLabel("Título").fill("10 km da cidade");
  await page.getByLabel("Distância da prova (km)").fill("10");
  await page.getByRole("button", { name: "Criar objetivo" }).click();
  await expect(page.getByRole("heading", { name: "10 km da cidade" })).toBeVisible();

  await page.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Título").fill("10 km da cidade — sub 50");
  await page.getByRole("button", { name: "Guardar alterações" }).click();
  await expect(page.getByRole("heading", { name: "10 km da cidade — sub 50" })).toBeVisible();

  await page.getByRole("button", { name: "Concluir" }).click();
  const completeDialog = page.getByRole("dialog", { name: "Concluir objetivo?" });
  await completeDialog.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Objetivo concluído" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Definir objetivo" })).toBeVisible();

  await page.getByLabel("Título").fill("Meia maratona");
  await page.getByLabel("Distância da prova (km)").fill("21,1");
  await page.getByRole("button", { name: "Criar objetivo" }).click();
  await page.getByRole("button", { name: "Substituir por outro" }).click();
  await page.getByLabel("Título").fill("Maratona");
  await page.getByLabel("Distância da prova (km)").fill("42,195");
  await page.getByRole("button", { name: "Continuar" }).click();
  const replaceDialog = page.getByRole("dialog", { name: "Substituir objetivo?" });
  await expect(replaceDialog).toContainText("Meia maratona");
  await replaceDialog.getByRole("button", { name: "Substituir" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Objetivo substituído." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Maratona" })).toBeVisible();

  await page.getByRole("link", { name: "Painel" }).click();
  await expect(page.locator(".goal-card")).toContainText("Maratona");
});

test("recuperação local: pedido neutro, política de palavra-passe, link não consumido e login", async ({ page }, testInfo) => {
  // 400 (comprometida) e 503 (HIBP indisponível) são respostas esperadas.
  testInfo.annotations.push({ type: "allow-console", description: "status of 400" }, { type: "allow-console", description: "status of 503" });
  const account = newAccount("Recupera");
  await signUp(page, account);
  await signOut(page);

  await page.getByRole("link", { name: "Esqueceu-se da palavra-passe?" }).click();
  await page.getByLabel("E-mail da conta").fill(account.email);
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(page.getByText("Se existir uma conta com esse e-mail")).toBeVisible();

  let link = "";
  await expect.poll(() => {
    try {
      link = readResetLink(account.email);
      return true;
    } catch {
      return false;
    }
  }).toBe(true);
  await page.goto(link);
  await expect(page).toHaveURL(/\/redefinir-senha$/); // token retirado da barra de endereço

  // Política: curta (validação local), comprometida (HIBP) e HIBP indisponível. Nenhuma
  // destas tentativas consome o link: a seguir, o mesmo link redefine a palavra-passe.
  const attempts: [string, string][] = [
    ["catorze-chars!", "Use pelo menos 15 caracteres."],
    [E2E_COMPROMISED_PASSWORD, "aparece em fugas de dados conhecidas"],
    [E2E_HIBP_FAILING_PASSWORD, "Tente novamente dentro de alguns minutos"],
  ];
  for (const [password, message] of attempts) {
    await page.getByLabel("Nova palavra-passe").fill(password);
    await page.getByLabel("Confirmar palavra-passe").fill(password);
    await page.getByRole("button", { name: "Guardar palavra-passe" }).click();
    await expect(page.getByRole("alert")).toContainText(message);
  }

  const newPassword = "nova-palavra-passe-e2e-9";
  await page.getByLabel("Nova palavra-passe").fill(newPassword);
  await page.getByLabel("Confirmar palavra-passe").fill(newPassword);
  await page.getByRole("button", { name: "Guardar palavra-passe" }).click();
  await expect(page).toHaveURL(/\/entrar\?redefinida=1$/);
  await expect(page.getByText("Palavra-passe alterada.")).toBeVisible();

  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Palavra-passe").fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toContainText("E-mail ou palavra-passe incorretos.");

  await signIn(page, { ...account, password: newPassword });
  await expect(page).toHaveURL(/\/app$/);
});
