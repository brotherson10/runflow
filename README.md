# RunFlow V2

Aplicação full stack de acompanhamento de corrida (projeto de portefólio).

**Em produção:** <https://runflow-eta.vercel.app> (Vercel Hobby + Neon Free, Frankfurt).

- **Funciona:** registo e login, treinos (criar, editar, eliminar, histórico),
  dashboard do período, objetivo (criar, editar, concluir, substituir), conta e logout.
  Há também uma demo sem conta e só de leitura em `/demo`.
- **Limitações (projeto demonstrativo, D52):**
  - não há envio de e-mail, por isso o e-mail não é verificado e não existe
    recuperação de palavra-passe;
  - sem domínio próprio;
  - o plano Hobby limita o cron de limpeza a uma execução diária;
  - o Neon Free suspende a base após 5 min de inatividade, por isso o primeiro pedido
    seguinte é mais lento.

Esta é a evolução do RunFlow criado no estágio Full Stack da DecodeLabs. A versão
do estágio continua preservada nos repositórios originais:
[runflow-frontend](https://github.com/brotherson10/runflow-frontend) e
[runflow-backend](https://github.com/brotherson10/runflow-backend).

## Estado atual (Fase 5B — código de produção)

Já existe:

- monorepo com npm workspaces e TypeScript strict;
- schemas partilhados de treino, objetivo, nome e fuso horário, e cálculo do ritmo médio;
- API Express 5 com `GET /api/v1/health` e erros em `application/problem+json`;
- PostgreSQL local em Docker, schema Drizzle e migrations SQL versionadas;
- **autenticação na API** (Better Auth): registo, login, sessão, logout,
  `GET /api/v1/me` protegido e rate limiting persistente. Testada por HTTP contra PostgreSQL real;
- **API de treinos** (`/api/v1/workouts`): criar, listar com filtros e paginação por
  cursor, ler, alterar e eliminar, com isolamento entre utilizadores, proteção de
  origem nas escritas e rate limiting persistente. Contrato em [docs/api.md](docs/api.md);
- **API de objetivos** (um ativo por utilizador; editar, concluir, substituir em
  transação) e **dashboard** do período (totais e ritmo médio calculados na leitura);
- **web em React** (PT-PT, mobile-first): landing, registo, login, painel do período, histórico com filtros e
  paginação, registo/edição/eliminação de treinos, objetivo (criar, editar,
  concluir, substituir) e conta (nome e fuso horário);
- **demo** em `/demo` com dados fictícios locais, só de leitura e sem pedidos à API;
- **bundle dividido por rota** (autenticação, área privada e demo em chunks próprios),
  limpeza periódica dos registos de rate limiting e E2E no CI;
- **palavra-passe de 15–128 caracteres** verificada no Have I Been Pwned (falha
  fechada: se a consulta falhar, tente novamente);
- **Express serve o build da web e a API na mesma origem**, com CSP e restantes
  cabeçalhos de segurança (servidor Node) ou **Vercel Function + CDN** (produção).

**Sem e-mail (projeto demonstrativo, D52):** o e-mail não é verificado e não existe
recuperação de palavra-passe. As rotas antigas de confirmação e recuperação mostram
indisponibilidade (web) e respondem 410 `FEATURE_UNAVAILABLE` (API). Publicação em
[docs/deployment.md](docs/deployment.md).

## Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript 6 (strict), Node.js 24, npm workspaces |
| Web | React 19, React Router 8, TanStack Query 5, Vite 8 (CSS próprio, PT-PT, mobile-first) |
| API | Express 5, Zod 4, erros `application/problem+json` |
| Autenticação | Better Auth 1.7 (e-mail e palavra-passe, HIBP; sem verificação de e-mail) |
| Base de dados | PostgreSQL 18, Drizzle ORM e migrations SQL versionadas |
| Hospedagem | Vercel Hobby (Function + CDN) e Neon Free (PostgreSQL, Frankfurt) |
| Testes | Vitest (unitários e PostgreSQL real), Playwright + axe-core (E2E e acessibilidade) |
| CI | GitHub Actions (lint, typecheck, testes, build, base de dados e E2E) |

Capturas de ecrã com dados fictícios (390, 820 e 1440 px) em [screenshots/](screenshots/).

## Requisitos

- Node.js **24.21.0** (ver `.nvmrc`; aceita `>=24.12.0 <25`)
- npm 11
- Docker com Compose v2 (só para a base de dados e os testes de base de dados)

## Primeiros passos

```bash
npm ci
cp .env.example .env   # necessário: a API precisa de DATABASE_URL
npm run db:up          # PostgreSQL do RunFlow em 127.0.0.1:55432
npm run db:migrate     # aplica as migrations à base de desenvolvimento
npm run dev
```

Com `BETTER_AUTH_SECRET` vazio, a API usa em desenvolvimento um segredo
temporário (as sessões perdem-se ao reiniciar). Para sessões estáveis, gere um
valor local com o comando indicado no `.env.example`.

- Web: <http://localhost:5173>
- API: <http://localhost:3100/api/v1/health> (a web chega lá por `/api/v1`, através do proxy do Vite)

## Base de dados local

O `compose.yaml` define um serviço exclusivo do RunFlow, sem partilhar nada com
outros projetos:

| Recurso | Valor |
|---|---|
| Projeto Compose | `runflow` |
| Container | `runflow-postgres` (imagem `postgres:18.6-bookworm`) |
| Volume | `runflow_pgdata` |
| Porta | `127.0.0.1:55432` (variável `RUNFLOW_DB_PORT`) |
| Base de desenvolvimento | `runflow_dev` (`DATABASE_URL`) |
| Base de testes | `runflow_test` (`TEST_DATABASE_URL`), criada automaticamente pelos testes |

As credenciais em `.env.example` são só para uso local. `DATABASE_URL` é lida
apenas no servidor; nunca a exponha à web nem use o prefixo `VITE_`.

### Migrations (fluxo único)

1. Altere o schema em `apps/api/src/db/schema/` (`domain.ts`; `auth.ts` é gerado).
2. Gere a migration: `npm run db:generate -- --name descricao-curta`.
3. Reveja o SQL em `apps/api/drizzle/` e versione a pasta inteira (incluindo `meta/`).
4. Aplique: `npm run db:migrate`.

Nunca use `drizzle-kit push` nem altere o schema à mão (ver D14 em `docs/decisions.md`).

Se a configuração do Better Auth mudar (campos ou plugins), regenere primeiro
`npm run db:auth:generate` e depois `npm run db:generate`.

## Autenticação (API)

Better Auth 1.7.7, montado com o handler oficial em `/api/auth/*`. Em
desenvolvimento, a web chega lá pela mesma origem do Vite (`http://localhost:5173/api/auth`).

| Ação | Pedido |
|---|---|
| Registo | `POST /api/auth/sign-up/email` com `{ name, email, password, timeZone }` (não inicia sessão; resposta igual para e-mails novos e existentes) |
| Login | `POST /api/auth/sign-in/email` com `{ email, password }` |
| Trocar palavra-passe | `POST /api/auth/change-password` com `{ currentPassword, newPassword }` |
| Sessão | `GET /api/auth/get-session` |
| Perfil | `POST /api/auth/update-user` com `{ name?, timeZone? }` |
| Logout | `POST /api/auth/sign-out` |
| Confirmação, reenvio, recuperação e redefinição | **410** `FEATURE_UNAVAILABLE` (sem e-mail, D52) |
| Utilizador atual | `GET /api/v1/me`: `{ id, name, email, timeZone }`; sem sessão dá 401 em problem+json |

- **Origem:** os pedidos com cookie têm de trazer `Origin` igual a `APP_URL`; outra
  origem ou a sua ausência dá 403. Esta é a proteção CSRF oficial da biblioteca.
- **Cookies:** `runflow.session_token`, `HttpOnly`, `SameSite=Lax`, válido 7 dias.
  - **Local (HTTP):** sem `Secure`, porque o browser recusaria o cookie em
    `http://localhost`.
  - **Produção:** `NODE_ENV=production` exige `APP_URL` em https e o cookie passa a
    `__Secure-runflow.session_token`, com `Secure`.
- **Palavra-passe:** 15–128 caracteres, sem regras de composição. No registo,
  e na troca é verificada no Have I Been Pwned (só 5 caracteres do SHA-1
  saem do servidor): comprometida dá 400 `PASSWORD_COMPROMISED`; se a consulta falhar
  ou demorar mais de 5 s, 503 `PASSWORD_CHECK_UNAVAILABLE`, sem criar conta. O login
  nunca consulta o HIBP.
- **E-mail:** não é verificado nem enviado; o campo `emailVerified` fica `false`
  (nunca marcado artificialmente).
- **Rate limiting:** guardado na base (tabela `rate_limit`), por IP do cliente.
  - O IP vem do Express (`TRUST_PROXY`); um `X-Forwarded-For` enviado pelo próprio
    cliente é ignorado.
  - Ao exceder o limite, a resposta é 429 com `Retry-After` (padrão, acrescentado pela
    API) e `X-Retry-After` (original do Better Auth).

Detalhes e justificações: D19–D25 em [docs/decisions.md](docs/decisions.md).

## API de treinos

`/api/v1/workouts` (POST, GET lista, GET/PATCH/DELETE por id), só com sessão. O
utilizador vem sempre da sessão; um treino inexistente ou de outra pessoa dá o mesmo
404. Escritas exigem `Origin` igual a `APP_URL` e JSON. Contrato completo, códigos de
erro, cursor e exemplos reais em **[docs/api.md](docs/api.md)**; decisões em D26–D32.
Objetivos (`/api/v1/goals`) e dashboard (`/api/v1/dashboard`) seguem as mesmas regras
(D33–D34).

## Scripts (na raiz)

| Comando | O que faz |
|---|---|
| `npm run dev` | Arranca a API (com `--watch`) e a web (Vite) em paralelo |
| `npm run build` | Compila `packages/shared`, `apps/api` e `apps/web` para `dist/` |
| `npm run lint` | ESLint com regras de tipos e restrições anti-XSS (zero avisos) |
| `npm run typecheck` | `tsc` em todos os workspaces e nos ficheiros de configuração |
| `npm test` | Testes unitários (não precisam de Docker) |
| `npm run test:db` | Testes com PostgreSQL real (migrations, constraints, autenticação e treinos por HTTP) na base `runflow_test`; precisa de `db:up` |
| `npm run test:e2e` | E2E com Playwright (Chrome do sistema), API e PostgreSQL reais na base `runflow_e2e_test`; precisa de `db:up` |
| `npm run check` | lint, typecheck, test e build, por esta ordem |
| `npm run db:up` / `db:stop` / `db:status` | Arranca, para ou mostra o container PostgreSQL (nunca apaga o volume) |
| `npm run db:generate` | Gera uma migration SQL a partir do schema (drizzle-kit, sem ligar à base) |
| `npm run db:check` | Verifica a consistência das migrations (drizzle-kit) |
| `npm run db:migrate` | Aplica as migrations à base de `DATABASE_URL` |
| `npm run start` | Arranca a API compilada (`apps/api/dist/server.js`); em produção serve também o build da web |
| `npm run db:migrate:deploy` | Aplica as migrations com o código compilado: passo explícito antes de cada deploy, nunca no arranque |
| `npm run db:migrations:status` | Mostra migrations aplicadas, pendentes, alteradas ou desconhecidas (sai com 1 se algo falhar) |
| `npm run db:purge-rate-limits` | Apaga registos de rate limiting expirados em lotes limitados (`-- --dry-run` só conta); a API já o faz de hora a hora (D43) |
| `npm run db:auth:generate` | Regenera `apps/api/src/db/schema/auth.ts` com a CLI oficial do Better Auth |

Para correr a API compilada: `npm run build` e depois `npm run start --workspace @runflow/api`.

## Estrutura

```
apps/
  api/        Express 5 + TypeScript (app.ts separado do arranque em server.ts)
    src/auth/   configuração do Better Auth e ligação ao Express (requireSession)
    src/http/   middlewares de domínio (origem, rate limiting, validação, JSON)
    src/workouts/ rotas, repositório (filtrado por dono) e cursor de treinos
    src/goals/  objetivos (um ativo, transições em transação)
    src/dashboard/ totais do período
    src/db/     cliente Drizzle, migrador e schema (auth gerado + domínio)
    drizzle/    migrations SQL versionadas (+ meta/)
    test/db/    testes com PostgreSQL real
  web/        React + Vite + TypeScript, CSS próprio com tokens
    src/lib/    cliente da API, cliente Better Auth, sessão/cache, formatação
    src/pages/  páginas públicas, área pessoal e demo
    src/demo/   fixtures fictícias da demo
packages/
  shared/     Schemas Zod, tipos e funções puras (datas civis, ritmo)
tests/        Testes de tooling (regras de segurança do ESLint)
e2e/          Testes E2E (Playwright) e preparação da base E2E
scripts/      dev.mjs (arranque paralelo) e clean.mjs
docs/         decisions.md, api.md e deployment.md (plano de publicação)
compose.yaml  PostgreSQL local do RunFlow
```

## Web

- **Rotas:** `/`, `/entrar`, `/criar-conta`; `/recuperar-acesso`, `/redefinir-senha`,
  `/verificar-email` e `/confirmar-email` mostram que a funcionalidade está indisponível;
  área pessoal `/app` (painel), `/app/treinos`, `/app/treinos/novo`,
  `/app/treinos/:id/editar`, `/app/objetivo`, `/app/conta`; demo `/demo`,
  `/demo/treinos`, `/demo/objetivo`.
- **Dados:** TanStack Query, com chaves por utilizador (`["u", userId, …]`). A cache é
  limpa no login, no logout e quando a API responde 401 (a sessão fica a `null` na
  query observada; ver D44).
- **Carregamento:** a landing está no ficheiro de entrada; autenticação, área privada
  e demo são chunks `lazy` (D41). A demo nunca descarrega o cliente Better Auth.
- **Autenticação:** cliente oficial do Better Auth, na mesma origem (`/api/auth`). O
  registo entra logo a seguir; o registo e a Conta avisam que não há verificação de
  e-mail nem recuperação de palavra-passe.
- **Segurança na interface:** conteúdo renderizado como texto, envio duplicado
  bloqueado, `?next=` validado por parsing de URL (só `/app…` após normalização) e
  `Referrer-Policy: no-referrer`.
- **Cabeçalhos:** a CSP e os restantes headers de `packages/shared/src/security-headers.ts`
  são enviados pelo Express (produção e E2E) e pelo `vite preview`.
- **E2E:** `npm run test:e2e` constrói a web e arranca o **Express** em localhost:4173 a
  servir o build e a API (topologia de produção), com o HIBP simulado e a rede externa
  bloqueada (`e2e/fake-network-preload.ts`), e usa o Chrome instalado (sem descarregar browsers). As
  capturas ficam em `.e2e/screenshots` (ou em `E2E_SCREENSHOT_DIR`). Em falhas, o
  trace e a captura do Playwright ficam em `test-results/`.

## Convenções

- Distância em **metros inteiros** e duração em **segundos inteiros**.
- Datas de treino são **datas civis** `YYYY-MM-DD`, sem hora nem fuso. Nunca use
  `new Date("YYYY-MM-DD")`, que desloca o dia em fusos negativos. Na base, são
  colunas `DATE` lidas como string; os instantes são `TIMESTAMPTZ`.
- Ritmo médio = `round(totalDurationS * 1000 / totalDistanceM)` s/km; sem distância, `null`.
- Conteúdo do utilizador é sempre renderizado como texto (ver `docs/decisions.md`, D6).

## CI

`.github/workflows/ci.yml` tem três jobs com a versão de Node do `.nvmrc`:

- **check:** `npm ci`, lint, typecheck, testes unitários e build;
- **database:** serviço PostgreSQL 18 com credenciais efémeras, `db:check`,
  deteção de schema sem migration, `db:migrate` e `test:db` (inclui os testes HTTP de autenticação);
- **e2e:** PostgreSQL de testes, Playwright com o Chrome da imagem e, em falhas,
  artefacto com traces, capturas e relatório HTML (7 dias).

O CI corre em cada push para `main` e em cada pull request.

## Decisões

Ver [docs/decisions.md](docs/decisions.md).
