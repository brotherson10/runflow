# Publicação

## Estado atual: Vercel Hobby + Neon Free (2026-10-15)

Publicado em <https://runflow-eta.vercel.app>, sem e-mail nem domínio próprio (D52).
A Render, mais abaixo, fica só como referência.

- **Vercel:**
  - projeto `runflow` na equipa B10 (plano hobby);
  - função em `fra1`, Node 24, `maxDuration` 30 s;
  - web servida pela CDN (`routes` do `vercel.json`); `/api` vai para uma única
    função Express (`api/index.mjs` → `apps/api/dist/vercel.js`).
- **Neon Free** (Vercel Marketplace, plano `free_v3`), recurso `runflow-db`:
  - região `aws-eu-central-1` (Frankfurt);
  - a aplicação usa `DATABASE_URL` (pooler); as migrations usam
    `DATABASE_URL_UNPOOLED` (direto);
  - TLS: o `pg` 8 trata `sslmode=require` como `verify-full` (certificado
    verificado); o aviso de mudança futura aparece nos logs.
- **Migrations:** aplicadas num passo explícito (`src/cli/migrate.ts` com o URL
  direto), sem seeds nem testes. `migration-status` mostra 0000–0002 "aplicada".
- **Variáveis (produção, encriptadas):**
  - `APP_URL=https://runflow-eta.vercel.app`, `BETTER_AUTH_SECRET`, `CRON_SECRET`,
    `TRUST_PROXY=1`;
  - as do Neon, definidas pela integração;
  - nenhuma variável de e-mail.
- **Cron diário:** `/api/internal/cron/purge-rate-limits`, autenticado com
  `CRON_SECRET` (401 sem ele), em lotes limitados e idempotente.
- **Verificado em produção (2026-10-15):**
  - registo, login sem confirmação e `/me`;
  - cookie `__Secure-runflow.session_token` com `Secure`, `HttpOnly` e
    `SameSite=Lax`;
  - treinos: criar, editar, listar e eliminar, com o dashboard atualizado;
  - objetivos: criar, impedir um segundo ativo (409), concluir e substituir;
  - isolamento entre duas contas (404 e listas vazias);
  - origem: escritas sem `Origin` ou com outra origem dão 403;
  - recuperação e confirmação dão 410, sem pedidos a serviços de e-mail;
  - logout invalida a sessão;
  - demo sem pedidos à API; registo pela interface sem erros na consola.
- **IP e proxy:**
  - cabeçalhos `X-Forwarded-For`, `X-Real-IP`, `X-Vercel-Forwarded-For` e
    `X-Runflow-Client-Ip` forjados não contornam o rate limiting (429 ao 4.º-5.º
    pedido);
  - a chave gravada na base é o IP público real do cliente, nunca um IP interno da
    Vercel nem um forjado.

### Comandos

- **Deploy:** `vercel deploy --prod`. O repositório não está ligado à Vercel por Git;
  o deploy é feito pela CLI a partir do HEAD.
- **Migrations:** `DATABASE_URL=<DATABASE_URL_UNPOOLED> npm run db:migrate`, depois
  `npm run db:migrations:status`, antes do deploy.

## Plano original (Render, preterido)

Estado: **código de produção pronto (Fase 5B); infraestrutura por criar**. Nenhuma
conta, serviço, registo DNS ou envio real de e-mail foi criado. Preços e limites
lidos nas páginas oficiais em **2026-10-13**; confirmar de novo no dia da publicação.

### Topologia: uma origem

```
https://runflow.brotherson.dev
        │  (Cloudflare DNS, registo CNAME "DNS only")
        ▼
Render — Web Service Node 24 (Frankfurt)
  Express 5 ─┬─ /api/auth/*  Better Auth
             ├─ /api/v1/*    API de domínio
             └─ /*           build da web (apps/web/dist) + fallback SPA
        │ TLS (sslmode=verify-full)
        ▼
Neon — PostgreSQL (AWS eu-central-1, Frankfurt)

Resend (API HTTPS) ── e-mails de recuperação, a partir de runflow.brotherson.dev
```

Porquê uma origem: os cookies de sessão ficam host-only, `Secure` e `SameSite=Lax`,
sem CORS, e a proteção de origem (D30) e a CSP `connect-src 'self'` funcionam sem
exceções. O Express é um processo contínuo, por isso a limpeza periódica de rate
limiting (D43) corre dentro dele.

**Porquê não Vercel** (proposta anterior): o Express passaria a funções serverless,
sem processo contínuo para o agendador e com um pool `pg` por instância. A Render
corre um processo Node contínuo, como o servidor usado localmente e nos E2E.

### Limites e custos (páginas oficiais, 2026-10-13)

| Serviço | Plano | Custo | Limites relevantes |
| --- | --- | --- | --- |
| Render Web Service | Free | 0 € | Adormece após 15 min sem tráfego (~1 min a acordar); 750 h/mês por workspace; sistema de ficheiros efémero; **SMTP de saída bloqueado (25/465/587)** |
| Render Web Service | `0.5c-512mb` (antigo "Starter") | 7 USD/mês | Sempre ligado; 0,5 CPU, 512 MB |
| Neon | Free | 0 € | 100 CU-h/mês por projeto; 1 GB por projeto; suspende após 5 min inativo; histórico de restauro de 6 h (até 1 GB); 5 GB de egress |
| Neon | Launch | por uso, sem mínimo | 0,106 USD/CU-h; 0,35 USD/GB-mês; restauro até 7 dias |
| Resend | Free | 0 € | 3 000 e-mails/mês, **100/dia**; 3 domínios; logs 30 dias |
| Resend | Pro | 20 USD/mês | 50 000 e-mails/mês |
| Cloudflare DNS | já em uso para brotherson.dev | 0 € | — |

Recomendação para portefólio: **Render `0.5c-512mb` (7 USD/mês) + Neon Free + Resend
Free**. Com Render Free, a primeira visita após 15 min demora cerca de um minuto; é
aceitável para uma demo, mas não para uma app "real". O bloqueio de SMTP não afeta
o plano, porque o envio é pela API HTTPS da Resend.

Fontes: [render.com/docs/free](https://render.com/docs/free),
[render.com/pricing](https://render.com/pricing),
[render.com/docs/compute-plans](https://render.com/docs/compute-plans),
[neon.com/pricing](https://neon.com/pricing),
[resend.com/pricing](https://resend.com/pricing).

### DNS (Cloudflare — por fazer, não feito)

O DNS de brotherson.dev está na Cloudflare (NS `ajay`/`brenna.ns.cloudflare.com`,
verificado com `nslookup`). O apex atual não muda.

| Registo | Tipo | Valor | Proxy |
| --- | --- | --- | --- |
| `runflow` | CNAME | `<serviço>.onrender.com` | **DNS only** (nuvem cinzenta) |
| SPF / DKIM / MX de retorno da Resend | TXT / MX | valores dados pela Resend ao adicionar `runflow.brotherson.dev` | DNS only |

- **"DNS only"**: a Render emite e renova o certificado, e há um único proxy à frente
  do Express, o que torna `TRUST_PROXY=1` correto. Com o proxy laranja da Cloudflare
  haveria mais um salto, e seria preciso rever `TRUST_PROXY` e o modo SSL.
- **DMARC**: verificar se brotherson.dev já tem `_dmarc`; se não tiver, começar com
  `p=none` e um endereço de relatórios.

### Variáveis de ambiente (produção)

`readServerConfig` recusa arrancar em produção sem: segredo, `APP_URL` em HTTPS,
`MAIL_TRANSPORT=resend` com chave e remetente válidos, HIBP ligado e o build da web
(com `index.html`). As mensagens de erro nunca incluem valores de segredos.

| Variável | Valor | Notas |
| --- | --- | --- |
| `NODE_ENV` | `production` | Cookies `Secure`; exige tudo o que está nesta tabela |
| `PORT` | definida pela Render | Lida por `readConfig` |
| `APP_URL` | `https://runflow.brotherson.dev` | Origem única confiável, base dos links dos e-mails; ativa HSTS |
| `DATABASE_URL` | URL **pooled** do Neon com `sslmode=verify-full` | Segredo |
| `BETTER_AUTH_SECRET` | 32+ bytes aleatórios (`openssl rand -base64 48`) | Segredo; trocá-lo termina todas as sessões e invalida links de confirmação |
| `TRUST_PROXY` | `1` (proposta) | **Pendente de validação no host real** (ver abaixo) |
| `MAIL_TRANSPORT` | `resend` | Obrigatório em produção |
| `RESEND_API_KEY` | `re_…`, permissão só de envio, limitada ao domínio | Segredo |
| `MAIL_FROM` | `RunFlow <nao-responder@runflow.brotherson.dev>` | Domínio verificado na Resend |
| `PASSWORD_BREACH_CHECK` | `hibp` (omissão) | `off` é recusado em produção |
| `WEB_DIST_DIR` | vazio | Omissão: `apps/web/dist`, calculado a partir do código (não da pasta de arranque); se indicado, tem de ser absoluto |
| `API_RATE_LIMIT_WINDOW_S` / `_READ_MAX` / `_WRITE_MAX` | 60 / 120 / 30 | Iguais aos atuais |
| `RATE_LIMIT_PURGE_INTERVAL_S` | `3600` | `0` se a limpeza passar a cron |
| `NODE_VERSION` | `24.21.0` | Para a Render usar a versão do `.nvmrc` (confirmar no serviço) |

### `TRUST_PROXY=1`: ainda NÃO validado

Funciona localmente, o que **não** prova nada sobre a Render. Antes de abrir o
serviço:

1. com o serviço já no domínio, fazer pedidos de dois IPs conhecidos (ex.: rede
   móvel e fixa);
2. confirmar que o rate limiting conta cada IP em separado e que um
   `X-Forwarded-For` forjado pelo cliente não muda o IP usado (os testes atuais
   cobrem isto localmente, em auth-rate-limit.db.test.ts);
3. se a Render acrescentar mais de um salto, ajustar para o número certo ou para os
   CIDRs dos proxies dela.

Até lá, o valor é uma proposta.

### Comandos de publicação

Nada disto foi executado contra serviços reais. Os comandos foram ensaiados
localmente: build completo, `db:migrate:deploy` e `migrate:status` compilados
numa base de testes, e o servidor compilado arrancado a partir de outra pasta com
`NODE_ENV=production`, a servir a web e a API com HSTS e CSP.

| Passo | Comando | Onde |
| --- | --- | --- |
| Build | `npm ci --include=dev && npm run build` | Render (build command) |
| Start | `npm run start` (`node dist/server.js` em `apps/api`) | Render (start command) |
| Health check | `GET /api/v1/health` | Render |
| Migrations | `npm run db:migrate:deploy` com o URL **direto** do Neon | Passo explícito **antes** do deploy (ver abaixo) |
| Estado das migrations | `npm run db:migrations:status` (código-fonte) ou `npm run migrate:status --workspace @runflow/api` (compilado) | Antes e depois de cada deploy ou rollback |

- `--include=dev`: se `NODE_ENV=production` estiver definido também durante o build,
  o `npm ci` omitiria o TypeScript e o Vite, e o build falharia.
- **O servidor nunca aplica migrations no arranque.**

### Migrations: passo explícito, sem pre-deploy

Não se assume o pre-deploy command, que pode não existir no plano gratuito. A
ordem de cada publicação que inclua migrations é:

1. desligar o auto-deploy do serviço (deploy manual ou por deploy hook);
2. criar um ponto de restauro: um branch do Neon a partir do estado atual;
3. a partir de um checkout do commit a publicar:
   - `npm ci && npm run build`;
   - `DATABASE_URL=<direto> npm run db:migrate:deploy`;
   - `npm run db:migrations:status`, que tem de mostrar tudo "aplicada";
4. disparar o deploy da mesma versão.

**Regra de compatibilidade (expand → contract):** cada migration tem de funcionar
também com a versão anterior da aplicação. Colunas novas entram como opcionais ou
com default, e as remoções ficam para uma publicação seguinte. Isto permite fazer
rollback da aplicação sem mexer na base.

### Rollback

- **Aplicação:** voltar ao deploy anterior (rollback da Render ou redeploy do commit
  anterior). A base não muda; pela regra acima, a versão anterior continua
  compatível. Depois, `db:migrations:status` com o código antigo marca as
  migrations mais recentes como "DESCONHECIDA", o que é esperado.
- **Migration com erro:** corrigir para a frente, com uma nova migration. As
  migrations aplicadas nunca são editadas.
- **Último recurso (dados):** restaurar o branch criado no passo 2, ou usar o
  histórico do Neon (6 h no Free, 7 dias no Launch). **Perde as escritas posteriores.**
  Verificar com `db:migrations:status` antes de voltar a apontar a aplicação.

### Cabeçalhos de segurança

A fonte única é
[`packages/shared/src/security-headers.ts`](../packages/shared/src/security-headers.ts).
O Express aplica-os a **todas** as respostas, da web e da API. Os E2E correm contra o
próprio Express, e o `web.test.ts` cobre HTTP e HTTPS.

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none';
  upgrade-insecure-requests                       (só em HTTPS)
Strict-Transport-Security: max-age=31536000      (só em HTTPS)
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

- **HSTS sem `includeSubDomains` nem `preload`:** cobre só runflow.brotherson.dev. O
  TLD `.dev` já está na lista de preload dos browsers, por isso o HTTPS é obrigatório
  de qualquer forma.
- **Cache:**
  - `/assets/*` (nomes com hash): `public, max-age=31536000, immutable`;
  - páginas e fallback SPA: `no-cache`;
  - `/api/*`: `no-store`.
- **Fallback SPA:** só em `GET`/`HEAD` de páginas. Nunca em `/api`, em qualquer
  capitalização (404 problem+json), nem em caminhos com extensão (um asset
  inexistente dá 404).

### Antes de abrir o serviço (bloqueios)

1. Criar as contas e os recursos: serviço Render, projeto Neon e domínio na Resend.
2. Configurar o DNS na Cloudflare. **Não foi feito.**
3. Validar `TRUST_PROXY` no host real (secção acima).
4. Fazer um primeiro envio real controlado (Resend), para um endereço próprio, e
   verificar SPF, DKIM e DMARC.
5. Decidir o plano da Render: Free adormece após 15 min, `0.5c-512mb` custa
   7 USD/mês.
6. Contas criadas antes da Fase 5B (só existem localmente) ficam por confirmar e
   têm de pedir novo link.
