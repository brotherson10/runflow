# Decisões — RunFlow V2

Registo das decisões de produto e de arquitetura. Cada entrada indica a data,
o estado e o motivo. Decisões "pendentes" ainda não podem ser assumidas no código.

## Produto e âmbito

### D1 — V2 separada; versão do estágio preservada
- **Data:** 2026-10-12 · **Estado:** aceite
- A V2 vive num repositório novo (`runflow`, monorepo). Os repositórios da versão
  desenvolvida no estágio DecodeLabs —
  [runflow-frontend](https://github.com/brotherson10/runflow-frontend) e
  [runflow-backend](https://github.com/brotherson10/runflow-backend) — ficam
  inalterados como registo histórico.
- Tags (`v1.0-decodelabs`), notas nos READMEs da v1 e arquivamento são ações
  separadas, ainda **não executadas**, que exigem aprovação própria.

### D2 — Idioma e unidades: PT-PT e km
- **Data:** 2026-10-12 · **Estado:** aceite
- Interface em português europeu (`lang="pt-PT"`). Distâncias apresentadas em km;
  internamente em metros inteiros e durações em segundos inteiros.

### D3 — Objetivo = distância de uma corrida, sem progresso automático
- **Data:** 2026-10-12 · **Estado:** aceite
- `targetDistanceM` representa a distância de uma única corrida (ex.: 10 km,
  meia maratona). Não há barra de progresso nem soma automática de treinos.

### D4 — Demo futura com fixtures fictícias separadas e só de leitura
- **Data:** 2026-10-12 · **Estado:** aceite (implementação em fase futura)
- Os dados da demo são fixtures fictícias separadas dos dados dos utilizadores,
  servidas apenas por leitura. A demo não tem sessão nem operações de escrita.
- Substitui a proposta da Fase 2 de um "utilizador demo" na mesma base de dados.

## Segurança

### D5 — Autenticação pela integração oficial do Better Auth
- **Data:** 2026-10-12 · **Estado:** aceite (implementação em fase futura)
- Usar o handler oficial do Better Auth para Express (`toNodeHandler`), sem
  wrappers próprios por omissão. Consequência: as rotas de autenticação usam o
  formato de erro do Better Auth; as restantes rotas usam `application/problem+json`.
- O parser JSON da API está montado no router `/api/v1` (não globalmente), porque
  a documentação do Better Auth exige o handler antes de `express.json()`.
- **Fase 3B:** `better-auth` 1.7.7 e `@better-auth/drizzle-adapter` 1.7.7 foram
  instalados só para gerar o schema das tabelas de autenticação.
- **Fase 3C:** handler oficial montado em `/api/auth/*splat`, antes do parser JSON
  do domínio. Sem wrappers. A configuração completa está em D19–D25.

### D6 — Conteúdo do utilizador renderizado como texto
- **Data:** 2026-10-12 · **Estado:** aceite
- O ESLint proíbe `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `document.write`/`writeln` e `dangerouslySetInnerHTML` (`eslint.security.js`,
  com testes em `tests/eslint-security.test.ts`).
- Os schemas guardam o texto tal como foi escrito (com trim); o escape é feito na saída.

## Técnica

### D7 — Runtime fixado em Node 24.21.0
- **Data:** 2026-10-12 · **Estado:** aceite
- `.nvmrc` = `24.21.0` (LTS "Krypton"); `engines.node` = `>=24.12.0 <25` com
  `engine-strict=true` no `.npmrc`. O mínimo 24.12.0 corresponde à remoção de tipos
  estável no Node, usada em `npm run dev` da API.
- O Node 24 entra em Maintenance LTS a 2026-10-20 (fim a 2028-04-30). Reavaliar a
  migração para o Node 26 depois de este passar a LTS (2026-10-28).

### D8 — Versões das dependências
- **Data:** 2026-10-12 · **Estado:** aceite
- Versões exatas (`save-exact`), escolhidas como a mais recente publicada há pelo
  menos 7 dias e compatível com Node 24.
- **TypeScript 6.0.3, não 7.x:** o `typescript-eslint` 8.71.1 suporta
  `typescript >=4.8.4 <6.1.0`.
- `overrides` na raiz fixam `vite` 8.3.2 e `zod` 4.6.5, para que o Vitest e o
  plugin do ESLint usem as mesmas versões que a aplicação.
- **Fase 3B (persistência):** `drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11,
  `pg` 8.23.1 (+ `@types/pg` 8.23.1), `better-auth` 1.7.7,
  `@better-auth/drizzle-adapter` 1.7.7 e a CLI oficial `auth` 1.7.7.
  Compatibilidade confirmada nos metadados oficiais: o `better-auth` 1.7.7 aceita
  `drizzle-orm ^0.45.2`, `drizzle-kit >=0.31.4` e `pg ^8`; o `drizzle-orm` aceita
  `pg >=8`; a CLI `auth` exige Node `>=22.12.0`. A CLI antiga `@better-auth/cli`
  parou na 1.4.x e não é usada.
- O npm 11.19 não executou os `postinstall` do `esbuild` (aprovação de install
  scripts). Não foram aprovados: `drizzle-kit generate/check` funcionam sem eles.
- **Alerta conhecido (2026-10-12):** `npm audit` reporta 4 moderadas (GHSA-67mh-4wv8-2f99).
  - **Origem:** `drizzle-kit` 0.31.11 → `@esbuild-kit/*` (descontinuado) → `esbuild` 0.18.20.
    O alerta afeta só o servidor `serve` do esbuild, que o drizzle-kit não usa.
  - **Não foi introduzido na Fase 3C:** o lockfile da 3B, auditado hoje, mostra o mesmo.
  - **Âmbito:** o drizzle-kit é uma ferramenta de desenvolvimento e CI e não é
    importado pelo código da API.
    - O npm marca as `devDependencies` dos workspaces como não-dev no lockfile da
      raiz, por isso `--omit=dev` não as exclui. Um deploy futuro tem de instalar
      só as dependências de runtime da API.
  - **Tentativa de correção:** um `override` de `esbuild` para 0.25.12 ficou
    inválido no `npm ls` e não foi adotado. A "correção" do `npm audit fix --force`
    (`drizzle-kit` 0.18.1) seria uma regressão.
  - **Decisão:** aceitar por agora e reavaliar quando o drizzle-kit deixar de
    depender de `@esbuild-kit`.

### D9 — Erros da API em RFC 9457
- **Data:** 2026-10-12 · **Estado:** aceite
- `type: "about:blank"`, `title` = frase HTTP, mais as extensões `code` (estável,
  para clientes) e `requestId`. Os URIs de tipo próprios ficam para quando houver domínio.
- Nunca há stack trace nem mensagens internas nas respostas; o detalhe vai só para o log.
- Limite de body JSON de 16 kB; JSON inválido dá 400 `INVALID_JSON`; excesso dá 413.

### D10 — Porta por omissão da API: 3100
- **Data:** 2026-10-12 · **Estado:** aceite
- Configurável com `PORT`. A 3100 evita colisões com servidores de desenvolvimento
  na 3000 (observadas na auditoria). A web usa um caminho relativo `/api/v1`; em
  desenvolvimento, o Vite faz proxy para `API_PROXY_TARGET`.

### D11 — Limites de plausibilidade (provisórios)
- **Data:** 2026-10-12 · **Estado:** provisório
- Distância 1 m–1000 km; duração 1 s–48 h; título 1–80 e observações ≤ 1000
  caracteres (code points, como o `char_length` do PostgreSQL); datas de treino
  desde 1970-01-01.
- A regra "sem datas futuras" é uma função separada (`isCivilDateInFuture`),
  porque depende do fuso do utilizador.

## Persistência (Fase 3B)

### D12 — Formato do ID de utilizador: string do Better Auth
- **Data:** 2026-10-12 · **Estado:** aceite
- O schema oficial do Better Auth 1.7.7 define `user.id` como `string`
  (documentação "Core Schema", tag v1.7.7). Mantém-se a geração de IDs por
  omissão do Better Auth (sem `advanced.database.generateId`), por isso a coluna é
  `text` e o formato é tratado como **opaco**: não se presume UUID.
- `goals.user_id` e `workouts.user_id` são `text` com FK para `user.id`.
- Os IDs das tabelas de domínio (`goals.id`, `workouts.id`) são `uuid` com
  `gen_random_uuid()`: são independentes do Better Auth.

### D13 — Instantes em TIMESTAMPTZ; datas civis em DATE
- **Data:** 2026-10-12 · **Estado:** aceite
- Todas as colunas de instante são `timestamp with time zone`; `performed_on` e
  `target_date` são `date`, lidas e escritas como string `YYYY-MM-DD`
  (`date(..., { mode: "string" })` no Drizzle).
- A CLI do Better Auth 1.7.7 gera `timestamp` **sem** fuso e não tem opção para
  mudar isso. `npm run db:auth:generate` corre a CLI oficial e aplica um único
  passo determinístico (`timestamp("x")` → `timestamp("x", { withTimezone: true })`),
  falhando se o formato gerado mudar. O ficheiro `src/db/schema/auth.ts` é gerado
  e não se edita à mão.
- **Verificado na Fase 3C (runtime):** o Better Auth funciona com `timestamptz`.
  Ver D24.
- **Cuidado:** o `pg` puro converte `DATE` num `Date` à meia-noite local
  (verificado: em `America/Los_Angeles` devolve `07:00Z`). Ler datas civis sempre
  pelo Drizzle com `mode: "string"` ou com `::text`, nunca como `Date`.

### D14 — Estratégia única de migrations
- **Data:** 2026-10-12 · **Estado:** aceite
- Fluxo único:
  1. alterar o schema TypeScript em `apps/api/src/db/schema/`;
  2. `npm run db:generate -- --name <descricao>` gera SQL versionado em
     `apps/api/drizzle/` (SQL + `meta/_journal.json` + snapshots, todos versionados);
  3. rever o SQL;
  4. `npm run db:migrate` aplica com o migrador do Drizzle, que regista o
     histórico em `drizzle.__drizzle_migrations`.
- **Proibido:** `drizzle-kit push`, alterações manuais ao schema e SQL aplicado fora
  das migrations. O `drizzle.config.ts` não tem credenciais, por isso o drizzle-kit
  não liga a nenhuma base.
- O CI verifica `drizzle-kit check` e falha se `db:generate` produzir ficheiros
  novos (schema alterado sem migration).
- Se uma alteração precisar de SQL que o Drizzle não gera, usar uma migration
  personalizada do drizzle-kit, também versionada no journal.

### D15 — PostgreSQL local exclusivo em Docker
- **Data:** 2026-10-12 · **Estado:** aceite
- `compose.yaml`: projeto `runflow`, container `runflow-postgres`, volume
  `runflow_pgdata` e rede `runflow_default`, com a imagem `postgres:18.6-bookworm`.
  A porta `127.0.0.1:55432` é configurável por `RUNFLOW_DB_PORT`.
- Não reutiliza nada do Tralyn (Supabase em 54321–54327) nem do `dev-burguer-postgres` (5432).
- PostgreSQL 18, porque é suportado pelo Neon (hospedagem proposta, ainda pendente).
- As credenciais `runflow` / `runflow_local_dev` são só locais. `DATABASE_URL`
  existe apenas no servidor (API e scripts) e nunca usa prefixo `VITE_`.
- Não há script que apague o volume. `npm run db:stop` só para o container.

### D16 — Base de testes separada e protegida
- **Data:** 2026-10-12 · **Estado:** aceite
- `TEST_DATABASE_URL` aponta para `runflow_test`, no mesmo servidor local; a base é
  criada pelo `globalSetup` se faltar (nunca é apagada).
- Antes de qualquer limpeza, verifica-se:
  - pelo URL: host local, nome terminado em `_test` e diferente de `DATABASE_URL`;
  - em runtime: `current_database()` tem de terminar em `_test`.
  Caso contrário, os testes recusam-se a correr.
- A limpeza remove e recria só os schemas `public` e `drizzle` da base de testes.
- `npm test` não precisa de Docker; os testes de base de dados correm com
  `npm run test:db`, em série.

### D17 — Eliminação de conta: cascade total
- **Data:** 2026-10-12 · **Estado:** aceite
- Apagar um `user` apaga as suas sessões e contas (definido pelo schema do Better
  Auth), bem como os seus objetivos e treinos (`on delete cascade`). Os dados de
  outros utilizadores ficam intactos.
- A funcionalidade de eliminar conta (UI/API) continua por decidir (RGPD).

### D18 — Constraints são integridade, não autorização
- **Data:** 2026-10-12 · **Estado:** aceite
- As constraints repetem os limites de `LIMITS`, e os testes verificam esse
  alinhamento nos dois sentidos: o máximo é aceite e máximo + 1 é rejeitado, com
  caracteres contados como code points.
- O trim não é imposto pela base (as regras de espaço do JavaScript e do PostgreSQL
  diferem); a base só rejeita texto vazio ou só com espaços.
- As FKs e o índice único **não** provam isolamento entre utilizadores. Isso será
  verificado nas queries e na API, com dois utilizadores, quando existirem os
  endpoints de domínio (a Fase 3C só testa identidades de sessão distintas em /me).

## Autenticação (Fase 3C)

### D19 — Configuração do Better Auth (`apps/api/src/auth/auth.ts`)
- **Data:** 2026-10-12 · **Estado:** aceite
- `baseURL` = `APP_URL` (origem pública) e `basePath` = `/api/auth`. Há uma única
  origem confiável (`trustedOrigins: [APP_URL]`). `disableCSRFCheck` e
  `disableOriginCheck` ficam explicitamente `false`.
- **Login com e-mail e palavra-passe:**
  - `autoSignIn: false`, para o registo não revelar se o e-mail já existe. É a
    proteção oficial contra enumeração;
  - `customSyntheticUser` aplica ao registo repetido a mesma normalização que ao
    registo real (nome com trim, sem imagem, com `timeZone`).
- **Palavra-passe:** 8–128 caracteres, o padrão do Better Auth explicitado em
  `LIMITS.passwordLength`. É **provisório**: a política está por decidir.
- **Verificação de e-mail:** desligada, porque exige envio real (pendente).
- **Sessão:**
  - duração de 7 dias, renovada uma vez por dia de uso (`updateAge`);
  - **sem** `cookieCache`, para que logout e revogação tenham efeito imediato.
- **Cookies:**
  - prefixo `runflow`, `HttpOnly`, `SameSite=Lax`, `Path=/`;
  - `Secure` com o prefixo `__Secure-` em produção (`useSecureCookies`);
  - produção exige `APP_URL` em https.
  - **Local (HTTP):** sem `Secure`, porque o browser recusaria o cookie em
    `http://localhost`. A produção não fica mais fraca: a regra está ligada a
    `NODE_ENV=production` e ao https obrigatório.
- **Segredo:** `BETTER_AUTH_SECRET`, com 32+ caracteres.
  - **Obrigatório** em `test` e `production`.
  - Em desenvolvimento, sem valor definido, é gerado um segredo aleatório
    temporário, nunca o segredo fixo por omissão da biblioteca.
- Telemetria desligada. O logger do Better Auth regista só a mensagem, sem os
  argumentos extra, que podem conter dados do pedido.

### D20 — Fuso horário do utilizador e campos internos
- **Data:** 2026-10-12 · **Estado:** aceite
- `user.timeZone` é um `additionalField` obrigatório, coluna `time_zone`.
  - Validado no servidor com `timeZoneSchema`: identificador IANA canónico da lista
    do `Intl`, mais "UTC"; desvios como "+01:00" são rejeitados.
  - Validado no registo e em `/update-user`.
- **Validação prévia:** nome e fuso são validados num `hooks.before` oficial,
  **antes** de o Better Auth verificar se o e-mail existe. Assim, um dado inválido
  dá o mesmo erro para contas novas e existentes, sem enumeração.
- **Campos internos (verificado por testes):**
  - `id`, `emailVerified` e `createdAt` enviados pelo cliente são ignorados;
  - alterar `email` é recusado pelo Better Auth;
  - `image` é recusada, porque não é usada pelo RunFlow.
- `GET /api/v1/me` devolve só `id`, `name`, `email` e `timeZone`, com `no-store`.

### D21 — IP do cliente e rate limiting persistente
- **Data:** 2026-10-12 · **Estado:** aceite
- **O padrão da biblioteca não é seguro aqui.** O Better Auth 1.7.7 lê
  `X-Forwarded-For` por omissão e, sem `trustedProxies`, aceita um único IP aí
  indicado. Um cliente poderia mudar esse cabeçalho a cada pedido e contornar o
  limite (verificado no código-fonte e por um teste de mutação).
- **Solução:**
  - o Express define o cabeçalho interno `x-runflow-client-ip` a partir de
    `req.ip`, apagando antes qualquer valor enviado pelo cliente;
  - o Better Auth só lê esse cabeçalho (`ipAddressHeaders`);
  - `req.ip` depende de `TRUST_PROXY`: por omissão `false` (IP do socket, com
    X-Forwarded-For ignorado); com um número de saltos ou uma lista de proxies
    confia só nesses; `true` é recusado.
- **Armazenamento:** `storage: "database"` (tabela `rate_limit`), com contagem
  atómica por IP + rota. Sobrevive a reinícios e funciona com várias instâncias.
- **Limites:**

  | Rota | Limite |
  |---|---|
  | Global | 100/60 s |
  | `/sign-in/email` | 5/60 s |
  | `/sign-up/email` | 5/60 s |
  | `/change-password` | 5/60 s |
  | `/reset-password` | 5/60 s |
  | `/request-password-reset` | 3/15 min |

- `/api/v1/*` (ex.: `/me`) ainda não tem rate limiting próprio. Fica pendente para
  quando existirem os endpoints de domínio.

### D22 — Recuperação de palavra-passe
- **Data:** 2026-10-12 · **Estado:** aceite
- Fluxo oficial do Better Auth (`/request-password-reset` e `/reset-password`):
  - **Resposta neutra:** idêntica para contas existentes e inexistentes (testada).
  - **Token:** de uso único (consumido de forma atómica) e expira em **30 minutos**
    (`resetPasswordTokenExpiresIn: 1800`). Um token expirado é removido e rejeitado.
  - **Depois da redefinição:** todas as sessões são revogadas
    (`revokeSessionsOnPasswordReset`), não há login automático e é enviado um
    aviso "palavra-passe alterada".
- **Link:** construído a partir de `APP_URL` (`/redefinir-senha?token=…`), nunca
  do cabeçalho Host. A página web ainda não existe.
- **Tempos de resposta:** o e-mail é enviado sem `await`, como recomenda a
  documentação. Para contas inexistentes, o Better Auth simula a geração do token
  e uma consulta. **Limite conhecido:** uma conta existente faz um INSERT extra, por
  isso os tempos não são idênticos. Não se tentou provar igualdade exata; o rate
  limiting (3/15 min por IP) reduz a utilidade de medições.

### D23 — E-mail: captura exclusivamente local
- **Data:** 2026-10-12 · **Estado:** aceite (substituível)
- A interface `Mailer` (`src/mail/mailer.ts`) tem duas implementações:
  - `MemoryMailbox`, para os testes;
  - `FileMailbox`, para desenvolvimento: grava em `apps/api/.mail-outbox/`, pasta
    ignorada pelo Git, com permissões `0600` em sistemas POSIX.
- Nada é enviado para fora. Os logs indicam só o tipo, o destinatário mascarado e o
  nome do ficheiro; tokens e links nunca aparecem em logs (testado).
- Produção recusa arrancar enquanto não existir um serviço real (`MAIL_TRANSPORT`).

### D24 — Evidência de runtime: Better Auth com TIMESTAMPTZ
- **Data:** 2026-10-12 · **Estado:** verificado
- Testes HTTP com PostgreSQL real (`auth-timestamptz.db.test.ts`):
  - as 12 colunas de instante das tabelas de auth são `timestamptz`;
  - a validação de schema do adapter não reporta divergências;
  - a expiração da sessão é gravada como agora + 7 dias com o processo em
    UTC+14, e lida como o mesmo instante com o processo em UTC−7;
  - o `createdAt` do utilizador e a expiração do token (+30 min) estão corretos;
  - uma sessão expirada na base é recusada.

### D25 — Contagem de caracteres
- **Data:** 2026-10-12 · **Estado:** aceite
- **Unidade:** code points, em `codePointLength` no código partilhado e
  `char_length` no PostgreSQL com UTF-8. Não são grafemas visíveis:
  - "é" decomposto (e + U+0301) conta 2;
  - uma bandeira conta 2;
  - uma família com ZWJ conta 5.
- Os mesmos exemplos (`packages/shared/test/fixtures/unicode-samples.ts`) são
  verificados nos dois lados, incluindo os limites máximo e máximo + 1.
- Não há normalização NFC: o mesmo texto em NFD ocupa mais code points.
  Normalizar fica pendente.

## API de treinos (Fase 3D)

Contrato completo em [api.md](api.md).

### D26 — Autorização por dono em todas as consultas
- **Data:** 2026-10-12 · **Estado:** aceite
- O `userId` vem só da sessão (`requireSession`). O repositório
  (`src/workouts/repository.ts`) recebe-o em todas as funções e filtra por `id` **e**
  `user_id` em leituras, alterações e eliminações, incluindo a leitura com bloqueio do
  PATCH e o próprio UPDATE.
- Treino inexistente ou de outro utilizador → o mesmo 404 (corpo idêntico, exceto
  `requestId`). A validação final do PATCH (ex.: data futura) só corre depois de
  confirmar o dono, para não revelar a existência de treinos alheios (testado).
- Campos desconhecidos no corpo (incluindo `userId` e `id`) e na query → 400.
- **Verificado por testes HTTP com dois utilizadores** e por 7 mutações (remover o filtro
  de dono em leitura, eliminação, lista e leitura do PATCH; desempate do keyset; proteção
  de origem; regra de data futura), todas detetadas.
- Objetivos, dashboard e demo ainda não existem: o seu isolamento será testado quando
  forem implementados.

### D27 — Validação: schemas partilhados, PATCH e identificadores
- **Data:** 2026-10-12 · **Estado:** aceite
- O POST usa `workoutInputSchema`; o PATCH usa `workoutPatchSchema` (pelo menos um
  campo; `notes: null` limpa), e o resultado final é validado com `workoutInputSchema`
  numa transação.
- `:id` tem de ser um UUID canónico em minúsculas (`resourceIdSchema`, sem coerção):
  formato inválido → 400 `INVALID_ID`.
- Os erros devolvem `errors[]` com campo, código e mensagem, nunca o valor recebido.
- Não se impedem treinos repetidos com os mesmos valores; o duplo envio fica para a
  interface.

### D28 — Data futura com relógio injetável
- **Data:** 2026-10-12 · **Estado:** aceite
- `performedOn` não pode ser posterior a "hoje" no `timeZone` do utilizador, lido da
  sessão em cada pedido. O relógio é injetado em `createApp({ domain: { clock } })`, o que
  permite testes determinísticos (UTC+14, Los Angeles, meia-noite de Lisboa).
- No PATCH, a regra só se aplica quando `performedOn` é enviado. Assim, editar a
  distância de um treino de "hoje" continua possível depois de o utilizador mudar para
  um fuso mais atrasado (documentado e testado).

### D29 — Paginação por cursor (keyset)
- **Data:** 2026-10-12 · **Estado:** aceite
- **Ordem:** `performed_on DESC, created_at DESC, id DESC`, que usa o índice
  `workouts_user_history_idx`. O limite é 20 por omissão e 100 no máximo.
- **Cursor:** base64url de JSON versionado com a posição (`created_at` em texto UTC com
  **microssegundos**, porque o `Date` do JS perde precisão e quebraria os desempates) e
  com os filtros `from`/`to`.
  - Se os filtros mudarem, o cursor é recusado com 400 `INVALID_CURSOR`.
  - Mudar só o `limit` é permitido.
- O cursor não é assinado nem contém o utilizador; nunca dá acesso a dados, porque a
  consulta filtra sempre pela sessão (testado com um cursor de outro utilizador e com
  um cursor forjado). Uma assinatura HMAC só impediria posições arbitrárias dentro dos
  próprios dados, sem ganho de segurança; foi rejeitada por agora.

### D30 — Proteção de origem (CSRF) nas escritas de domínio
- **Data:** 2026-10-12 · **Estado:** aceite
- As proteções do Better Auth só cobrem `/api/auth`. Em `/api/v1/workouts`, POST, PATCH
  e DELETE são recusados com 403 `FORBIDDEN_ORIGIN` nestes casos:
  - sem `Origin`, ou com `Origin: null`;
  - com uma origem fora de `APP_URL`;
  - com `Sec-Fetch-Site: cross-site`.
  As leituras não são verificadas: não alteram estado, e sem CORS o browser não
  entrega respostas a outras origens.
- Escritas com corpo exigem `Content-Type: application/json` (415), o que impede
  pedidos "simples" de formulários de outros sites.
- **Ordem:** rate limiting → origem → sessão → parser JSON → rota. O router de treinos
  tem o seu próprio parser, para que JSON inválido sem sessão não seja processado
  antes da autenticação.

### D31 — Rate limiting de domínio e `Retry-After`
- **Data:** 2026-10-12 · **Estado:** aceite
- **Algoritmo:** janela fixa por `bucket:tipo|IP` (leitura ou escrita). O IP é o `req.ip`
  do Express, a mesma estratégia `TRUST_PROXY` do Better Auth.
- **Armazenamento:** tabela própria `api_rate_limit` (migration 0002), com um único
  `INSERT … ON CONFLICT`, atómico e persistente.
  - **Porque não reutilizar a `rate_limit` do Better Auth:** essa tabela é da biblioteca,
    a semântica de `last_request` é definida por ela e pode mudar numa atualização.
    Partilhá-la acoplaria as duas implementações.
- **Configuração:** `API_RATE_LIMIT_WINDOW_S` (60), `API_RATE_LIMIT_READ_MAX` (120) e
  `API_RATE_LIMIT_WRITE_MAX` (30).
- **Contrato do 429:**
  - as rotas de domínio enviam `Retry-After` em segundos (padrão RFC 9110);
  - o Better Auth 1.7.7 envia só `X-Retry-After`, não normalizado. Um middleware à
    volta do handler oficial acrescenta `Retry-After` com o mesmo valor, sem alterar a
    integração. Os clientes devem ler `Retry-After`.
- **Limitação:** as linhas antigas de `api_rate_limit` não são limpas automaticamente
  (uma por IP e tipo); a limpeza periódica fica pendente.

### D32 — Robustez dos testes com base de dados (incidente de 2026-10-12)
- **Data:** 2026-10-12 · **Estado:** aceite
- **Incidente:** uma execução de `test:db` demorou cerca de 96 min.
  - O `beforeAll` de `workouts-protection` excedeu 60 s e 5 testes ficaram skipped;
    depois apareceu "Cannot use a pool after calling end on the pool" e um worker do
    Vitest não arrancou.
  - O exit code do comando agregado foi 0, por isso não serve de prova.
- **Causa confirmada:** o Windows entrou em Modern Standby (Kernel-Power 506) às
  16:37:20, 15 s antes do início da suíte, e só retomou às 18:06:57. O contentor
  PostgreSQL e o Node ficaram suspensos.
  - O erro do pool foi **consequência**: o `afterAll` fechou o pool com um pedido HTTP
    ainda em curso.
  - Um monitor de `pg_stat_activity` durante uma nova execução completa não encontrou
    esperas por locks nem transações pendentes.
- **Fragilidades corrigidas no harness:** sem aumentar timeouts nem desativar testes.
  - O servidor HTTP de teste conta os pedidos em curso e, ao fechar, espera por eles;
    se algum não terminar, falha com "N pedido(s) ainda em curso", sem erros
    secundários.
  - `resetTestDatabase` usa uma ligação dedicada:
    - recusa limpar se outra sessão tiver uma transação aberta na base de testes
      (deteta fugas de ligações);
    - faz o `DROP` com `lock_timeout = 5s`, para que um bloqueio dê erro claro em vez
      de esperar para sempre.
  - Novo teste `reset-guard.db.test.ts`, verificado por mutação: sem a verificação, o
    teste falha (e o `lock_timeout` atua em 5 s).
- **Regra:** a aprovação da suíte vem do resumo do Vitest (ficheiros, testes, skipped e
  erros), não do exit code de comandos encadeados.

## Objetivos e dashboard (Fase 3E)

### D33 — Objetivos: um ativo, transições e datas
- **Data:** 2026-10-12 · **Estado:** aceite
- **Rotas:** `GET /goals/active`, `POST /goals`, `PATCH /goals/:id`,
  `POST /goals/:id/complete` e `POST /goals/:id/replace`. Usam a mesma cadeia de
  domínio dos treinos (`http/domain.ts`: rate limiting → origem → sessão → JSON) e
  filtram sempre por `id` + `user_id`.
- **Um só ativo:** garantido pelo índice único parcial existente. Uma violação
  (incluindo pedidos concorrentes) é convertida em 409 `ACTIVE_GOAL_EXISTS`; não
  depende de uma verificação prévia sujeita a corridas.
- **Transições:** só um objetivo `active` pode ser editado, concluído ou substituído
  (senão 409 `GOAL_NOT_ACTIVE`). Cada transição lê o objetivo com `FOR UPDATE` numa
  transação. A substituição (`replaced` + novo `active`) é uma única transação: se a
  criação falhar, nada muda (testado com um trigger de falha na base de testes).
- **Ordem:** dono → estado → data. Para outro utilizador, a resposta é sempre 404,
  mesmo para objetivos concluídos ou pedidos com datas inválidas.
- **Data-alvo** (fecha a pendência "data-alvo no passado"): ao criar, substituir ou
  enviar `targetDate` num PATCH, não pode ser anterior a hoje no fuso da conta (400
  `date_in_past`); hoje é aceite. Objetivos vencidos continuam editáveis nos outros
  campos e podem ser concluídos ou substituídos.
- Não foi necessária uma migration: a tabela `goals` da Fase 3B já tinha as
  constraints e o índice.

### D34 — Dashboard calculado na leitura, sem perda de precisão
- **Data:** 2026-10-12 · **Estado:** aceite
- `GET /dashboard?from&to`: filtros obrigatórios e inclusivos. Devolve o período (com o
  fuso da conta), o objetivo ativo e os totais (`workoutCount`, `distanceM`,
  `durationS`, `paceSPerKm`).
- **Agregação no PostgreSQL:** `count(*)` e `sum` sobre colunas `integer` dão `bigint`
  (sem overflow), devolvidos como **texto**; não passam por float.
  - A conversão para JSON falha de forma explícita se um total exceder 2^53 − 1, em vez
    de arredondar em silêncio.
  - O ritmo é calculado com BigInt: `(2·d·1000 + D) / (2·D)`, o mesmo arredondamento
    de `averagePaceSecondsPerKm`. Sem distância, devolve `null`.
  - Pelos limites do domínio, o ritmo ponderado nunca excede o maior ritmo individual
    (≤ 172 800 000 s/km), por isso é sempre um inteiro seguro.
- Não há totais guardados: criar, editar ou eliminar treinos reflete-se de imediato
  (testado).

## Web e demo (Fase 4)

### D35 — Stack da web
- **Data:** 2026-10-12 · **Estado:** aceite
- **Bibliotecas:** `react-router` 8.4.0 (modo de dados: `createBrowserRouter`, e
  `RouterProvider` de `react-router/dom`), `@tanstack/react-query` 5.104.1 e o cliente
  oficial `better-auth/react` 1.7.7, com `inferAdditionalFields` para `timeZone`.
  Instaladas apenas estas; o React Router 8 exige React ≥ 19.2.7 e Node ≥ 22.22.
- **Tipagem e APIs obsoletas:** `SubmitEvent` em vez de `FormEvent` (obsoleto no
  `@types/react` 19.3) e `queryClient.query` em vez de `fetchQuery` (obsoleto no
  TanStack Query 5.104).
- **Estilo:** CSS próprio com tokens (verde profundo + acento laranja), contrastes
  verificados, fontes do sistema e sem bibliotecas de UI.
- **Formatos:** datas em PT-PT com abreviaturas fixas ("12 out. 2026"), calculadas a
  partir das partes da data civil; o ICU dos browsers e do Node variava
  ("29/03/2026"). Distância em km, duração "1 h 05 min" e ritmo "5:40 /km".

### D36 — Sessão, cache e 401
- **Data:** 2026-10-12 · **Estado:** aceite
- **Cache:** as chaves dos dados privados começam por `["u", userId]`, e a cache é
  limpa **por completo** no login, no logout e num 401, para nunca mostrar dados de
  outra conta (testado com A → B e "voltar" depois do logout).
- **401 da API:** limpa a cache e marca a sessão como ausente. A rota protegida
  redireciona **uma vez** para `/entrar?next=…&motivo=sessao`; a página de login não
  faz pedidos protegidos, por isso não há ciclos (testado). *Corrigido na Fase 5A
  (D44): a limpeza deixou de usar `clear()`.*
- **Redirect após login:** `?next=` só aceita `/app…`. URLs absolutas, `//host`, `\`,
  caracteres de controlo e mais de 512 caracteres voltam ao painel (sem open redirect).
  *Na Fase 5A passou a ser validado por parsing de URL (D44).*
- **Registo:** não inicia sessão (enumeração, D19); a web faz o login a seguir. O fuso
  inicial vem do browser (`Intl`) e pode ser mudado em Conta.

### D37 — Formulários, confirmações e acessibilidade
- **Data:** 2026-10-12 · **Estado:** aceite
- **Envio duplicado:** bloqueado por um `ref` síncrono (`useSingleFlight`) **e** pelo
  botão desativado enquanto `isPending`. O teste E2E com duplo clique e resposta
  atrasada confirmou um só POST.
- **Edição:** o PATCH envia só os campos alterados (a regra de data futura só se aplica
  se a data mudar, D28).
- **Confirmações:** eliminar, concluir e substituir usam um `<dialog>` modal nativo,
  com foco em "Cancelar", Escape a cancelar e foco devolvido.
- **Acessibilidade:**
  - labels em todos os campos, erros ligados por `aria-describedby`, erro geral com
    `role="alert"` e sucesso anunciado em `role="status"`;
  - skip link, foco visível (3 px, 4,7:1) e alvos de toque ≥ 44 px;
  - o foco vai para o `h1` só em navegações PUSH/REPLACE, não no carregamento inicial
    (o E2E de teclado detetou que o primeiro Tab saltava o skip link).
- **Fugas pelo Referer:** `<meta name="referrer" content="no-referrer">`, e a página de
  redefinição retira o token do URL.

### D38 — Demo
- **Data:** 2026-10-12 · **Estado:** aceite (concretiza D4)
- Fixtures fictícias em `apps/web/src/demo/fixtures.ts` (12 treinos e um objetivo, com
  ids `demo-*`), num conjunto fixo com "hoje" = 2026-10-10.
- As páginas reutilizam os componentes de apresentação da área pessoal, sem ações. Não
  usam a API, a sessão nem a cache do TanStack Query; os totais são calculados com
  `summarizeWorkouts` (partilhado).
- **Testado:** nenhum pedido a `/api/` durante a navegação na demo, banner visível e
  nenhum formulário ou botão de escrita.

### D39 — E2E com API e PostgreSQL reais
- **Data:** 2026-10-12 · **Estado:** aceite
- **Ambiente:** Playwright 1.63.0 com o canal `chrome` (Chrome instalado, sem
  descarregar browsers) e `@axe-core/playwright` 4.13.0; `playwright-core` fixado em
  1.63.0 por `overrides`, para tipos únicos.
- **Base `runflow_e2e_test`:** limpa e migrada por `e2e/prepare-db.ts`, com as
  proteções da base de testes (host local, sufixo `_test` e `current_database`). A
  comparação com `DATABASE_URL` não se aplica, porque aqui a API usa essa base de
  propósito.
- **Servidores:** API em 3199 (`NODE_ENV=test`, segredo de teste e e-mail capturado em
  `.e2e/mail`) e web servida pelo **build de produção** (`vite preview`, 4173).
- **Rate limiting:** com `TRUST_PROXY=loopback`, cada teste simula um cliente com IP
  próprio via X-Forwarded-For, que passa pelo proxy do Vite. Os limites continuam
  ativos.
- **Erros na consola:** qualquer erro falha o teste, exceto os anotados como esperados
  (401 e falha de rede simulada).

### D40 — Limitações da web (Fase 4)
- **Bundle:** o JS tem 513 kB (158 kB gzip), um único chunk, porque ainda não há code
  splitting por rota. *Resolvido na Fase 5A (D41).*
- **Cabeçalhos de segurança da web:** CSP e restantes headers ficam para a
  hospedagem; o `vite preview` não os define. *Na Fase 5A, o `vite preview` passou a
  aplicá-los (D46).*
- **Envio real de e-mail:** inexistente. A recuperação só funciona com captura local.
- **Âmbito dos testes:** só Chrome desktop (com emulação de largura), sem leitores de
  ecrã reais e sem Safari/Firefox.
- **Demo:** datas fixas; não acompanha o dia atual.

## Preparação para publicação (Fase 5A)

### D41 — Divisão do bundle por rota
- **Data:** 2026-10-13 · **Estado:** aceite
- **Carregamento:**
  - eager no ficheiro de entrada: a landing e a estrutura pública;
  - por `lazy` do React Router: as páginas de autenticação, a área privada (layout e
    páginas) e a demo.
- **Módulos:**
  - os layouts foram repartidos (`layouts/shell.tsx`, `app.tsx`, `demo.tsx`) e a
    landing passou para `pages/landing.tsx`;
  - `resetToSignedOut` passou para `lib/query.ts`, para o ficheiro de entrada não
    importar o cliente Better Auth.
- **Resultado (build):**

  | Parte | Tamanho | gzip | Antes |
  | --- | --- | --- | --- |
  | Carga inicial (`index` + `ui`) | 350 kB | 112 kB | 513 / 158 kB |
  | Better Auth (chunk `session`) | 41 kB | 15 kB | — |

  - O chunk `session` só é carregado pelas páginas de autenticação e pela área
    privada.
  - A demo carrega os seus chunks, `presentation` e `dist` (Zod, via o barrel de
    `@runflow/shared`), mas nunca o `session` nem o `app`.
- **Testado (E2E):** landing → demo sem pedidos a `/api/` e sem descarregar os chunks
  `session-*`, `app-*` ou `public-*`.
- **Possível melhoria:** importar `pace` sem o barrel, para a demo não carregar o Zod
  (~25 kB gzip).

### D42 — E2E no CI
- **Data:** 2026-10-13 · **Estado:** aceite (**ainda não executado remotamente**)
- **Job `e2e`:**
  - serviço `postgres:18.6-bookworm` e `E2E_DATABASE_URL` com nome `_test` em
    localhost (as proteções de `prepare-db` aplicam-se);
  - Google Chrome da imagem `ubuntu-latest` (canal `chrome`), com a versão registada
    no log.
- **Em falhas:**
  - o Playwright guarda trace e captura (`retain-on-failure`, `only-on-failure`);
  - o CI cria um relatório HTML;
  - o artefacto com `test-results/`, `playwright-report/` e `.e2e/screenshots/` é
    enviado por `actions/upload-artifact` v7.0.1, fixado por SHA, com retenção de 7
    dias;
  - não inclui `.e2e/mail`.
- **Sem retries** (`retries: 0`) e `forbidOnly` no CI: uma falha intermitente tem de
  ser vista.
- A v7.0.2 do upload-artifact (de 2026-10-07) foi preterida por ser demasiado
  recente. O workflow passou o `actionlint` 1.7.7 sem erros.

### D43 — Limpeza dos registos expirados de rate limiting
- **Data:** 2026-10-13 · **Estado:** aceite
- **Alvo:** `api_rate_limit` (por `window_start`) e `rate_limit` do Better Auth (por
  `last_request`, em ms).
- **Porque é seguro:** apagar uma linha com a janela terminada equivale a mantê-la,
  porque o pedido seguinte recomeça em 1. Por isso a retenção (24 h por omissão) tem
  de ser **maior** do que a maior janela em vigor, hoje 15 min; caso contrário, a
  limpeza recusa-se a correr.
- **Limites:**
  - lotes de 1000 linhas, no máximo 50 lotes por tabela e execução;
  - cada lote numa transação com `lock_timeout` 2 s e `statement_timeout` 15 s;
  - `FOR UPDATE SKIP LOCKED`, sem esperar por linhas em uso nem bloquear outra
    instância;
  - a expiração é verificada outra vez no `DELETE`.
- **Sem índice nem migration nova:** cada lote faz uma leitura sequencial, o que é
  adequado até algumas dezenas de milhares de linhas. Rever se crescer.
- **Execução:**
  - por omissão, dentro da API, de hora a hora (`RATE_LIMIT_PURGE_INTERVAL_S`; `0`
    desliga);
  - o primeiro ciclo corre só após um intervalo, os ciclos não se sobrepõem e o
    timer não impede o processo de terminar;
  - no shutdown, espera pelo ciclo em curso.
- **Alternativa por cron:** `npm run db:purge-rate-limits`, com `--dry-run`,
  `--retention-s`, `--batch-size` e `--max-batches`, e a API com
  `RATE_LIMIT_PURGE_INTERVAL_S=0`.
- **Testado (PostgreSQL real):**
  - linhas criadas por pedidos HTTP reais sobrevivem com a hora atual e são apagadas
    após a retenção, o que confirma as unidades do Better Auth;
  - lotes e continuação, dry run, validação da retenção e dos limites e o agendador
    funcionam;
  - linhas bloqueadas por outra transação são ignoradas sem espera.
  - Mutação: sem `SKIP LOCKED`, o teste falha com `lock_timeout`.

### D44 — `?next=`, token de recuperação e 401 (revisão)
- **Data:** 2026-10-13 · **Estado:** aceite
- **`safeNextPath`:**
  1. recusa à partida caracteres de controlo e `\`, que o parser WHATWG removeria ou
     trataria como `/` em silêncio;
  2. exige referência relativa à raiz (`/…`, nunca `//`);
  3. resolve com `new URL(raw, base fictícia)` e exige a mesma origem;
  4. valida o **pathname normalizado**: `/app` ou `/app/…`.

  Devolve o URL re-serializado, não o texto original. Assim, `/app/../entrar`,
  `/app/%2e%2e/entrar` e `/app%2f..` são recusados, e `/app/./treinos` passa a
  `/app/treinos`.
- **Token de redefinição:**
  - na web, é lido com `URLSearchParams` e aceite só se houver exatamente um
    `token`, alfanumérico com 16–128 caracteres; o Better Auth 1.7.7 gera 24 com
    `generateId(24)`;
  - se inválido, a página mostra "link não é válido" sem chamar a API;
  - continua a ser retirado do endereço;
  - o E2E identifica o link no e-mail por parsing (origem, caminho exato e um único
    token), não por regex.
- **Bug encontrado pelos E2E e corrigido:**
  - **Sintoma:** com uma página aberta cujos dados não estavam em cache, um 401
    criava um ciclo de pedidos (cerca de 120 × 401 até ao 429) e o redirecionamento
    nunca acontecia.
  - **Causa:** `client.clear()` removia a query da sessão; o observador da área
    protegida ficava preso à query removida e não via `null`.
  - **Correção:** `resetToSignedOut` põe a sessão a `null` na query existente e
    remove (e cancela) só as outras queries e as mutações.
  - **Logout voluntário:** marca `SIGNED_OUT_KEY` e vai para `/entrar` sem `next`.
  - **Testes:** teste unitário (falha com a implementação antiga) e E2E com no máximo
    2 pedidos a `/goals` após o 401.
  - O teste E2E de sessão expirada passou a usar um destino fora da cache. Dados
    frescos em cache são mostrados sem pedido, e a expiração é detetada no pedido
    seguinte.

### D45 — Palavra-passe e verificação de e-mail (recomendação; fluxos não alterados)
- **Data:** 2026-10-13 · **Estado:** decidido e implementado na Fase 5B (D47, D48)
- **Hoje:** 8–128 caracteres, sem regras de composição, sem lista de bloqueio e sem
  verificação de e-mail. A palavra-passe é o único fator.
- **NIST SP 800-63B-4, §3.1.1.2** ([pages.nist.gov/800-63-4/sp800-63b.html](https://pages.nist.gov/800-63-4/sp800-63b.html)):
  - quando a palavra-passe é fator único, o mínimo é **15** (8 só quando faz parte
    de MFA);
  - deve aceitar pelo menos 64 caracteres;
  - **não pode** impor regras de composição nem troca periódica;
  - **tem de** comparar a palavra-passe inteira com uma lista de palavras-passe
    comuns ou comprometidas;
  - cada code point Unicode conta como um caractere, e recomenda NFC;
  - tem de limitar as tentativas falhadas.
- **OWASP ASVS 5.0 (6.2.1):** mínimo 8, com 15 "fortemente recomendado". Há uma
  discussão aberta para alinhar com o NIST.
- **Recomendação para a palavra-passe:**
  1. Mínimo **15** para palavras-passe novas (registo, redefinição e alteração),
     máximo 128, sem regras de composição. Contas existentes só são afetadas na
     próxima alteração.
  2. Lista de bloqueio com o plugin oficial `haveIBeenPwned` do Better Auth
     ([docs](https://www.better-auth.com/docs/plugins/have-i-been-pwned)):
     - envia só os 5 primeiros caracteres do SHA-1 (k-anonymity);
     - devolve `PASSWORD_COMPROMISED`;
     - desligado em testes;
     - por decidir: o que fazer se o serviço externo falhar (recusar ou aceitar).
  3. Manter o rate limiting atual (5 tentativas por minuto e por IP).
- **Recomendação para o e-mail:**
  - antes de abrir registos públicos, ativar `emailVerification` com
    `requireEmailVerification: true` (o login só depois de verificar);
  - impede contas com e-mails de terceiros e mantém a recuperação fiável;
  - exige envio real (ver `deployment.md`).
  - O NIST não considera o e-mail um fator de autenticação (§3.1.3.1), e esta
    verificação também não o é: confirma apenas a posse do endereço.

### D46 — Hospedagem e cabeçalhos de segurança (proposta)
- **Data:** 2026-10-13 · **Estado:** código implementado na Fase 5B (D49–D51); infraestrutura por criar
- **Plano completo:** [deployment.md](deployment.md).
  - Uma origem, `runflow.brotherson.dev`: Render Web Service (Express serve a API e
    o build da web), Neon Free em Frankfurt e Resend Free via API HTTPS.
  - DNS Cloudflare com CNAME "DNS only".
- **Cabeçalhos:**
  - a fonte única é `packages/shared/src/security-headers.ts` (movida na Fase 5B), com CSP sem `unsafe-inline`,
    `frame-ancestors 'none'`, `nosniff`, `no-referrer`, COOP/CORP e HSTS só em HTTPS;
  - já aplicados pelo `vite preview`, por isso os E2E correm sob esta CSP;
  - o teste da demo confirma o cabeçalho e, como qualquer violação é erro na
    consola, falharia.

## Código de produção (Fase 5B)

### D47 — Verificação de e-mail obrigatória
- **Data:** 2026-10-13 · **Estado:** aceite (concretiza a recomendação de D45)
- **Configuração:**
  - `requireEmailVerification: true`;
  - envio no registo, sem reenvio automático no login;
  - sem login automático após a confirmação;
  - validade do link: 24 h.
- **Link:**
  - aponta para a página da web `/confirmar-email?token=…` (origem `APP_URL`), não
    para a API;
  - a página lê o token uma vez (`URLSearchParams` com formato JWT), retira-o do
    endereço e só o usa **depois de um clique**, para que leitores automáticos de
    links não confirmem contas.
- **Sem enumeração:**
  - o registo devolve a mesma resposta para e-mails novos e existentes, e a web
    mostra sempre a mesma página;
  - `EMAIL_NOT_VERIFIED` só aparece com a palavra-passe correta;
  - o reenvio (`/send-verification-email`) responde sempre `{status:true}` (o Better
    Auth impõe um mínimo de 500 ms) e só envia a contas por confirmar.
- **Envio em segundo plano, sem lançar erros:** no reenvio, o Better Auth espera pela
  função de envio. Uma falha do transporte devolveria erro só a contas existentes; em
  segundo plano, a falha fica no log, sem link nem token.
- **Rate limiting por IP:** reenvio 3 em 15 min; confirmação 10 por minuto.
- **Testado:**
  - fluxo completo e login bloqueado;
  - token inválido, adulterado, de outro segredo e expirado (relógio avançado 24 h);
  - reenvio neutro e rate limiting;
  - falha do transporte.
- **Contas existentes:** ficam por confirmar e têm de pedir um novo link. Só existem
  contas locais e fictícias, por isso não há migration de dados.

### D48 — Palavra-passe 15–128 e HIBP (falha fechada)
- **Data:** 2026-10-13 · **Estado:** aceite (concretiza D45)
- **Comprimento e composição:**
  - `LIMITS.passwordLength = { min: 15, max: 128 }`, sem regras de composição;
  - o login não valida o mínimo (o Better Auth só valida o máximo), por isso contas
    antigas com 8–14 caracteres continuam a entrar (testado).
- **Contagem de caracteres:**
  - o Better Auth conta unidades UTF-16; a web conta o mínimo em code points
    (NIST) e o máximo em UTF-16, para nunca aceitar o que o servidor recusa;
  - um emoji conta 1 para o mínimo da web e 2 para o servidor, por isso o servidor
    é, no máximo, mais permissivo.
- **HIBP:**
  - função oficial `isPasswordCompromised` do plugin `haveIBeenPwned` do Better Auth
    (k-anonymity, padding);
  - chamada num `hooks.before` para `/sign-up/email`, `/reset-password` e
    `/change-password`, **antes de qualquer efeito**.
- **Porque não o wrapper de hash do plugin:**
  - em `/reset-password`, o Better Auth consome o token **antes** de calcular o
    hash, por isso uma falha do HIBP perderia o link de recuperação;
  - o pedido do plugin não tem timeout.
- **Respostas:**

  | Situação | Resposta |
  | --- | --- |
  | Palavra-passe comprometida | 400 `PASSWORD_COMPROMISED` |
  | HIBP indisponível (erro, rede ou mais de 5 s) | 503 `PASSWORD_CHECK_UNAVAILABLE`, "tente novamente" |

  - Nenhuma conta é criada e nenhum token é consumido.
  - Fora dos limites de tamanho não há consulta.
  - O login nunca consulta o HIBP.
  - `PASSWORD_BREACH_CHECK=off` só é aceite fora de produção.
- **Testes sem rede:**
  - `apps/api/test/support/fake-network.ts` substitui `fetch` nos testes de base de
    dados e na API dos E2E (`node --import`);
  - simula o HIBP e **bloqueia qualquer host externo**.
- **Testado:**
  - limites 14/15/128/129;
  - comprometida no registo, incluindo e-mail existente (neutro);
  - indisponível, erro de rede e timeout;
  - login sem consulta;
  - reset com falha e com palavra-passe comprometida, mantendo o token válido.
    Mutação: sem o reset no hook, o teste falha;
  - troca de palavra-passe.
- **Ruído nos logs:** o Better Auth regista estes erros de hook como `ERROR`, só com a
  mensagem (sem palavra-passe, token ou chave).
- **Web:** ainda não há formulário de troca de palavra-passe. A API suporta-a e está
  testada.

### D49 — Express serve a web e a API na mesma origem
- **Data:** 2026-10-13 · **Estado:** aceite
- **Pasta do build:**
  - `WEB_DIST_DIR` tem de ser absoluta;
  - por omissão, em produção, é `apps/web/dist`, calculado a partir do código
    (`import.meta.url`);
  - é validada no arranque (existe e tem `index.html`), antes de abrir ligações.
- **Comportamento:**
  - `express.static`: sem `index`, sem redirecionamentos, dotfiles ignorados;
  - fallback SPA só em GET/HEAD de páginas;
  - nunca em `/api` (qualquer capitalização) nem em caminhos com extensão.
- **Cabeçalhos:** os de `@runflow/shared/security-headers` em todas as respostas;
  HSTS e `upgrade-insecure-requests` só com `APP_URL` em HTTPS; `/api` com
  `no-store`.
- **Testado (unitário):** rotas diretas, assets, 404 de assets e de `/api`, métodos
  não GET, path traversal (`..`, `%2e%2e`) e dotfiles.
- **E2E:** passam a correr contra o Express (o `vite preview` deixou de ser usado nos
  E2E).
- **Ensaio de produção:** o servidor compilado foi arrancado a partir de outra pasta
  com `NODE_ENV=production`.

### D50 — Transporte de e-mail Resend
- **Data:** 2026-10-13 · **Estado:** aceite (código); envio real **nunca** feito
- **Pedido:**
  - `ResendMailer`: `POST https://api.resend.com/emails` com Bearer, JSON,
    `Idempotency-Key` por mensagem, timeout de 10 s e `redirect: "error"`;
  - sem retries automáticos (um timeout após a aceitação duplicaria o e-mail);
  - o corpo da resposta é descartado.
- **Erros (`MailDeliveryError`):** só o estado HTTP, "tempo esgotado" ou "erro de
  rede"; nunca a chave, o corpo, o destinatário completo nem o link.
- **Configuração:**
  - `MAIL_TRANSPORT=resend` exige `RESEND_API_KEY` (`re_…`) e `MAIL_FROM`, sem
    quebras de linha;
  - produção recusa `local`.
- **Testado:** com `fetch` simulado (cabeçalhos, corpo, chaves distintas, 401, 429,
  500, rede e timeout), sem qualquer pedido real.

### D51 — Publicação: build, start, migrations e rollback
- **Data:** 2026-10-13 · **Estado:** aceite (comandos); infraestrutura por criar
- **Migrations:**
  - num passo explícito **antes** do deploy (`npm run db:migrate:deploy`, compilado
    em `dist/cli/migrate.js`), nunca no arranque;
  - não se assume pre-deploy no plano gratuito.
- **`db:migrations:status`:** lista as migrations aplicadas, pendentes e alteradas
  (hash) e as desconhecidas na base. Sai com 1 se algo não bater certo.
- **Rollback:**
  - aplicação: deploy anterior, com migrations expand → contract;
  - migration com erro: corrigir para a frente;
  - último recurso: restauro do Neon, com perda de escritas.
- Detalhes em [deployment.md](deployment.md).
- **`TRUST_PROXY=1`:** proposta, **não validada** no host real.

## Publicação sem e-mail (Fase 5C)

### D52 — Projeto demonstrativo sem e-mail
- **Data:** 2026-10-15 · **Estado:** aceite (mudança de escopo autorizada; substitui
  D47 e D50 e a parte de redefinição de D44 e D48)
- **Contexto:** a publicação usa só Vercel Hobby e Neon Free, sem Resend, domínio
  próprio nem DNS. Sem envio de e-mail, não há confirmação de endereço nem
  recuperação de palavra-passe.
- **Autenticação:**
  - `requireEmailVerification: false`; o registo continua sem login automático
    (resposta igual para e-mails novos e existentes) e a web entra a seguir;
  - `emailVerified` fica `false` e nunca é marcado artificialmente.
- **Endpoints que dependem de e-mail** (`/send-verification-email`, `/verify-email`,
  `/request-password-reset`, `/reset-password`, `/reset-password/:token`,
  `/change-email`):
  - a API responde **410** `FEATURE_UNAVAILABLE` com o motivo, antes do Better Auth;
  - os mesmos caminhos estão também em `disabledPaths` no Better Auth (defesa em
    profundidade);
  - pedir recuperação não cria tokens.
- **Web:**
  - `/recuperar-acesso`, `/redefinir-senha`, `/verificar-email` e
    `/confirmar-email` mostram "Funcionalidade indisponível", sem formulários;
  - o registo e a Conta avisam que o e-mail não é verificado e que não existe
    recuperação de palavra-passe;
  - o login deixou de ter o link "Esqueceu-se da palavra-passe?".
- **Removido:**
  - o transporte de e-mail (`MailConfig`, `ResendMailer`, `FileMailbox`) e as
    variáveis `MAIL_*` e `RESEND_API_KEY`;
  - a produção já não exige serviço de e-mail;
  - o código anterior está no histórico do Git (até `ecf60c1`) para uma reativação
    futura.
- **Preservado:** hashing, política 15–128 com HIBP (registo e troca), sessões,
  autorização por dono, proteção de origem, rate limiting e cabeçalhos.
- **Consequência:** sem a regra de 15 min da recuperação, a maior janela de rate
  limiting passou a ser 60 s (D43 continua a exigir retenção maior).

### Migration 0001 (`auth_time_zone_rate_limit`)
- Gerada pelo drizzle-kit e revista à mão **antes** da primeira aplicação. A
  coluna `time_zone NOT NULL` é criada com default temporário `'UTC'` (para
  utilizadores existentes), que é removido logo a seguir; o estado final coincide
  com o snapshot.
- Testado: aplicar a 0000, criar um utilizador e aplicar a 0001 dá `UTC` a esse
  utilizador. A 0000 já aplicada não foi alterada (hash igual ao registado).

### Migration 0002 (`api_rate_limit`)
- Gerada pelo drizzle-kit, sem edição manual: cria só a tabela `api_rate_limit`
  (justificação em D31). A 0000 e a 0001 não foram alteradas.

## Pendentes

| Tema | Estado |
|---|---|
| Hospedagem | código pronto (D49–D51); por criar: Render, Neon e Resend; por decidir: Render Free ou `0.5c-512mb` (7 USD/mês) |
| Domínio `runflow.brotherson.dev` | não usado nesta entrega; URL final https://runflow-eta.vercel.app |
| Envio de e-mail, verificação e recuperação | **fora do escopo** (D52); reativação possível a partir do histórico |
| `TRUST_PROXY=1` | **por validar no host real** (`deployment.md`) |
| Execução das migrations | decidido: passo explícito antes do deploy, sem pre-deploy (D51) |
| Verificação de e-mail | desativada (D52) |
| Política de palavra-passe (15–128, HIBP) | **feito** (D48) |
| Formulário web de troca de palavra-passe | pendente (API pronta e testada, D48) |
| Erros de hook do Better Auth registados como `ERROR` | aceite; ruído nos logs, sem dados sensíveis (D48) |
| Duração de sessão (7 dias + renovação diária, provisório) | pendente |
| Rate limiting de `/api/v1/me` e `/health` | pendente (`/api/v1/workouts` já tem, D31) |
| Limpeza periódica de rate limiting | **feito** (D43) |
| Code splitting e CSP/headers | **feito** (D41, D46, D49) |
| Demo sem Zod (import de `pace` sem o barrel) | melhoria opcional (D41) |
| Normalização Unicode (NFC) de nomes, títulos, notas e palavras-passe | pendente |
| Período padrão do dashboard | aceite na web: "Este mês" (predefinições 7 e 30 dias, mês, ano) |
| RLS no PostgreSQL como reforço | pendente |
| Eliminação de conta e exportação de dados (RGPD) | pendente (cascade já definido, D17) |
| Publicação do repositório e execução remota do CI (jobs `check`, `database` e `e2e`) | pendente |
