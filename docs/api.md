# API do RunFlow V2

Base: `/api/v1`, mesma origem da aplicação (em desenvolvimento, `http://localhost:5173`
via proxy do Vite). Autenticação por cookie de sessão do Better Auth (ver README,
secção "Autenticação"). Todas as respostas JSON; erros em `application/problem+json`.

## Convenções

| Tema | Regra |
|---|---|
| Sessão | Todas as rotas de treinos, objetivos e dashboard exigem sessão válida; sem ela, **401** `UNAUTHENTICATED`. |
| Dono | O utilizador vem **só** da sessão. `userId`/`id` no corpo ou na query são rejeitados (400). |
| Escritas | `POST`, `PATCH` e `DELETE` exigem `Origin` igual a `APP_URL` (senão **403** `FORBIDDEN_ORIGIN`) e, com corpo, `Content-Type: application/json` (senão **415**). |
| Unidades | `distanceM` em metros inteiros; `durationS` em segundos inteiros. |
| Datas | `performedOn` é uma data civil `YYYY-MM-DD` (sem hora/fuso), nunca posterior a "hoje" no fuso do utilizador (`timeZone` da conta). `createdAt`/`updatedAt` são instantes ISO 8601 em UTC. |
| Identificadores | UUID canónico em minúsculas. Formato inválido → **400** `INVALID_ID`. |
| Inexistente ou alheio | Recurso (treino ou objetivo) que não existe **ou** pertence a outro utilizador → o mesmo **404** `NOT_FOUND`. |
| Limites | Corpo JSON ≤ 16 kB (413). Rate limiting por IP (ver abaixo). |

### Formato de erro (RFC 9457)

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "code": "VALIDATION_ERROR",
  "detail": "Um ou mais campos são inválidos.",
  "errors": [{ "field": "performedOn", "code": "date_in_future", "message": "A data do treino não pode ser posterior a hoje (no seu fuso horário)." }],
  "requestId": "5387a923-cbca-4319-9e4a-813852bac09d"
}
```

- `code` é o identificador estável para clientes; `errors` só existe em validações.
- Os erros indicam o **campo** e um código, nunca o valor recebido. Sem stack, caminhos ou SQL.

| `code` | Estado | Quando |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Corpo/query inválidos, campos desconhecidos, PATCH vazio, `from > to`, data de treino futura (`errors[].code = "date_in_future"`), data-alvo passada (`"date_in_past"`) |
| `INVALID_JSON` | 400 | Corpo que não é JSON (objeto/array) válido |
| `INVALID_ID` | 400 | `:id` não é um UUID canónico |
| `INVALID_CURSOR` | 400 | Cursor malformado, de outra versão ou de outros filtros |
| `UNAUTHENTICATED` | 401 | Sem sessão válida |
| `FORBIDDEN_ORIGIN` | 403 | Escrita sem `Origin`, com origem não autorizada ou `Sec-Fetch-Site: cross-site` |
| `NOT_FOUND` | 404 | Treino inexistente ou de outro utilizador |
| `METHOD_NOT_ALLOWED` | 405 | Método não suportado (com cabeçalho `Allow`) |
| `ACTIVE_GOAL_EXISTS` | 409 | Criar um objetivo quando já existe um ativo |
| `GOAL_NOT_ACTIVE` | 409 | Editar, concluir ou substituir um objetivo que não está ativo |
| `PAYLOAD_TOO_LARGE` | 413 | Corpo acima de 16 kB |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Escrita com corpo que não é `application/json` |
| `RATE_LIMITED` | 429 | Limite excedido (com `Retry-After`) |

## Treinos

Objeto `Workout`:

```json
{
  "id": "fee07345-82c9-41e6-9c9f-05560422d5bb",
  "performedOn": "2026-10-10",
  "distanceM": 10000,
  "durationS": 3000,
  "notes": "Rodagem no rio",
  "createdAt": "2026-10-12T15:34:20.553Z",
  "updatedAt": "2026-10-12T15:34:20.553Z"
}
```

Campos de entrada: `performedOn` (obrigatório), `distanceM` (1–1 000 000), `durationS`
(1–172 800), `notes` (opcional, ≤ 1000 caracteres Unicode; trim; vazio → `null`). Texto
é guardado tal como enviado (HTML incluído, literalmente); o escape é responsabilidade
de quem apresenta os dados.

### `POST /api/v1/workouts` → 201

```http
POST /api/v1/workouts
Origin: http://localhost:5173
Content-Type: application/json
Cookie: runflow.session_token=<redigido>

{"performedOn":"2026-10-10","distanceM":10000,"durationS":3000,"notes":"Rodagem no rio"}
```

```http
HTTP/1.1 201 Created
Location: /api/v1/workouts/fee07345-82c9-41e6-9c9f-05560422d5bb
Content-Type: application/json; charset=utf-8

{"id":"fee07345-82c9-41e6-9c9f-05560422d5bb","performedOn":"2026-10-10","distanceM":10000,"durationS":3000,"notes":"Rodagem no rio","createdAt":"2026-10-12T15:34:20.553Z","updatedAt":"2026-10-12T15:34:20.553Z"}
```

Dois treinos com os mesmos valores são permitidos (a prevenção de duplo envio fica na interface).

### `GET /api/v1/workouts` → 200

Query (todos opcionais; outros parâmetros → 400):

| Parâmetro | Regra |
|---|---|
| `from`, `to` | Datas `YYYY-MM-DD`, **inclusivas**. `from > to` → 400. |
| `limit` | 1–100; por omissão 20. |
| `cursor` | Valor de `nextCursor` da página anterior, com os **mesmos** `from`/`to`. |

Ordem: `performedOn` DESC, `createdAt` DESC, `id` DESC (estável, com desempate).

```json
{
  "items": [{ "id": "fee07345-…", "performedOn": "2026-10-10", "distanceM": 10000, "durationS": 3000, "notes": "Rodagem no rio", "createdAt": "…", "updatedAt": "…" }],
  "nextCursor": "eyJ2IjoxLCJwIjoiMjAyNi0xMC0xMCIsImMiOiIyMDI2LTEwLTEyVDE1OjM0OjIwLjU1MzM0N1oiLCJpIjoiZmVlMDczNDUtODJjOS00MWU2LTljOWYtMDU1NjA0MjJkNWJiIiwiZiI6bnVsbCwidCI6bnVsbH0"
}
```

`nextCursor` é `null` na última página.

**Cursor (keyset):**

- Opaco para o cliente. Codifica só a posição do último item (`performedOn`, `createdAt`
  com microssegundos, `id`) e os filtros `from`/`to`; não contém o utilizador.
- **Filtros alterados:** um cursor só é aceite com os mesmos `from`/`to` com que foi
  emitido; caso contrário, 400 `INVALID_CURSOR` e o cliente recomeça na primeira página.
  Mudar só o `limit` entre páginas é permitido.
- **Nunca concede acesso:** a consulta filtra sempre pelo utilizador da sessão. Um cursor
  de outra pessoa (ou forjado) apenas posiciona a leitura nos dados do próprio utilizador.
- **Dados que mudam durante a navegação:** cada página continua a partir da posição do
  último item. Um treino novo que fique **antes** dessa posição na ordenação (por exemplo,
  com data mais recente) só aparece ao recomeçar; um que fique **depois** (data mais
  antiga) aparece numa página seguinte. Um treino editado pode mudar de posição pelo mesmo
  motivo. Treinos apagados deixam de aparecer. Itens já devolvidos não se repetem, salvo
  se forem editados para uma data mais antiga (passam para depois do cursor). Num conjunto estável não há
  duplicações nem omissões (testado).

### `GET /api/v1/workouts/:id` → 200

Devolve **200** com o `Workout`. 404 se não existir ou for de outro utilizador.

### `PATCH /api/v1/workouts/:id` → 200

Corpo com **pelo menos um** de `performedOn`, `distanceM`, `durationS`, `notes`
(`notes: null` limpa). O resultado final (treino atual + alterações) é validado com as
mesmas regras da criação. A regra de data futura é aplicada quando `performedOn` é
enviado (editar outros campos de um treino de "hoje" continua possível se o utilizador
mudar para um fuso mais atrasado). Devolve **200** com o `Workout` atualizado.

```http
PATCH /api/v1/workouts/fee07345-82c9-41e6-9c9f-05560422d5bb
Origin: http://localhost:5173
Content-Type: application/json

{"durationS":2950,"notes":null}
```

```json
{"id":"fee07345-82c9-41e6-9c9f-05560422d5bb","performedOn":"2026-10-10","distanceM":10000,"durationS":2950,"notes":null,"createdAt":"2026-10-12T15:34:20.553Z","updatedAt":"2026-10-12T15:34:21.379Z"}
```

### `DELETE /api/v1/workouts/:id` → 204

Devolve **204** sem corpo. 404 se não existir ou for de outro utilizador.

## Objetivos

Cada utilizador tem **no máximo um** objetivo `active` (índice único parcial na base,
também sob concorrência). Objeto `Goal`:

```json
{
  "id": "…", "title": "Meia maratona", "targetDistanceM": 21097, "targetDate": "2026-12-06",
  "status": "active", "createdAt": "…", "updatedAt": "…", "completedAt": null, "replacedAt": null
}
```

`status`: `active` | `completed` | `replaced`. `targetDistanceM` é a distância de **uma**
corrida (sem progresso automático). `targetDate` é opcional (`null`).

| Rota | Sucesso | Erros específicos |
|---|---|---|
| `GET /api/v1/goals/active` | 200 `{"goal": Goal | null}` | — |
| `POST /api/v1/goals` `{title, targetDistanceM, targetDate?}` | 201 `Goal` + `Location` | 409 `ACTIVE_GOAL_EXISTS` |
| `PATCH /api/v1/goals/:id` (≥ 1 de `title`, `targetDistanceM`, `targetDate`; `targetDate: null` remove) | 200 `Goal` | 404, 409 `GOAL_NOT_ACTIVE` |
| `POST /api/v1/goals/:id/complete` (sem corpo ou `{}`) | 200 `Goal` (`completed`, `completedAt`) | 404, 409 `GOAL_NOT_ACTIVE` |
| `POST /api/v1/goals/:id/replace` `{title, targetDistanceM, targetDate?}` | 201 `{"previous": Goal, "current": Goal}` + `Location` | 404, 409 `GOAL_NOT_ACTIVE` |

- **Data-alvo:** ao criar, ao substituir ou quando `targetDate` é enviada num PATCH, não
  pode ser anterior a hoje no fuso da conta (400, `errors[].code = "date_in_past"`).
  Objetivos vencidos continuam editáveis nos outros campos e podem ser concluídos ou
  substituídos.
- **Substituição:** numa transação — o atual passa a `replaced` (`replacedAt`) e o novo
  é criado `active`. Se a criação falhar, nada muda (o anterior continua `active`).
- **Ordem das verificações:** dono → estado → regras da data. Para outro utilizador, o
  objetivo é sempre 404, mesmo que esteja concluído ou que o pedido traga dados inválidos.

## Dashboard

### `GET /api/v1/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD` → 200

`from` e `to` são **obrigatórios** e **inclusivos** (`from > to` → 400). Outros
parâmetros → 400.

```json
{
  "period": { "from": "2026-10-01", "to": "2026-10-31", "timeZone": "Europe/Lisbon" },
  "activeGoal": null,
  "totals": { "workoutCount": 2, "distanceM": 15000, "durationS": 5100, "paceSPerKm": 340 }
}
```

- Calculado na leitura (sem totais guardados), só com os treinos do utilizador da
  sessão: reflete de imediato criações, edições e eliminações.
- `paceSPerKm = round(durationS × 1000 / distanceM)` (média ponderada, arredondamento
  meio para cima); sem treinos: totais `0` e `paceSPerKm: null`.
- `count`/`sum` são `bigint` no PostgreSQL, devolvidos como texto e convertidos sem
  passar por vírgula flutuante; o ritmo é calculado com aritmética inteira exata
  (BigInt). Um total acima de 2^53 − 1 dá erro explícito em vez de arredondar.
- `activeGoal` é o objetivo ativo atual (independente do período) ou `null`.

## Rate limiting

| Âmbito | Chave | Limite por omissão | Cabeçalho em 429 |
|---|---|---|---|
| Treinos, objetivos e dashboard — leituras (GET/HEAD) | IP do cliente, por recurso | 120 / 60 s | `Retry-After` (segundos) |
| Treinos e objetivos — escritas | IP do cliente, por recurso | 30 / 60 s | `Retry-After` (segundos) |
| `/api/auth/*` (Better Auth) | IP + rota | ver decisions.md D21 | `X-Retry-After` (biblioteca) **e** `Retry-After` (acrescentado pela API) |

- Configurável por `API_RATE_LIMIT_WINDOW_S`, `API_RATE_LIMIT_READ_MAX` e
  `API_RATE_LIMIT_WRITE_MAX`. Janela fixa, guardada em PostgreSQL (`api_rate_limit`),
  atómica e persistente entre reinícios.
- O IP é `req.ip` do Express com `TRUST_PROXY` (por omissão, o endereço da ligação;
  X-Forwarded-For enviado pelo cliente é ignorado).
- O rate limiting corre antes da verificação de origem e de sessão.
- Os registos de janelas expiradas são apagados periodicamente (24 h de retenção, em
  lotes limitados). Não muda o comportamento: uma janela terminada recomeça em 1 de
  qualquer forma (D43).
- **Contrato do 429:** os clientes devem ler `Retry-After`; o `X-Retry-After` do Better
  Auth mantém-se por compatibilidade.

## Outras rotas

| Rota | Descrição |
|---|---|
| `GET /api/v1/health` | Disponibilidade do processo: `{"status":"ok"}` |
| `GET /api/v1/me` | Utilizador da sessão: `{id, name, email, timeZone}` |
| `/api/auth/*` | Better Auth (registo, login, logout); confirmação e recuperação → 410 `FEATURE_UNAVAILABLE` (D52) — ver README |
