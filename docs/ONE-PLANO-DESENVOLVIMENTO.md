# ONE · Plano de desenvolvimento da plataforma

8 de outubro de 2026. Documento técnico: trata só do desenvolvimento da plataforma. Assuntos de negócio, jurídicos e societários ficam em outro documento e não aparecem aqui.

Base deste plano: o levantamento do código deste repositório (8/10/2026), a análise do produto (regras do domínio, integrações) e a pesquisa técnica das integrações. Onde um ponto técnico ainda não foi confirmado, o plano diz como fechar com um teste.

---

## 1. Objetivo e escopo

**Objetivo.** Construir o ONE neste monorepo (Next.js 15, Supabase, Inngest), como software de vários escritórios de advocacia desde o primeiro dia, com o primeiro módulo de produto: ações de passageiro aéreo contra companhias (atraso, cancelamento, overbooking, bagagem), para passageiros do Brasil todo.

**O que o código assume (premissas de produto já fechadas):**

- Vários escritórios no mesmo banco, isolados por RLS. Um usuário pertence a um escritório na v1.
- Um caso pode ter mais de um processo: os adultos no juizado especial cível e o menor na vara cível da mesma comarca, ligados ao mesmo caso e à mesma prova.
- Foro padrão no domicílio do passageiro; outro foro só com vínculo com o voo e motivo registrado.
- Protocolo assistido: a plataforma monta o pacote no padrão de cada sistema de tribunal; o advogado protocola no sistema do tribunal com o próprio login.
- Nenhuma credencial de advogado na plataforma: nem senha, nem semente de segundo fator, nem certificado (A1, A3 ou em nuvem). Todos os tipos de certificado funcionam porque a assinatura acontece no sistema do tribunal.
- A plataforma não movimenta dinheiro de processo. A única cobrança é a assinatura do próprio ONE.
- WhatsApp pela Cloud API oficial, com o número de cada escritório, em coexistência com o aplicativo do celular.
- Marca do escritório em tudo o que o passageiro vê.

**Fora do código nesta etapa:** outros módulos (salário-maternidade, plano de saúde, trabalhista); protocolo automático ou por MNI; aplicativo móvel; idioma inglês; qualquer controle de valores de processo, repasse ou nota fiscal do escritório.

---

## 2. Princípios de engenharia

1. **Regra é código.** Foro, tipo de processo, prazo, prescrição, elegibilidade, contagem de causas por estado e suspensão pelo Tema 1.417 são funções puras, versionadas e testadas. IA nunca decide regra.
2. **IA sugere e registra.** Toda execução de IA é gravada (tarefa, versão do prompt, modelo, esforço, hash das entradas, saída, custo). O que é interpretação passa pela fila de aprovação de um advogado. Uma categoria só ganha autonomia (automático com amostra) quando bate a meta de acerto medida, e volta ao manual depois de um erro grave.
3. **Nenhuma credencial de advogado.** O cofre guarda só tokens de API de fornecedores do escritório (Meta, ZapSign, agregador, Google). Teste automatizado barra colunas e chaves com nomes de senha, PIN ou certificado.
4. **Todo fornecedor atrás de um adaptador com implementação falsa.** Cada integração tem interface, implementação real, implementação falsa (`fake`) e teste de contrato com respostas gravadas. Nenhuma história de código espera chave, conta ou aprovação externa: roda no `fake` até a chave existir.
5. **Configuração como dado.** Planos, limites, tabela de sistemas por tribunal, limites de arquivo, calendário forense, versões de API, preços de IA e regras por juízo ficam em tabelas, nunca em constantes.
6. **Escritório na base de tudo.** RLS em toda tabela com `org_id`. Jobs, webhooks e ferramentas de IA usam RPCs que recebem o escritório, nunca o cliente `service role` solto. Todo teste pgTAP novo roda com dois escritórios.
7. **Jobs idempotentes.** O padrão de reservar e depois enviar (`for update skip locked`, como em `0023_messages.sql`). O que está devido é recalculado do dado a cada varredura; nada de `step.sleepUntil`.
8. **Privacidade como código.** Consentimento por finalidade com texto congelado, retenção e descarte por job, exportação e exclusão por pessoa, logs sem dado pessoal.
9. **Tudo mede.** Eventos de uso com vocabulário fechado e custo de IA por escritório e por caso desde o primeiro marco.

---

## 3. Ponto de partida: o que a base entrega

Esforço em pessoa-dia, já contando a adaptação. Fonte: levantamento do código em 8/10/2026.

### 3.1 Manter e adaptar

| Área | Caminhos principais | O que fazer | Esforço |
|---|---|---|---|
| Banco da plataforma | `packages/db/migrations` (0000 a 0035), `packages/db/tests` (33 pgTAP), `scripts/db-embedded/run.mjs`, `scripts/remote-db-gate.mjs` | Baseline novo num projeto Supabase novo, portando só a camada de plataforma (cerca de 5.700 das 11.986 linhas): escritório e equipe, auditoria, configurações, sino, cobrança, ajuda, suporte assistido, lista de espera, exclusão de conta, gasto de IA, reservas de 0023. Trocar `flyee_test`, `FLYEE_ENV_FILE` e `hashtext('flyee')` no runner e no gate. pgTAP: 19 saem, 10 são reescritos, 4 ficam. | 10 a 13 |
| Autenticação e 2FA | `packages/auth/src/*`, `apps/web/src/app/auth`, `apps/web/src/middleware.ts` | 2FA obrigatório por papel (hoje só exige de quem já cadastrou TOTP, `middleware.ts:58-69`); `aal2` conferido nas RPCs de aprovação; cadastro em dois caminhos (fundar escritório ou aceitar convite); renomear o cookie `mc-impersonating`; apagar `native.ts`. | 2 a 3 |
| Escritório e equipe | `0000_init.sql` (profiles, organizations, memberships), `lib/member/context.ts`, `hooks/use-current-org.ts` | A organização vira o escritório. Função no escritório em `memberships` (sócio, advogado, controladoria, atendimento) ao lado do `org_role`; helper `has_firm_function(org, funções[])`; OAB por pessoa em tabela própria; leitura entre colegas; troca de função, remoção e transferência de dono por RPC auditada. `handle_new_user` passa a criar só o perfil. | 6 a 8 |
| Auditoria | `packages/audit`, `0001_audit.sql`, `lib/audit.ts` | Tipo de ator (pessoa, agente de IA, sistema, cliente final) e aceite de quem não tem conta (canal, evidência, texto exato). Versionamento ligado em pessoas, casos, aprovações e aceites. | 1,5 a 2 |
| Camada de IA | `packages/ai/src/*`, `0017_ai_spend.sql`, `lib/ai-spend.ts` | Provedor da Anthropic para os modelos atuais (sem `temperature`, sem `tool_choice` forçado, SDK atual, bloco de documento PDF, tokens de cache no custo). Executor com ferramentas, `ai_runs`, prompts versionados, fila de aprovação, custo por escritório e caso. | 8 a 12 |
| Jobs | `packages/jobs/src/index.ts`, `app/api/inngest/route.ts`, `lib/*-jobs.ts` | Eventos com prefixo `one/`, id `one`, concorrência por escritório, `throttle` por número de WhatsApp. Moldes de lembrete em `meeting-jobs.ts` e `0023`. | 1 a 1,5 |
| E-mail | `packages/email` | Reply-to por escritório, convite de usuário, resumo semanal do sócio; só pt-BR. | 1,5 a 2 |
| Cobrança da assinatura | `packages/billing`, `0003_billing.sql`, `0004_entitlements.sql`, `settings/billing`, `admin/billing`, `api/webhooks/[provider]` | Só Asaas e BRL; degrau como dado (`limits` com `processos_ativos_max`, `ia_incluida`, `whatsapp_numeros_max`); medição de processos ativos; troca de faixa na assinatura existente; adicional do monitor de voo; painel de consumo. Sai Stripe, USD, o acesso de 12 meses e a oferta de fundador. | 6 a 9 |
| Onboarding | `packages/onboarding`, `lib/onboarding.ts` | `ONBOARDING_ORG_SCOPED = true`; passos lidos de fatos do banco: dados e CNPJ, OABs, equipe, WhatsApp conectado, ZapSign conectada, modelos. | 1,5 a 2 |
| Casca do painel | `app/(dashboard)/layout.tsx`, `components/layout/*`, `menu-items.ts`, `types.ts` | Menu por papel com `canAccess` (existe e não é usado, `types.ts:31`); tirar `DashboardTrackers` (`dashboard-chrome.tsx:72`) da área logada; home "o que precisa de alguém hoje". | 2 a 3 |
| Suporte assistido | `lib/impersonation*.ts`, `0012_impersonation.sql` | Cerca de escrita cobrindo aprovações, protocolos, aceites, convites e cofre, de preferência por padrão (teste de catálogo falha se uma tabela com `org_id` ficar sem gatilho). Leitura de dado sob sigilo só com autorização registrada do escritório. | 2 |
| Console de escritórios | `admin/membros`, `lib/admin/members.ts`, `0015_admin.sql`, `0021_admin_consoles.sql` | Refazer por escritório: equipe, plano, processos ativos, mensagens, custo de IA, conexões, alertas. | 4 a 5 |
| Backup lógico | `packages/backup` | Escrever em fluxo (hoje junta tabela inteira em memória, `index.ts:57-61`), excluir o cofre; recuperação real pela PITR do Supabase mais cópia do storage. | 1,5 |
| Validadores | `packages/fields` | Acrescentar número CNJ com dígito verificador e extração de tribunal, OAB (UF e número), IATA e número de voo. | 1 |
| Eventos de uso | `0006_product_events.sql`, `lib/product-events*.ts` | Manter o mecanismo com o vocabulário do ONE. | 1,5 a 2 |
| Marca e mensagens | `packages/content`, `packages/design-tokens`, `brand.ts` | Identidade provisória, só pt-BR, mensagens podadas com `scripts/prune-messages.mjs`. | 2 a 3 |
| Harness de agentes | `CLAUDE.md`, `apps/web/CLAUDE.md`, `.claude/rules`, `.claude/hooks`, `.claude/settings.json` | Reescrever regras para o ONE (hoje mandam "nunca pôr lógica de produto aqui"), tirar `Bash(node:*)`, resolver a regra `mui-on-public` que trava o pre-commit, rodar `npm run harness:sync`. | 1 a 1,5 |

### 3.2 Recuperar do commit `ab2e84d`

Ler com `git show ab2e84d:<caminho>`. O TypeScript porta com pouco ajuste (os pacotes importam `@flyee/auth` e `@flyee/jobs`, que continuam com esses nomes). O SQL foi escrito para outro schema e é reescrito no baseline novo. Nada disso foi provado em produção: portar como molde, com testes.

| Pacote ou tela | O que aproveita | O que falta para o ONE | Esforço |
|---|---|---|---|
| `packages/whatsapp` (12 arquivos, cerca de 590 linhas) | Interface de provedor, envio de texto e modelo, `wa_messages`, webhook com `X-Hub-Signature-256` verificado em tempo constante | Uso por vários escritórios: Embedded Signup v4, token de negócio por escritório no cofre, webhook único roteado por `phone_number_id`, coexistência (`smb_app_data` com `smb_app_state_sync` e `history`, campos `smb_message_echoes`), mídia em storage privado, modelos por WABA, janela de 24 horas, opt-out, categoria e pricing lidos do status, reserva antes do envio. Graph API de v23.0 para a atual, como configuração. Sai o provedor Evolution. | 10 a 14 |
| `packages/connectors` | `connections` e `connection_secrets` (só o service role lê), registro de conectores, tela de conexões | Segredo cifrado (Supabase Vault ou AES-256-GCM com chave fora do banco), fora do backup, leitura e escrita auditadas, validade, rotação, cerca por papel | 3 a 4 |
| `packages/documents` | Emissão idempotente com versão, hash e código público; página de verificação | Fontes do ONE (procuração, contrato, peça, pacote de protocolo, declaração de residência); página de verificação contra golpe | 3 a 4 |
| Equipe e convites (`settings/organization`, `invite/[token]`, `accept_invite`) | Convite amarrado ao e-mail do JWT, `advisory lock`, auditoria | Token só em hash, validade curta, teto de assentos do plano, função no convite | 3 a 4 |
| Links por token (`consentir`, `gravar`, `documento`, `api/public/*`, `lib/share-link*.ts`) | Token no fragmento, só SHA-256 no banco, upload por URL assinada com reserva, aceite com texto congelado | Pasta do cliente do ONE, sem MUI e sem rastreadores | 4 a 6 |
| `packages/transcribe` | Tabela, job, checagem de cobertura, retenção do áudio | Provedor escolhido por teste com 100 áudios curtos; minutos no gasto de IA | 1 a 3 |
| `packages/knowledge` | Busca híbrida (pgvector e texto em português, RRF), níveis de confiança, conjunto de avaliação | Biblioteca verificada do verificador de citações; exige pgvector (fora do runner embutido) | 3 a 5 |
| Importação (`lib/import`, 24 arquivos com testes) | Lotes, mapeamento de colunas, prévia, reenvio, desfazer | Leitor de XLSX (hoje recusa de propósito em `sniff.ts`) | 4 a 6 |
| Agenda e lembretes (`agenda/page.tsx`, `lib/agenda*.ts`) | Molde da agenda de audiências e dos lembretes | Audiências por processo, lembretes por WhatsApp | 3 a 5 |
| Medidores (`0024_trial_minutes.sql`, `0043`, `0063`) | Razão de uso só de inserção e alertas de 80, 95 e 100% idempotentes | Processos ativos e IA incluída | 1,5 a 2 |

### 3.3 O que sai

Entrega da CLI, servidor OAuth e catálogo (cerca de 6.250 linhas: `app/oauth`, `app/ativar`, `app/revalidar`, `api/cli`, `api/oauth`, `lib/cli`, `lib/oauth`, `lib/catalog`, `packages/catalog`); telas do clube (`modulos`, `receitas`, `novidades`, `encontros`, `roadmap`, `settings/devices`, `lib/member/*`, `lib/upsell.ts`); consoles da flyee (`admin/catalogo`, `admin/encontros`, `admin/roadmap`, `admin/metricas`, cerca de 5.470 linhas). Antes de apagar, copiar três moldes: `lib/cli/gates.ts` (para uma API de parceiros), `guard_module_version` (`0008_catalog.sql:248`, para versionar prompts e modelos) e o manifesto zod publicado como JSON Schema (`packages/catalog/src/manifest.ts`, para versionar o módulo). O console de insights é desligado: hoje manda linhas do banco a um modelo, com OpenRouter na cadeia.

### 3.4 Armadilhas técnicas da base

- `apps/web/.env.local` aponta para outro projeto Supabase com a chave de serviço; `npm run dev` grava lá e `scripts/remote-db-gate.mjs` lê esse arquivo primeiro.
- `apps/web/.env` traz credenciais de produção de outro produto; um carregador que ignore o `.env.local` as devolve ao app.
- `.claude/settings.json` libera `Bash(node:*)`: um agente pode rodar o gate de banco sem confirmação.
- O pre-commit está travado: `scripts/test-agent-harness.mjs:95` exige a regra `mui-on-public`, que o lint não tem, e há uma refatoração pela metade fora do commit.
- `node_modules/@flyee/*` veio vazio na cópia: nada compila antes de `npm install` na raiz.
- `.github/workflows/deploy.yml` publica a cada push na `main` assim que os segredos existirem.
- `supabase/config.toml` usa `project_id = "flyee-club-local"` e as portas 54321 e 54322: dois projetos na mesma máquina dividem contêineres.
- O runner embutido só tem pgTAP, pgcrypto e uuid-ossp: pgvector e Vault pedem o caminho com Docker.
- Limites de execução: 60 s por passo na rota do Inngest (`app/api/inngest/route.ts:5`) e 4,5 MB de corpo de requisição na Vercel.
- Os READMEs de `packages/ai` e `packages/audit` descrevem coisas que não existem na árvore: planejar pelo código.

---

## 4. Arquitetura alvo

### 4.1 Pacotes do monorepo

| Pacote | Responsabilidade | Depende de |
|---|---|---|
| `packages/db` | Baseline novo, RLS, RPCs, pgTAP, espelho Drizzle | |
| `packages/auth` | Clientes Supabase, sessão, 2FA por papel, cookie de suporte | `db` |
| `packages/audit` | Eventos de auditoria, versões de linha, termos e aceites (com e sem conta) | `db` |
| `packages/jobs` | Cliente Inngest, mapa tipado de eventos `one/*`, `sendEvent` que nunca lança | |
| `packages/connectors` (recuperado) | Cofre de conexões por escritório | `db`, `audit` |
| `packages/ai` | Provedores, executor com ferramentas, registro de execução, prompts versionados, custo | `db`, `jobs` |
| `packages/rules` (novo) | Funções puras do domínio: foro, tipo de processo, prazos, prescrição, elegibilidade, Tema 1.417, contagem de causas por estado | `fields` |
| `packages/courts` (novo) | Cliente do DJEN, cliente do webservice do Projudi do TJGO, interface do agregador, tabela de sistemas, construtores de pacote por sistema, calendário forense | `rules`, `documents` |
| `packages/whatsapp` (recuperado) | Cloud API por escritório, webhook único, coexistência, modelos, janela, opt-out | `connectors`, `jobs` |
| `packages/signatures` (novo) | Interface de assinatura eletrônica do cliente; adaptador ZapSign; planos B (upload do PDF assinado no gov.br, link do e-Notariado) | `connectors`, `documents` |
| `packages/documents` (recuperado) | Emissão com versão e hash; normalização (imagem para PDF, divisão e compressão pelo limite de cada sistema) | `db` |
| `packages/transcribe` (recuperado) | Transcrição de áudio atrás de interface | `ai` |
| `packages/knowledge` (recuperado) | Biblioteca verificada e busca híbrida | `db` |
| `packages/flights` (novo) | Status e histórico de voo (AeroDataBox), clima (REDEMET), importação do VRA da ANAC | |
| `packages/identity` (novo) | Consulta de CPF (Serpro) atrás de interface | `connectors` |
| `packages/billing` | Assinatura do ONE pelo Asaas, faixas, medição, consumo | `db` |
| `packages/email`, `packages/fields`, `packages/onboarding`, `packages/backup`, `packages/content`, `packages/design-tokens` | Como na base, adaptados | |

Regra de fronteira: `rules` não importa nada de I/O; `courts`, `whatsapp`, `signatures`, `flights`, `identity` e `transcribe` expõem uma interface e duas implementações (`real` e `fake`); só `apps/web` e os jobs juntam as peças.

### 4.2 Superfícies do app (`apps/web`)

- **Área do escritório** (`app/(dashboard)`): Hoje (o que precisa de alguém), Atendimento (conversas), Casos (lista; detalhe com linha do tempo, pessoas, processos, documentos, dossiê, minuta), Aprovações (fila única de tudo que é interpretação), Protocolo (fila por sistema e tribunal, com o pacote pronto), Publicações (intimações e prazos), Agenda (audiências), Clientes, Relatórios, Configurações (escritório, equipe, OABs, conexões, modelos, plano e consumo, inventário de certificados).
- **Links do cliente, sem conta** (rotas públicas por token, sem MUI e sem rastreadores): pasta do cliente (dados, documentos, assinatura), relato em áudio, confirmação da cronologia, rastreio do processo, cadastro do Direito do Passageiro, página de verificação de documento contra golpe.
- **Console de operação do ONE** (`/admin`, só superadmin): escritórios, planos e uso, saúde das integrações (DJEN, Projudi, WhatsApp, ZapSign), tabela de sistemas por tribunal, calendário forense, preços de IA, auditoria, suporte assistido, backups.
- **Site do ONE** (`app/[locale]`, só pt-BR): páginas institucionais, lista de espera, páginas legais lidas de `consent_terms`, contato.
- **Rotas de máquina**: `/api/webhooks/whatsapp`, `/api/webhooks/zapsign`, `/api/webhooks/asaas`, `/api/inngest`, `/api/public/*` (links do cliente).

### 4.3 Jobs (Inngest)

| Evento ou agenda | O que faz | Idempotência |
|---|---|---|
| `one/djen.capture` (diário, por OAB) | Busca as comunicações de cada OAB ativa em todos os tribunais, respeitando 20 consultas por janela, e casa com processos pelo número CNJ | Chave única por hash da comunicação |
| `one/djen.watchdog` (diário) | Avisa se a captura não rodou ou se um tribunal parou de publicar | Um aviso por tribunal e dia |
| `one/projudi.sync` (noturno, TJGO) | Consulta dados, movimentações, pendências e advogados dos processos ativos no Projudi do TJGO, de preferência fora do expediente | Chave por processo e movimento |
| `one/aggregator.sync` (diário) | Andamento dos processos fora de Goiás pelo agregador | Chave por processo e movimento |
| `one/publication.triage` | Classifica a intimação (modo sombra, depois com amostra); não urgente vai em lote | Uma execução por publicação e versão de prompt |
| `one/deadline.compute` | Calcula o prazo pela regra e pelo calendário e põe na fila de confirmação | Recalcula do dado; confirmação humana trava |
| `one/notice.sweep` (a cada 10 min) | Reserva e envia avisos devidos: dia do voo, documento pendente, audiência (1 mês, 1 semana, 1 dia, no dia), atualização quinzenal, valor liberado com alerta de golpe | Reservar e depois enviar |
| `one/whatsapp.inbound` | Grava a mensagem, baixa a mídia, roteia para robô ou pessoa | Chave pelo id da mensagem |
| `one/whatsapp.status` | Atualiza status, categoria e pricing da mensagem | Status não regride |
| `one/document.received` | Normaliza, roda as checagens e pede confirmação | Uma normalização por arquivo e hash |
| `one/signature.completed` | Baixa o PDF assinado e as evidências, atualiza o caso | Chave pelo id do envelope |
| `one/flight.watch` (Direito do Passageiro) | Consulta status nos horários do voo e dispara a mensagem informativa | Um aviso por voo e tipo |
| `one/habitualidade.count` (diário) | Recalcula causas por advogado, estado e ano e avisa antes da sexta | Um aviso por advogado, estado e ano |
| `one/system.change` (diário) | Compara o endereço dos links do DJEN com a tabela de sistemas e avisa mudança | Um aviso por tribunal e mudança |
| `one/usage.meter` (diário) | Retrato de processos ativos e IA usada por escritório; alertas de 80, 95 e 100% | Chave por escritório, medidor, janela e limiar |
| `one/retention.purge` (diário) | Apaga o que venceu pela política de retenção | Idempotente por definição |

Concorrência com chave por escritório; `throttle` por número de WhatsApp (a coexistência tem vazão fixa de 20 mensagens por segundo). Todo job novo ganha teste de idempotência no molde de `packages/db/tests/0021_messages.test.sql`.

### 4.4 Arquivos e documentos

- Storage privado do Supabase, caminho `org/<org_id>/case/<case_id>/...`, leitura só por URL assinada de curta duração.
- Upload direto do navegador por URL assinada (fora do limite de 4,5 MB da Vercel), com reserva e confirmação.
- Normalização: imagem para PDF, orientação, divisão e compressão pelo limite de cada sistema. Decisão técnica no M1 por teste: `pdf-lib` e `sharp` dentro da função, com `maxDuration` maior; se a compressão exigir `qpdf` ou Ghostscript, um trabalhador em contêiner acionado por evento, fora da Vercel.
- Cada arquivo guarda `sha256`, páginas, tamanho, tipo detectado e o resultado de cada checagem.

### 4.5 Camada de IA

- Provedor da Anthropic corrigido para os modelos atuais: sem parâmetros de amostragem, saída estruturada sem `tool_choice` forçado, PDF como bloco de documento, tokens de cache no custo, tratamento de recusa, SDK atual, streaming para saídas longas.
- Executor com ferramentas: registro de ferramentas com schema estrito, teto de passos, uma ferramenta "propor e parar" que cria um item na fila de aprovação. Cada ferramenta recebe o escritório fixado.
- `ai_runs` e `ai_run_steps` ligados ao `ai_spend` por `run_id`; `prompt_versions` imutáveis (rascunho, publicado, retirado).
- Tarefas do módulo: checagem de documento (legibilidade, tipo, titular, data), extração do bilhete e do cartão de embarque, cronologia a partir do relato, triagem da causa do atraso (com clima e motivo escrito), minuta da inicial a partir dos modelos do escritório com citações só da biblioteca verificada, classificação de intimação, resumo de andamento para o cliente, sugestão de resposta no atendimento.
- Modelos: Haiku 5.5 na triagem e nas checagens, Sonnet 5.5 nas conversas e na dúvida, Opus 5.5 nas minutas. Triagem não urgente pela API de lotes, pela metade do preço.
- Conjuntos de referência por tarefa, montados a partir do modo sombra, rodando no CI quando o prompt muda.

### 4.6 Camada de integrações

Cada adaptador mora no seu pacote, com `real.ts`, `fake.ts`, `contract.test.ts` (rodando o `fake` e as respostas gravadas do `real`) e um teste vivo opcional contra o sandbox, fora do CI comum. A escolha entre `real` e `fake` vem da configuração do ambiente e da conexão do escritório.

---

## 5. Modelo de dados

RLS padrão: membro do escritório lê; escrita só por RPC que confere a função no escritório; tabelas globais são lidas por todos os autenticados e escritas só pelo console do ONE. Marcos na seção 8.

**Plataforma**

| Tabela | Conteúdo principal | RLS | Marco |
|---|---|---|---|
| `organizations` | Escritório: razão social, CNPJ, UF, fuso, horário de atendimento | Membro lê; dono e admin editam | M1 |
| `memberships` | `org_role` e `firm_function` (sócio, advogado, controladoria, atendimento) | Membro lê; dono e admin gerem por RPC | M1 |
| `invites` | Token em hash, função, validade | Dono e admin | M1 |
| `lawyer_oabs` | Pessoa, UF, número, principal ou suplementar | Membro lê; a pessoa e o admin editam | M1 |
| `org_settings` | Configuração privada do escritório | Membro lê; admin edita | M1 |
| `connections`, `connection_secrets` | Conexões e segredos cifrados | Conexões: dono e admin; segredos: só service role | M1 |
| `audit_events`, `record_versions`, `consent_terms`, `consent_acceptances`, `access_events` | Como na base, com tipo de ator e aceite sem conta | Só inserção | M1 |
| `ai_runs`, `ai_run_steps`, `prompt_versions`, `approvals`, `ai_spend` | Execuções, versões, fila de aprovação, custo | Membro lê o próprio escritório; aprovação só por advogado com `aal2` | M1 |
| `usage_ledger`, `usage_alerts` | Medição e alertas | Sócio lê; service role escreve | M3 |
| `plans`, `subscriptions`, `invoices` e demais da cobrança | Como na base, só BRL e Asaas | Como na base | M3 |

**Domínio**

| Tabela | Conteúdo principal | RLS | Marco |
|---|---|---|---|
| `people` | Passageiros e responsáveis: nome, CPF, nascimento, endereço, contato, menor, responsável | Escritório | M2 |
| `cases` | Caso: companhia, ocorrência (atraso, cancelamento, overbooking, bagagem), causa (interna, externa, indefinida), suspensão pelo Tema 1.417, origem, situação | Escritório | M2 |
| `case_parties` | Pessoa no caso: autor adulto, autor menor, responsável | Escritório | M2 |
| `flight_segments` | Trechos: voo, origem, destino, horários previstos e reais, fonte | Escritório | M2 |
| `proceedings` | Processo: tipo (juizado ou vara), número CNJ, tribunal, comarca, juízo, sistema, regra e motivo do foro, situação | Escritório | M2 |
| `proceeding_parties`, `proceeding_lawyers` | Autores e advogados de cada processo | Escritório | M2 |
| `documents`, `document_checks` | Arquivos e o resultado de cada checagem (IA e humana) | Escritório | M2 |
| `client_links` | Token em hash, escopo, validade | Escritório; acesso público só pela RPC do token | M2 |
| `signature_requests` | Envelope, signatários, autenticação, situação, PDF assinado, evidências | Escritório | M2 |
| `statements` | Relato em áudio, transcrição, cronologia proposta e confirmada | Escritório | M2 |
| `admin_complaints` | Canal (Anac Passageiro, consumidor.gov.br), protocolo, datas, resposta | Escritório | M2 |
| `dossiers` | Itens do dossiê de boa-fé e o PDF gerado | Escritório | M2 |
| `drafts`, `draft_citations` | Minuta versionada e a conferência de cada citação | Escritório; aprovação por advogado | M2 |
| `filing_packages`, `filing_receipts` | Pacote por sistema, validações, situação, recibo | Escritório | M2 |
| `court_systems` | Tribunal, tipo de processo, sistema, desde quando, limites de arquivo, fonte | Global | M2 |
| `court_calendars` | Feriados e suspensões por tribunal e comarca | Global | M3 |
| `judge_requirements` | Mapa de exigências por juízo: exigência, contagem, primeira e última vez | Escritório | M2 |
| `publications` | Intimações: fonte, tribunal, número CNJ, data, teor, sem teor, hash, classificação | Escritório | M2 |
| `movements` | Andamentos do Projudi e do agregador | Escritório | M3 |
| `deadlines` | Prazo: regra, início, fim, confirmado por, situação | Escritório; confirmação pela controladoria | M3 |
| `hearings` | Audiência: tipo, data, modalidade, link ou local, audiencista, situação | Escritório | M3 |
| `client_notices` | Aviso devido e enviado, canal, mensagem | Escritório; service role reserva | M3 |
| `conversations`, `messages`, `wa_templates`, `contact_optouts` | WhatsApp por escritório | Escritório; atendimento não vê conexões | M1 e M4 |
| `certificate_inventory` | Por advogado e sistema: tipo (A1, A3, nuvem), provedor, validade informada, posto verificado em | Escritório | M2 |
| `passenger_signups`, `flight_watches` | Cadastro do Direito do Passageiro e voos monitorados | Escritório | M4 |
| `outcomes` | Resultado: acordo ou sentença, data, prazo de cumprimento | Escritório | M5 |
| `product_events` | Eventos de uso com vocabulário fechado | Como na base | M5 |

A contagem de causas por estado é uma visão sobre `proceeding_lawyers` e `proceedings` (por advogado, UF e ano). Processo ativo, para a faixa do plano, vai da distribuição ao arquivamento; a família com adultos no juizado e menor na vara conta dois.

---

## 6. Integrações como software

| Adaptador | Interface | Fake e teste de contrato | Marco |
|---|---|---|---|
| DJEN (`courts`) | `listByOab(uf, numero, desde)`, `getByHash` | Respostas reais gravadas e anonimizadas; teste do formato e do limite de taxa | M2 |
| Projudi TJGO (`courts`) | `getProcess(cnj)`, `listMovements`, `listPendencies`, `listResponsibles` (operações públicas 74 a 77) | XML de exemplo da documentação do tribunal; teste do parser | M3 |
| Agregador (`courts`) | `getMovements(cnj)`, `getDocuments(cnj)` | Fake genérico; teste comparativo entre fornecedores no M3 | M3 |
| Pacotes de protocolo (`courts`) | `validate(files)`, `assemble(peça, anexos)` por sistema: Projudi, eproc, PJe, e-SAJ | Testes com arquivos de exemplo e limites da tabela | M2 (Projudi), M3 (eproc, PJe) |
| WhatsApp (`whatsapp`) | `send`, `submitTemplate`, `parseWebhook`, `verifySignature`, `exchangeSignupCode`, `syncCoexistence` | Simulador local que envia webhooks assinados; número de teste da Meta em desenvolvimento | M1 |
| Assinatura (`signatures`) | `createEnvelope`, `getStatus`, `downloadSigned`, `verifyWebhook` | Fake com estados do envelope; sandbox da ZapSign | M2 |
| CPF (`identity`) | `lookupCpf(cpf)` | Fake com CPFs de teste; ambiente de demonstração do Serpro | M2 |
| Voo (`flights`) | `getFlightStatus(voo, data)`, `getMetar(icao, janela)`, `importVra(arquivo)` | Respostas gravadas; plano gratuito do AeroDataBox para desenvolvimento | M2 (REDEMET, VRA), M4 (status) |
| Transcrição (`transcribe`) | `transcribe(audio)` | Fake com texto fixo; teste com 100 áudios reais para escolher o provedor | M2 |
| IA (`ai`) | `generate`, `generateStructured`, `runTools`, `batch` | Fake determinístico por tarefa; conjuntos de referência | M1 |
| Agenda (Google) | `upsertEvent` na agenda criada pelo ONE | Fake; projeto Google em modo de teste | M3 |
| Cobrança (`billing`) | Como na base, Asaas | Sandbox do Asaas | M3 |
| E-mail (`email`) | Como na base | Sem chave, não envia | M1 |

---

## 7. Assinatura e certificados

**Como a plataforma suporta A1, A3 e nuvem sem tocar no certificado.** No MVP, toda assinatura de advogado acontece dentro do sistema do tribunal, no momento do protocolo, com o assinador que cada sistema exige. A plataforma entrega o pacote pronto (arquivos nomeados, divididos e no formato certo) e nunca recebe o certificado, o PIN ou a senha. Por isso qualquer tipo de certificado que o tribunal aceite funciona.

**O que a plataforma implementa:**

1. `certificate_inventory`: por advogado e por sistema, o tipo (A1, A3 em token ou cartão, nuvem), o provedor, a validade informada pelo próprio advogado e a data da última verificação do posto. Nenhum dado do certificado em si.
2. Checagem do posto de protocolo, por sistema: lista de verificação na tela (assinador instalado, certificado dentro da validade, aplicativo autenticador da PDPJ configurado quando o sistema usa a PDPJ) e aviso de vencimento 30 dias antes.
3. Fila de protocolo que mostra, por pacote, o que o advogado precisa ter à mão para aquele sistema.
4. Recibo de protocolo anexado ao caso (upload ou captura do comprovante), fechando o ciclo do pacote.

**Matriz técnica por sistema.** O que já está confirmado e o que fecha por teste:

| Sistema | Login do advogado | Assinatura da peça | Limites de arquivo | Situação |
|---|---|---|---|---|
| Projudi TJGO | Usuário e senha, com código de 6 caracteres por e-mail quando o sistema pede, ou certificado digital | A confirmar no teste do posto | 6 MB para arquivos de 30 páginas ou mais (aviso de 2020); o limite dos menores precisa de teste | Login confirmado; assinatura e limite menor por teste |
| PJe (PDPJ) | Desde 18/05/2026, código de aplicativo autenticador, mesmo com certificado | Certificado ICP-Brasil pelo assinador do sistema (a confirmar quais tipos de nuvem funcionam) | Definido por tribunal | Login confirmado; assinador e nuvem por teste |
| Jus.br | Certificado ou gov.br nível ouro, com segundo fator por aplicativo | Petição intercorrente nos tribunais integrados (o TJGO está integrado); inicial a confirmar | | Confirmado em parte |
| eproc (SP, MG, PR, RS, SC e outros) | A confirmar por tribunal | A confirmar | 11 MB por PDF no guia do TJSP | Limite pesquisado; resto por teste |
| e-SAJ (legado TJSP e varas de alguns estados) | A confirmar | A confirmar | Historicamente 30 MB por arquivo e 300 KB por página no TJSP | Só para processos antigos |

**Como fechar a matriz:** uma história técnica por sistema no M2 e no M3 (meio dia a um dia cada), feita com um advogado do escritório piloto: entrar no ambiente de treinamento do tribunal quando existir, ou acompanhar o primeiro protocolo real assistido, e registrar login, assinador, suporte a nuvem, assinatura em lote no próprio sistema, aceite de PDF já assinado e limites. O resultado vira linha da tabela `court_systems`, nunca constante no código.

**Depois do MVP (opcional, M6 em diante):** assinatura de documentos dentro do ONE sem custódia, só se algum sistema aceitar PDF pré-assinado e isso poupar tempo: componente no navegador com o certificado local (A1 instalado ou A3 no token) ou assinatura remota do certificado em nuvem pela API do provedor (padrão CSC), com autorização no celular a cada lote. Até lá, nada disso entra.

---

## 8. Roteiro de desenvolvimento

**Capacidade.** Sprints de duas semanas. Conta de 8 dias efetivos por pessoa por sprint (o resto é revisão, correção e imprevisto). Três pessoas fazem cerca de 24 pessoa-dia por sprint; duas, cerca de 16. O roteiro abaixo está montado para três pessoas; com duas, cada marco estica cerca de 1,5 vez.

| Marco | Entrega | Pessoa-dia | Três pessoas | Duas pessoas |
|---|---|---|---|---|
| M0 | Base limpa e segura | 20 a 28 | 2 a 3 semanas | 3 a 4 semanas |
| M1 | Fundação para vários escritórios | 53 a 72 | 5 a 6 semanas | 7 a 9 semanas |
| M2 | Do contrato assinado à petição inicial | 69 a 100 | 6 a 8 semanas | 9 a 12 semanas |
| M3 | Carteira nacional viva, cliente informado, cobrança e suporte para outros escritórios | 59 a 85 | 5 a 7 semanas | 8 a 11 semanas |
| **M0 a M3** | **Pronto para outros escritórios** | **201 a 285** | **17 a 24 semanas** | **25 a 36 semanas** |
| M4 | Atendimento com IA e Direito do Passageiro | 26 a 39 | 2 a 3,5 semanas | 3,5 a 5 semanas |
| M5 | Números | 16 a 24 | 1,5 a 2 semanas | 2 a 3 semanas |
| M6 | Escala para novos escritórios (em paralelo, a partir do fim do M3) | 20 a 29 | contínuo | contínuo |
| **M0 a M5** | | **243 a 348** | **20 a 29 semanas** | **30 a 44 semanas** |

### M0 · Base limpa e segura (sprint S0)

Objetivo: um repositório do ONE que compila, testa e não toca em nada de outro produto.

- Trocar `apps/web/.env.local` por um arquivo que zere Supabase, Asaas, Meta, GA4 e IA; tirar `apps/web/.env` da pasta; tirar `Bash(node:*)` de `.claude/settings.json`; deploy só por acionamento manual (`workflow_dispatch`); renomear `project_id` e portas do Supabase local.
- `npm install` na raiz; resolver a refatoração pela metade (concluir a regra `mui-on-public` no lint ou reverter); pre-commit e `npm run ci:verify` verdes.
- Repositório git novo para o ONE, sem o histórico de outros produtos; este fica como fonte de moldes.
- Reescrever `CLAUDE.md`, `apps/web/CLAUDE.md` e `.claude/rules` para o ONE; `npm run harness:sync`.
- Remover por fatias, com `ci:verify` verde a cada commit: CLI, OAuth e catálogo; telas do clube; consoles da flyee. Desligar `/admin/insights`; tirar Pixel e GA4 da área logada.
- Reduzir a pt-BR; identidade provisória; mensagens podadas.
- CI no GitHub Actions: lint, typecheck, testes, pgTAP no runner embutido e build em cada pull request.
- Ambientes: projeto Supabase de desenvolvimento e de homologação; variáveis de cada ambiente documentadas.

Aceite: `npm run ci:verify` verde num commit limpo do repositório novo; app sobe localmente com todos os adaptadores em `fake`; nenhuma credencial de outro projeto em nenhum arquivo.

### M1 · Fundação para vários escritórios (S1 a S3)

- **S1 · Banco e escritório.** Baseline novo com a camada de plataforma; escritório, função no escritório, convites, OABs, leitura entre colegas, RPCs auditadas de equipe; 2FA obrigatório por papel e `aal2` nas RPCs sensíveis; pgTAP com dois escritórios e varredura de catálogo atualizada.
- **S2 · Cofre, documentos e IA.** Cofre cifrado e fora do backup; auditoria com tipo de ator e aceite sem conta; storage por escritório e emissão de documentos; teste técnico da normalização de PDF (decide entre função e trabalhador em contêiner); provedor da Anthropic corrigido com testes; `ai_runs`, `prompt_versions`, fila de aprovação e custo por escritório.
- **S3 · WhatsApp e casca.** Pacote `whatsapp` para vários escritórios: webhook único roteado por `phone_number_id`, fluxo do Embedded Signup v4 contra o simulador e o número de teste da Meta, coexistência (sincronização de contatos e histórico, ecos do celular, eventos de desconexão), mídia em storage, modelos com checagem de conformidade, janela de 24 horas, opt-out, reserva antes do envio. Onboarding do escritório por fatos do banco; menu por papel; home "o que precisa de alguém hoje".

Aceite: dois escritórios isolados no banco, provados por pgTAP; convite e troca de função funcionando; mensagem entrando e saindo pelo simulador (e pelo número de teste quando houver); execução de IA registrada com custo e aprovada na fila.
Demonstração: cadastro de um escritório, convite de um colega, conexão do WhatsApp no simulador, uma conversa ida e volta.

### M2 · Do contrato assinado à petição inicial (S4 a S7)

- **S4 · Núcleo do domínio e pasta do cliente.** `people`, `cases`, `case_parties`, `flight_segments`, `proceedings`; linha do tempo do caso; links do cliente por token (dados e documentos); validadores de CNJ, OAB, IATA e voo; consulta de CPF atrás de interface; `court_systems` semeada a partir do DJEN por script (`scripts/djen-systems.mjs`).
- **S5 · Documentos e assinatura.** Normalização; checagens de documento pela IA com confirmação humana; extração de bilhete e cartão de embarque; adaptador ZapSign (envelope, webhook, PDF assinado e evidências); planos B (upload do PDF assinado no gov.br, link do e-Notariado); aceites por finalidade.
- **S6 · Relato, regras e reclamação.** Áudio, transcrição, cronologia proposta e confirmada pelo cliente; reclamação administrativa assistida com protocolo guardado; pacote `rules`: foro (domicílio por padrão, exceção com motivo), tipo de processo (menor na vara cível, caso com dois processos), suspensão pelo Tema 1.417 com triagem da causa (REDEMET e questionário), contagem de causas por estado; `certificate_inventory` e checagem do posto.
- **S7 · Dossiê, minuta e pacote.** Dossiê de boa-fé exportável; biblioteca verificada (`knowledge`) e verificador de citações que bloqueia a aprovação; minuta a partir dos modelos do escritório; medidor de semelhança entre peças; construtor de pacote do Projudi do TJGO (divisão por limite, nomes, lista de verificação); recibo de protocolo; captura do DJEN por OAB em todos os tribunais com triagem em modo sombra; teste técnico do posto de protocolo no Projudi.

Aceite: um caso real vai do contrato assinado ao pacote do Projudi pronto e ao recibo anexado; regras de foro e de tipo de processo com cobertura de testes de unidade dos casos do domínio (domicílio, local do fato com motivo, menor, família, causa externa); DJEN capturando todo dia, com a triagem em modo sombra comparada ao trabalho humano.
Demonstração: do primeiro link enviado ao cliente até o pacote pronto para o advogado protocolar.

### M3 · Carteira nacional viva e pronto para outros escritórios (S8 a S10)

- **S8 · Carteira e andamento.** Importação da planilha XLSX do sistema de gestão do escritório (biblioteca `lib/import` recuperada, com leitor XLSX); casamento por número CNJ; cliente do webservice do Projudi; adaptador do agregador e teste comparativo entre fornecedores; `movements`.
- **S9 · Prazos e protocolo nacional.** Motor de prazos com calendário forense por tribunal e comarca, regra conservadora e fila de confirmação da controladoria; triagem promovida a "com amostra" nas categorias que bateram a meta; construtores de pacote do eproc e do PJe; testes técnicos do posto nesses sistemas.
- **S10 · Cliente informado e venda.** Agenda de audiências (agenda Google dedicada), lembretes e avisos por reservar e enviar, rastreio do processo, alerta de golpe no dia do valor liberado, resumo semanal do sócio; vigia do DJEN e aviso de troca de sistema; cobrança da assinatura (faixas como dado, medição de processos ativos, alertas, troca de faixa, painel de consumo); suporte assistido com cerca nova; console de escritórios; backup adaptado.

Aceite: 30 dias seguidos sem publicação perdida contra o sistema atual do piloto; avisos enviados sem duplicidade, provados por teste de idempotência; um segundo escritório de teste instalado do zero, com cobrança no sandbox.
Demonstração: carteira importada, prazos na fila, audiência com lembretes, e um escritório novo entrando sozinho.

### M4 · Atendimento com IA e Direito do Passageiro (S11 a S12)

- **S11 · Atendimento.** Caixa de conversas com robô ou pessoa no comando; atendente de IA em modo sugestão; checagem de conformidade em toda mensagem; fluxo "não se enquadra" com revisão humana; CRM com origem do lead (inclusive `referral` de anúncio) e follow-ups.
- **S12 · Direito do Passageiro.** Cadastro do passageiro na página do escritório, com autorizações separadas; adaptador de status de voo; monitor nos horários do voo; mensagens informativas do dia; kit de prova com link que registra data e hora; triagem da causa com METAR; atendente com amostragem nas categorias liberadas.

Aceite: conversa do primeiro contato ao contrato com o atendente sugerindo e a pessoa aprovando; voo monitorado gera a mensagem certa no simulador.

### M5 · Números (S13)

`outcomes`; faixa de acordo por companhia; estimativa de tempo até a sentença por grupo de casos parecidos, com margem de erro; relógio do escritório (tempo do tribunal separado do tempo do escritório); painel de volume e semelhança por advogado, juízo e estado; eventos de uso com o vocabulário do ONE.

Aceite: cada número na tela mostra o tamanho da amostra e bate com uma consulta de conferência.

### M6 · Escala para novos escritórios (contínuo, a partir do fim do M3)

Módulo versionado como dado (roteiro, listas de documentos, modelos de peça e de mensagem, prompts), no molde de `guard_module_version`; instalação de escritório em um dia guiada pelo onboarding; migração padrão (importação pela OAB a partir do DJEN e por planilha de qualquer sistema); relatório "raio-x pela OAB" a partir do DJEN; site do ONE; ajuste de desempenho e de custo de IA por escritório.

---

## 9. Qualidade e operação técnica

**Testes**

- pgTAP: toda tabela nova com teste de RLS com dois escritórios; varredura de catálogo que falha se uma tabela com `org_id` ficar sem RLS, sem gatilho de cerca do suporte ou com grant aberto; testes das RPCs de reserva. Runner embutido para o comum; Docker para o que usa pgvector e Vault.
- Unidade: `rules` com casos do domínio escritos como tabela (foro, menor, família, causa externa, prazos com feriado, prescrição de 2 e 5 anos, contagem por estado); validadores; construtores de pacote com arquivos de exemplo.
- Contrato: cada adaptador contra o `fake` e contra respostas gravadas do `real`; teste vivo contra sandbox em agenda separada.
- Ponta a ponta (Playwright): cadastro e convite; caso do link ao pacote; links do cliente; conversa no simulador.
- Avaliação de IA: conjunto de referência por tarefa, nascido do modo sombra; roda no CI quando muda o prompt ou o modelo; meta de acerto por categoria.
- Carga: captura do DJEN para centenas de OABs dentro do limite de taxa; envio de WhatsApp a 20 mensagens por segundo por número.

**CI/CD e ambientes**

- Pull request: lint, typecheck, testes, pgTAP, build e preview na Vercel apontando para o banco de desenvolvimento.
- Homologação: deploy manual, banco próprio, sandboxes reais dos fornecedores; o escritório piloto valida as entregas aqui.
- Produção: deploy manual depois da homologação; migrações aplicadas pelo gate de banco, por ambiente.
- Dados de teste: script de semente com dois escritórios, pessoas, casos e publicações fictícias.

**Observabilidade e alertas**

Logs estruturados sem dado pessoal; rastreamento de erros; painel do Inngest; alertas para: captura do DJEN que não rodou ou tribunal silencioso, job com falhas repetidas, webhook do WhatsApp com erro, custo de IA acima do esperado por escritório, conexão do WhatsApp desconectada (coexistência parada), armazenamento perto do limite.

**Segurança técnica**

RLS em tudo; `service role` confinado a jobs e webhooks, sempre por RPC com o escritório; cofre cifrado; 2FA por papel; auditoria de toda escrita e de toda leitura do cofre; suporte assistido com autorização registrada e cerca de escrita; limite de taxa nos links públicos; checagem de tipo e tamanho de arquivo no upload; auditoria de dependências no CI.

**Privacidade como código**

Consentimento por finalidade com texto congelado; política de retenção por tipo de dado executada por job (por exemplo, dados de quem não se enquadra e áudios); exportação e exclusão por pessoa; marcação de dado de menor; provedores de IA configurados sem retenção; nenhum rastreador na área logada nem nos links do cliente.

**Backups**

PITR do Supabase e cópia do storage como recuperação principal; backup lógico em fluxo, sem o cofre; ensaio de restauração a cada trimestre.

---

## 10. Forma de trabalho da equipe técnica

- **Papéis** (com três pessoas): plataforma e dados (banco, RLS, jobs, cobrança); integrações (WhatsApp, tribunais, assinatura, voo); produto e IA (telas, executor, avaliações). Uma delas responde pela arquitetura e revisa migrações.
- **Quadro:** épicos por marco; histórias com critério de aceite testável; nada entra na sprint sem o adaptador `fake` necessário.
- **Definição de pronto:** testes passando (incluindo RLS com dois escritórios para tabela nova), auditoria nas mutações, sem dado pessoal em log, documentação do pacote atualizada, regras do harness respeitadas, demonstrável em homologação.
- **Revisão de código:** uma aprovação por pull request; migração e RLS sempre revisadas pela pessoa de plataforma.
- **Harness de agentes:** `CLAUDE.md` e `.claude/rules` do ONE (sem as regras da flyee), skills de tela e de verificação adaptadas, e regras novas cobradas por hook: tabela nova exige teste de RLS; nenhuma coluna de credencial de advogado; adaptador novo exige `fake` e teste de contrato.
- **Ritmo:** planejamento e demonstração a cada sprint; o piloto usa a homologação e devolve o que encontrou.
- **Flags por escritório** para liberar funcionalidades primeiro no piloto.

---

## 11. Riscos técnicos e mitigação

| Risco | Mitigação |
|---|---|
| Vazamento entre escritórios por `service role` sem filtro | RPCs que recebem o escritório; varredura de catálogo; teste com dois escritórios em tudo; nenhuma ferramenta de IA com o cliente de serviço |
| Limites da Vercel (60 s por passo, 4,5 MB por requisição) | Upload direto ao storage; jobs em passos; teste técnico no M1 para decidir o trabalhador de PDF |
| DJEN fora do ar, lento ou sem teor | Recuo exponencial, vigia diário, segunda fonte (Projudi e agregador), captura assistida do teor |
| Tribunais trocando de sistema (RJ, PR, MS) | Tabela de sistemas como dado, detector pelo endereço dos links, construtor de pacote por sistema |
| Mudanças da Meta (versões da Graph API, Embedded Signup) | Versão como configuração; testes de contrato; simulador local |
| Mudanças de modelo de IA e recusas | Interface de provedor; conjuntos de referência no CI; tratamento de recusa |
| Código do histórico nunca provado em produção | Portar como molde, com testes antes de usar |
| pgvector e Vault fora do runner embutido | Caminho com Docker no CI para essas migrações |
| Escopo crescendo dentro dos marcos | Aceite e demonstração por marco; módulo como dado; o que não está no marco vai para o próximo |
| Custo de IA acima do previsto | Custo por escritório e por caso desde o M1; lote noturno; modelo menor onde a avaliação permitir |

---

## 12. Primeiras duas semanas (S0), tarefa por tarefa

1. Trocar `apps/web/.env.local` por um arquivo que zere todas as chaves; tirar `apps/web/.env` da pasta.
2. Tirar `Bash(node:*)` de `.claude/settings.json`; deploy só por `workflow_dispatch`; renomear `project_id` e portas em `supabase/config.toml`.
3. `npm install` na raiz e primeira rodada de `npm run ci:verify` para registrar o estado.
4. Resolver a refatoração pela metade e a regra `mui-on-public` até o pre-commit passar.
5. Criar o repositório novo do ONE a partir da árvore atual, sem histórico.
6. Reescrever `CLAUDE.md`, `apps/web/CLAUDE.md` e `.claude/rules` para o ONE; `npm run harness:sync` e `npm run harness:test`.
7. Remover CLI, OAuth e catálogo (anotando os três moldes antes); depois as telas do clube; depois os consoles da flyee; `ci:verify` verde a cada fatia.
8. Desligar `/admin/insights`; tirar `DashboardTrackers` da área logada.
9. Corrigir o provedor da Anthropic (sem `temperature`, sem `tool_choice` forçado, SDK atual) com testes.
10. Esqueleto dos adaptadores: interface, `fake` e teste de contrato vazio em `courts`, `whatsapp`, `signatures`, `flights`, `identity`.
11. Levar o script de amostragem do DJEN para `scripts/djen-systems.mjs`, para semear `court_systems`.
12. Configurar o CI no GitHub Actions e os projetos Supabase de desenvolvimento e homologação.
13. Rascunho das migrações do M1 (escritório, função, convites, OABs) com o teste pgTAP de dois escritórios escrito primeiro.

---

## Apêndice A · Entradas técnicas por adaptador

O que cada adaptador precisa para sair do modo `fake`. O desenvolvimento não espera por nenhuma delas.

| Adaptador | Para desenvolver | Para homologação |
|---|---|---|
| Supabase | Projeto local | Projetos de desenvolvimento e homologação |
| Inngest | Servidor local de desenvolvimento | Chave do ambiente |
| Anthropic | Chave de desenvolvimento | Chave do ambiente, sem retenção |
| WhatsApp | Simulador local; app de desenvolvedor da Meta com número de teste | App com acesso de Tech Provider e o número do piloto |
| ZapSign | Fake; sandbox | Token da conta do escritório |
| Serpro CPF | Fake; ambiente de demonstração | Credencial de produção |
| DJEN | Sem chave | Sem chave |
| Projudi TJGO | Sem chave | Sem chave |
| Agregador | Fake | Chave do fornecedor escolhido no teste comparativo |
| AeroDataBox | Plano gratuito para desenvolvimento | Plano que permite servir vários escritórios |
| REDEMET | Chave gratuita | A mesma |
| Transcrição | Chave de teste dos dois candidatos | Chave do escolhido |
| Google Agenda | Projeto em modo de teste | Projeto publicado com o escopo restrito |
| Asaas | Sandbox | Conta de produção do ONE |
| Resend | Sem chave (não envia) | Chave do domínio do ONE |

## Apêndice B · Convenções

- Eventos do Inngest com prefixo `one/` e o id de cliente `one`.
- Toda tabela de domínio tem `org_id`, `created_at`, `updated_at`, RLS e grants explícitos na migração.
- Helpers de RLS: `is_org_member(org)`, `has_org_role(org, papéis)`, `has_firm_function(org, funções)`.
- Toda mutação grava `audit_events` com o tipo de ator.
- Configuração de negócio em tabela, lida por função do servidor; nunca em constante.
- Nomes de tabela e coluna em inglês; textos de tela em pt-BR.
