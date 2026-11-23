# Deploy — Vercel via GitHub Actions

O `apps/web` é publicado na Vercel **exclusivamente pelo pipeline do GitHub**
(`.github/workflows/deploy.yml`), usando a Vercel CLI com token. O projeto na
Vercel fica **sem conexão Git** — a integração Git da Vercel nunca é ligada
(ela força um vínculo de conta GitHub e conflita quando há várias contas GitHub
na mesma máquina/organização).

- `push` na `main` (ou execução manual do workflow) → deploy de **produção**
- `pull_request` → deploy de **preview** (URL no summary da execução)

O workflow roda `vercel deploy` (com `--prod` na produção): o pipeline **envia
o código-fonte e a Vercel compila na nuvem**. Isso é deliberado — o fluxo
alternativo (`vercel build --prebuilt`, compilando no runner) isola o build no
Root Directory (`apps/web`) e quebra os symlinks de workspace para
`../../packages/*` (`Module not found: Can't resolve '@flyee/content'`). O build
da nuvem resolve os pacotes `@flyee/*` nativamente. Continua tudo por token, sem
a integração Git da Vercel.

## O ONE hoje (feito em 2026-10-21)

| O quê | Valor |
| --- | --- |
| Repositório | `github.com/onedeveloperapp/one-platform` (privado; esta máquina faz push por SSH pela conta BrunoSantanaDeveloper, colaboradora do repositório) |
| Conta e time da Vercel | `onedeveloperapp`, time **ONE** (`team_K9MuFpOssa8qLl0aqB92grxu`), plano Hobby |
| Projeto da Vercel | `one-platform` (`prj_aUngzQES91eCBPmPkG7wBtQRmCFz`): Root Directory `apps/web`, arquivos fora dele incluídos, Next.js, Node 22.x, funções em São Paulo (`gru1`), sem conexão Git |
| Endereço de produção | `https://one-platform-two.vercel.app` (o `one-platform.vercel.app` já tinha dono) |
| Secrets do repositório | `VERCEL_TOKEN` (criado no painel da Vercel, escopo ONE), `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |
| Variáveis na Vercel | `NEXT_PUBLIC_SITE_URL` (Production) e `NEXT_PUBLIC_STORAGE_PREFIX=one` (Production e Preview); em Production também as do Supabase, `VAULT_KEYS` e `ANTHROPIC_API_KEY`. `WHATSAPP_SIMULATOR`, `CALENDAR_FAKE` e `PSC_FAKE` estão em Production, onde nunca valem: só agem num preview |

A CLI da Vercel desta máquina continua logada em outra conta. A do ONE fica numa
pasta de configuração própria e é usada assim, da raiz do repositório:

```bash
vercel -Q C:\Users\tribo\.vercel-one whoami
vercel -Q C:\Users\tribo\.vercel-one env ls
```

O `.vercel/project.json` da raiz (ignorado pelo git) aponta para `one-platform`.

**O autor de cada commit é o dono da conta Vercel**: `onedeveloperapp
<onedeveloper.app@gmail.com>`, na configuração do git do próprio repositório
(`git config --local`), como no MedChina (`flayeelab`). No plano Hobby a Vercel
só compila um commit cujo autor é o dono do time; com outro autor o deploy fica
`BLOCKED` (`TEAM_ACCESS_REQUIRED`) e o job do GitHub espera até o limite de 60
minutos. Foi o que aconteceu em 2026-10-21 com commits feitos com o e-mail
global da máquina.
O plano Hobby é para uso pessoal e não comercial nos termos da Vercel: antes de
o ONE atender um escritório, o time passa para o Pro.

## Setup único

### 1. Criar/vincular o projeto na Vercel (local, uma vez)

Na raiz do repositório (o login é na conta **Vercel**, independente das contas
GitHub da máquina):

```bash
npx vercel login
npx vercel link
```

No `link`, escolha o escopo (team/conta) e crie o projeto novo (o do ONE é
`one-platform`, ver acima). Isso gera `.vercel/project.json` (gitignored) com o `orgId` e o
`projectId` — são os valores dos secrets do passo 4. O `.vercel/` herdado da
cópia do MedChina foi apagado em 2026-09-30: ele apontava para o projeto do
MedChina, e um `vercel deploy` daqui publicaria o flyee.club lá.

### 2. Configurar o projeto no dashboard da Vercel

Em **Settings → General**:

- **Root Directory**: `apps/web` (obrigatório — monorepo npm workspaces; a
  Vercel detecta os workspaces e instala a partir da raiz do repo)
- **Include files outside of the Root Directory in the Build Step**: **LIGADO**
  (checkbox logo abaixo do Root Directory). Sem isso, o build da nuvem fica
  confinado a `apps/web` e os pacotes compartilhados (`@flyee/content`,
  `@flyee/design-tokens`, etc., que vivem em `../../packages/*`) não resolvem —
  o build quebra com `Module not found: Can't resolve '@flyee/content'`.
- **Framework Preset**: Next.js.
- **Node.js Version**: 22.x (ou 24.x — o build da nuvem usa a versão do projeto).
- **Build/Install/Output Command (Override)**: deixe os toggles **DESLIGADOS**.
  O `apps/web/vercel.json` (versionado) já define o install e o build — ele tem
  precedência e é a fonte de verdade (ver abaixo). Não duplique no dashboard.

> O deploy é build na nuvem: essa config vale no ato do build. Ligue o checkbox
> no dashboard e reexecute o workflow.

Em **Settings → Git**: **não conectar** nenhum repositório. É isso que evita o
conflito de contas — todo deploy entra pela CLI do pipeline.

#### `apps/web/vercel.json` — duas correções que NÃO podem sumir

```json
{ "installCommand": "cd ../.. && npm ci", "buildCommand": "next build" }
```

1. **`installCommand: "cd ../.. && npm ci"`** — o install padrão da Vercel
   (rodado dentro de `apps/web`) NÃO cria os symlinks de workspace
   `node_modules/@flyee/*`, mesmo com o checkbox de "include files outside"
   ligado. Resultado: `Module not found: Can't resolve '@flyee/content'`
   (compila localmente porque o `node_modules` local já tem os links). Forçar
   `npm ci` na RAIZ do monorepo instala com os workspaces linkados corretamente.
2. Memória do build (ver `apps/web/next.config.mjs`): o container de build (8 GB)
   dava **OOM/SIGKILL** na fase "Linting and checking validity of types". O
   `next.config.mjs` desliga lint+typecheck no `next build`
   (`eslint.ignoreDuringBuilds` + `typescript.ignoreBuildErrors` — ambos já são
   cobertos pelas etapas dedicadas do CI) e limita a paralelização
   (`experimental.cpus: 1` + `webpackMemoryOptimizations`). Se o build voltar a
   dar OOM ao crescer, o passo seguinte é aumentar o build machine (plano Pro).

### 3. Variáveis de ambiente (Settings → Environment Variables)

Cadastre em **Production** (e repita em **Preview** as que quiser testar em
PRs — no mínimo as de Supabase e a licença MUI). Referência completa:
`apps/web/.env.example`.

> **Atenção, ambiente local:** o `apps/web/.env` veio da cópia do MedChina e
> aponta para o Supabase de produção, a chave Asaas, Meta/GA4 e chaves de IA do
> MedChina. O `apps/web/.env.local` criado em 2026-09-30 deixa essas variáveis
> vazias (o Next lê `.env.local` antes de `.env`, e o script de migração remota
> segue a mesma ordem). Ponha os valores dos projetos do flyee.club no
> `.env.local`, ou troque o `.env` e apague o `.env.local`. Nunca rode
> `db:*:remote` antes disso.

Obrigatórias para produção:

| Variável | Observação |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem |
| `DATABASE_URL` | connection string **pooled** (porta 6543) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only (admin, backups, billing público) |
| `NEXT_PUBLIC_MUI_X_LICENSE_KEY` | licença MUI X Premium |
| `NEXT_PUBLIC_SITE_URL` | domínio canônico, sem barra final (sitemap/robots/OG/JSON-LD caem para `http://localhost:3000` sem ela) |

Operação:

| Variável | Observação |
| --- | --- |
| `ASAAS_API_KEY` / `ASAAS_WEBHOOK_TOKEN` / `ASAAS_BASE_URL` | cobrança em BRL (produção: `https://api.asaas.com/v3`) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | cobrança em USD |
| `INNGEST_SIGNING_KEY` | só para a sincronização que avisa o Inngest de que o ONE não tem mais função lá (desde 2026-11-14 o relógio roda no servidor do ONE: "O relógio do ONE", abaixo). O ONE não envia eventos ao Inngest, então `INNGEST_EVENT_KEY` não é usada |
| `RESEND_API_KEY` / `EMAIL_FROM` | e-mails do app (sem elas os avisos ficam só no sino do painel). **Obrigatórias para a lista de espera**: sem o e-mail de confirmação ninguém confirma, e o formulário responde que a lista está fora do ar. Ver "E-mails e jobs" |
| `CONTACT_FORM_TO` | destino do formulário de contato |
| `PUBLIC_FORMS_IP_SALT` | segredo da janela por rede da lista de espera (HMAC do IP). Sem ele não há limite por rede |
| `ANTHROPIC_API_KEY` ou `GEMINI_API_KEY` ou `OPENROUTER_API_KEY` | opcional: provedor do `/admin/insights`, custo do operador |
| `BACKUP_RETENTION_DAYS` | opcional (default 30) |

### 4. Token e secrets do GitHub

1. Vercel → **Account Settings → Tokens** → criar um token com escopo no
   team/conta do projeto.
2. GitHub → repositório → **Settings → Secrets and variables → Actions**:
   - `VERCEL_TOKEN` — o token criado
   - `VERCEL_ORG_ID` — `orgId` do `.vercel/project.json`
   - `VERCEL_PROJECT_ID` — `projectId` do `.vercel/project.json`
   - `ONE_VPS_CLOCK_KEY` — a chave privada de deploy do relógio (ver "O relógio do ONE")
3. Na aba **Variables** do mesmo lugar: `ONE_VPS_SSH` (`one@187.53.106.93`) e
   `ONE_VPS_KNOWN_HOSTS` (a linha `ssh-keyscan -t ed25519 187.53.106.93`,
   conferida com a impressão digital do servidor).

### 5. Domínio

**Settings → Domains** → adicionar o domínio de produção e apontar o DNS.
`NEXT_PUBLIC_SITE_URL` deve ser exatamente esse domínio (com `https://`, sem
barra final).

## O que o deploy NÃO faz

- **Migrações de banco**: o pipeline não toca no Postgres. Quando houver
  migração nova em `packages/db/migrations`, rode antes do merge:
  `npm run db:plan:remote` (dry-run) e `npm run db:gate:remote`
  (aplica + testa) — ver `scripts/remote-db-gate.mjs`.
- **Storage/RLS/seeds**: idem — tudo entra pelas migrações.

## Pós-deploy (primeira vez)

- **O relógio**: ver "O relógio do ONE". O Inngest não tem mais função do ONE;
  o passo "Sync the jobs with Inngest" do workflow só o avisa disso.
- **Webhooks de billing**: apontar Stripe para
  `https://<domínio>/api/webhooks/stripe` e Asaas para
  `https://<domínio>/api/webhooks/asaas`.
- **Supabase Auth**: em Authentication → URL Configuration, definir o Site URL
  para o domínio de produção e adicionar as redirect URLs de auth.
- Smoke test: home pública, `/auth/sign-in`, criar workspace, `/inicio`.

## Primeiro deploy: a lista de espera

O primeiro deploy põe no ar o portão da fase 0 do `docs/PRODUCT.md`: a lista de
espera bilíngue (`/espera` e `/en/waitlist`), com confirmação por e-mail e as
páginas legais lidas de `consent_terms`. O site sobe no estágio **lista de
espera** (`platform_settings.launch`, migração `0019`): todos os botões
principais levam para `/espera`, porque ainda não há nada à venda. Login e
cadastro continuam acessíveis, só não aparecem nos botões.

1. **Banco.** Com o `apps/web/.env.local` apontando para o projeto Supabase novo
   do flyee.club, rode `npm run db:plan:remote` (dry-run) e depois
   `npm run db:gate:remote`, que aplica todas as migrações (`0000`–`0023`) num
   projeto vazio e roda o pgTAP. O gate recusa um banco que ele não construiu.
2. **Variáveis na Vercel**: as obrigatórias acima, mais `RESEND_API_KEY` e
   `EMAIL_FROM` com o domínio verificado no Resend e `PUBLIC_FORMS_IP_SALT`; e
   o relógio no servidor do ONE ("O relógio do ONE"). A varredura diária `purge-leads` apaga em 7
   dias os endereços não confirmados, prazo que a página e o e-mail prometem.
3. **Deploy** pelo workflow, e então o Supabase Auth (Site URL e redirect URLs)
   e o relógio batendo no servidor (o log mostra uma linha `beat` a cada 5 minutos).
4. **Sua conta de operador.** Crie a conta em `/auth/sign-up` e promova-a no SQL
   Editor do Supabase (a sessão do editor não tem JWT, e a trava de
   superadmin permite):

   ```sql
   update public.profiles set is_superadmin = true
   where id = (select id from auth.users where email = 'seu@email');
   ```

5. **Empresa no rodapé.** Em `/admin/support`, preencha "Empresa responsável"
   (razão social, CNPJ, cidade). Os termos de uso e a política de privacidade
   identificam a operadora pelo rodapé, então isso precisa estar no ar antes de
   divulgar a página. Deixe "Lançamento do site" em "Lista de espera".
6. **Smoke test.** Inscreva o seu e-mail em `/espera`, abra o link do e-mail,
   confirme no botão e veja "Pronto, você está na lista"; repita em
   `/en/waitlist`; confira `/legal/termos` com "Versão 1", a empresa no rodapé, e
   `/sitemap.xml` com `/espera` e `/en/waitlist`. A inscrição aparece em
   `/admin/leads`.

Quando o checkout do kit estiver testado (fase 4), volte a `/admin/support` e
mude "Lançamento do site" para "Aberto".

## E-mails e jobs

A plataforma escreve para as pessoas por três caminhos, e cada um tem a sua
configuração.

### E-mails do app (Resend)

Enviados pelo próprio app com `RESEND_API_KEY` e `EMAIL_FROM`: boas-vindas,
recibo, confirmação e fim de assinatura, aviso de período pago terminando,
lembrete de conexão, resumo semanal de versões novas, mensagens dos encontros,
confirmação da lista de espera e mensagens para a lista. Os modelos e o texto
nos dois idiomas ficam em `packages/email`; cada pessoa recebe no idioma do
perfil (`profiles.locale`) ou da inscrição (`leads.locale`).

- Sem `RESEND_API_KEY` nada quebra: os avisos continuam chegando pelo sino do
  painel, e as telas que dependem de e-mail (lista de espera, "escrever para a
  lista") dizem que o envio está fora do ar.
- Os links dos e-mails usam `NEXT_PUBLIC_SITE_URL`. Sem ela, apontam para
  `http://localhost:3000`.
- O resumo semanal e as mensagens para a lista levam o link de descadastro no
  corpo e no cabeçalho `List-Unsubscribe` (um clique). O endereço é
  `/api/public/email/unsubscribe`, público por definição; quem clica no link
  cai em `/descadastro` (ou `/en/unsubscribe`) e confirma em um botão.

### E-mails de autenticação (Supabase Auth)

Confirmação de cadastro, troca de senha e troca de e-mail são enviados pelo
Supabase, não pelo app. Os modelos bilíngues estão em `supabase/templates/` e
escolhem o idioma pelo `locale` gravado no cadastro (`{{ .Data.locale }}`;
conta sem ele lê em português).

1. **Authentication → Emails → SMTP Settings**: ligar o SMTP próprio com o
   Resend (host `smtp.resend.com`, porta `465`, usuário `resend`, senha a
   `RESEND_API_KEY`, remetente o mesmo endereço de `EMAIL_FROM`). Sem SMTP
   próprio o Supabase limita os envios a poucos por hora.
2. **Authentication → Sign In / Providers → Email**: ligar "Confirm email". É o
   link de confirmação que leva a conta nova a `/auth/callback`, de onde saem o
   aviso e o e-mail de boas-vindas.
3. **Authentication → Emails → Templates**: colar o conteúdo de cada arquivo e
   o assunto correspondente. O assunto vai nos dois idiomas porque é uma linha
   só:

   | Modelo no painel | Arquivo | Assunto |
   | --- | --- | --- |
   | Confirm signup | `supabase/templates/confirmation.html` | `Confirme seu e-mail no flyee.club / Confirm your email at flyee.club` |
   | Reset password | `supabase/templates/recovery.html` | `Redefina sua senha do flyee.club / Reset your flyee.club password` |
   | Change email address | `supabase/templates/email_change.html` | `Confirme seu novo e-mail no flyee.club / Confirm your new email at flyee.club` |

   Os outros modelos do painel (convite, link mágico, reautenticação) não são
   usados pelo app e ficam como estão.
4. **Teste**: criar uma conta em `/auth/sign-up` com o site em português e outra
   em `/en`, e conferir que cada confirmação chega no idioma certo. Estes
   modelos são renderizados pelo Supabase e não passam pelos testes do
   repositório: este teste manual é a verificação deles.

O `supabase/config.toml` aponta para os mesmos arquivos, para quem ligar a
confirmação por e-mail no Supabase local.

### O relógio do ONE

Desde 2026-11-14 (com o sim do dono), o relógio que roda as varreduras fica no
servidor do ONE, a VPS compartilhada (`one@187.53.106.93`), e não mais no
Inngest: as batidas de 5 em 5 minutos na Vercel, cada uma carregando o app e
rodando as varreduras que vencem, eram a maior parte da CPU que o plano Hobby
permite. A lista das varreduras, com o horário de cada uma, fica em
`apps/web/src/lib/jobs/registry.ts`.

- **O código** é o mesmo do app, do mesmo commit: `apps/web/clock/main.ts`,
  empacotado por `apps/web/clock/build.mjs` num arquivo só.
- **O deploy de produção** empacota o relógio depois do deploy da Vercel e o
  envia por SSH com a chave `ONE_VPS_CLOCK_KEY`, que no servidor só pode rodar
  `/opt/atendimento/one/relogio/receber.sh` (o `authorized_keys` do usuário
  `one` traz `restrict,command="..."` nessa chave). O script confere o pacote,
  carrega-o com as chaves do servidor e só então troca o relógio, depois que a
  batida em curso termina. As três últimas versões ficam em
  `/opt/atendimento/one/relogio/versoes/`.
- **As chaves** do relógio são as de produção da Vercel, em
  `/opt/atendimento/one/segredos/relogio.env` (600, usuário `one`). Uma chave
  nova ou trocada na Vercel tem de ser posta lá também; as marcadas como
  sensíveis na Vercel não se leem de volta e são preenchidas à mão.
- **Se o relógio parar**: cada batida marca `clock_beat` em
  `platform_settings`; com a marca mais velha que 15 minutos, o app volta a
  rodar as varreduras que servem a quem espera enquanto o ONE está em uso. Ver
  o relógio: `ssh one@187.53.106.93 'docker logs --tail 20 one-relogio-relogio-1'`.
- **O navegador do ONE** (desde 2026-11-23) roda ao lado do relógio, no mesmo
  pacote e no mesmo `compose.yml`: `apps/web/clock/navegador.ts`, empacotado
  como `navegador.mjs` com o script das páginas (`pagina.js`), na imagem do
  Playwright da versão do app (`mcr.microsoft.com/playwright:v1.58.2-noble`; o
  `build.mjs` recusa outra). Protocola os lotes que os advogados aprovam para
  ele e confere um login logo que é informado. O `receber.sh` o carrega com as
  chaves do servidor e abre e fecha o Chromium antes de trocar a versão. Cada
  minuto marca `court_browser_beat` em `platform_settings`. Ver o navegador:
  `ssh one@187.53.106.93 'docker logs --tail 20 one-relogio-navegador-1'`.
- **`apps/web/clock/receber.sh` muda à mão**: o deploy nunca o reescreve.
  Depois de mudar, copie para o servidor e dê `chmod 755`.

O trabalho que alguém espera (ler um documento, conferir um papel, a resposta
do ONE na conversa, o próximo passo de um caso) não passa pelo relógio: roda
logo depois da resposta de cada ação, na Vercel.

Cada mensagem agendada é reservada no banco antes de ser enviada (migração
`0023`), então uma função que roda duas vezes não escreve duas vezes para a
mesma pessoa.

## Domínio — `flyee.club`

O app inteiro (site público bilíngue, painel, admin, API da CLI e webhooks)
roda no domínio `flyee.club`. O código não tem URL fixa: canonical, OG e
sitemap vêm de `NEXT_PUBLIC_SITE_URL`, e auth e webhooks derivam do host da
requisição.

### Configurar

1. **Vercel → Settings → Domains** → adicionar `flyee.club` (e `www.flyee.club`
   redirecionando para o apex). O Vercel mostra os registros a criar.
2. **DNS do registrador** → criar os registros indicados pelo Vercel. SSL é
   emitido automaticamente. Se o domínio também recebe e-mail, não mexer nos
   registros MX.
3. **Vercel → `NEXT_PUBLIC_SITE_URL=https://flyee.club`** (Production) e
   **redeploy** — é build-time.
4. **Supabase → Authentication → URL Configuration**: Site URL
   `https://flyee.club` e Redirect URLs `https://flyee.club/auth/callback` e
   `https://flyee.club/**`.
5. **OAuth Google** (se usado): adicionar `https://flyee.club/auth/callback`.
6. **Webhooks**: Asaas em `https://flyee.club/api/webhooks/asaas`, Stripe em
   `https://flyee.club/api/webhooks/stripe`; sync do Inngest em
   `https://flyee.club/api/inngest`.
7. **Resend**: verificar o domínio `flyee.club` (DKIM/SPF) antes de definir
   `EMAIL_FROM`; o mesmo SMTP serve aos e-mails de auth do Supabase.
8. **Meta/GA4**: os IDs não dependem de domínio. Opcional: verificar o domínio
   no Meta Business e atualizar a URL do stream do GA4.

### Smoke test pós-configuração

Home pública em `https://flyee.club` e `https://flyee.club/en` → aviso de
cookies → `/auth/sign-up` → `/inicio` → um checkout de teste em BRL (Asaas
sandbox) e outro em USD (Stripe test) → confirmar `InitiateCheckout`/`Purchase`
no Gerenciador de Eventos (Meta) e no GA4.

## Troubleshooting

- `Module not found: Can't resolve '@flyee/content'` (ou qualquer `@flyee/*`)
  no build → o checkbox **"Include files outside of the Root Directory in the
  Build Step"** está desligado. Ligue-o (Settings → Build and Deployment →
  Root Directory) e reexecute o workflow. O código resolve os pacotes por
  symlink de workspace (`node_modules/@flyee/* → packages/*`); confinar o build
  a `apps/web` quebra esses symlinks.
- `husky: not found` / `npm install exited with 127` → já corrigido: o script
  `prepare` da raiz é `husky || true`, tolerante à ausência do husky no CI.
- `Project not found` / erro de escopo no `vercel deploy` →
  `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` não batem com o token (token criado em
  outro team). Recrie o token no escopo certo.
- Build da nuvem falha por variável faltando → cadastre-a no ambiente
  correspondente da Vercel (o build de PR usa **Preview**, o de `main`/manual
  usa **Production**).
- Deploy de produção "preso" → o job usa concurrency `vercel-production` sem
  cancelamento: deploys enfileiram na ordem dos pushes.
- `The job has exceeded the maximum execution time` / `The operation was
  canceled` durante o "Building…" → **quem foi cancelado foi o runner do
  GitHub, não o build da Vercel**. Como o deploy é build na nuvem, o
  `vercel deploy` fica BLOQUEADO esperando a Vercel terminar; o
  `timeout-minutes` do job é, na prática, "quanto tempo o build pode levar".
  Duas coisas seguram isso hoje:
  1. `timeout-minutes: 60` no workflow (era 30).
  2. `.vercelignore` na raiz exclui `apps/web/src/app/(dashboard)/ui` — o
     showcase de componentes do template, que sozinho é **121 das 201 rotas**
     do app. Ele é referência de desenvolvimento (nada fora dele o importa e o
     menu não linka), mas era gerado estaticamente em todo build de produção —
     e o build roda com `experimental.cpus: 1` (o container de 8 GB dá OOM com
     workers paralelos), ou seja, rota a rota. Verificado localmente: sem o
     `/ui`, o build completo leva **~4,5 min**. O código continua no git e
     segue acessível em `http://localhost:3000/ui` no dev.

  Antes de mexer em timeout, **confira o build na Vercel** (link "Inspect" do
  log): se ele concluiu, o deploy foi para produção mesmo com o job vermelho.
