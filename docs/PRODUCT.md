# flyee.club — organização, diferenciais e próximos passos

Sep 30, 2026 · @Dev

> **Status:** PRD provisório, movido de `attachments/` em 2026-09-30. Este repositório é a **plataforma** do flyee.club. O **produto** (CLI `npx flyee`, core do harness e conteúdo dos módulos) é um projeto separado que consome a API e o manifesto definidos aqui. As decisões de 2026-09-30 valem sobre o texto original quando houver conflito, e as de 2026-10-06 valem sobre as de 2026-09-30. Plano de execução: [`docs/PLANO-IMPLEMENTACAO.md`](PLANO-IMPLEMENTACAO.md).

## A ideia organizada

O FlyeeClub é um clube com um acesso de pagamento único (o plano "FlyeeClub") e uma assinatura por cima (o "FlyeeClub Pro"): o integrante instala o seu harness na IA que já usa e recebe, continuamente, as ferramentas e as atualizações que mantêm tudo funcionando quando Claude, Codex ou as APIs mudam. A cada 30 dias sem atualizar, ele volta ao painel para revalidar o token, e é lá que vê o próximo degrau.

**Tese em uma frase (proposta):** a IA muda toda semana; o flyee.club é o clube que mantém suas ferramentas funcionando e melhorando, na IA que você já usa, em português e inglês.

**O que o integrante recebe**

- **Harness flyee:** um `agent.md` que centraliza skills, workflows e rules e torna cada ferramenta agnóstica de IA (Claude Code, Codex, Gemini CLI, Cursor e o que vier).
- **Catálogo inteiro, desde o kit:** frameworks, skills e workflows, cada um com página própria no painel. O kit de entrada não limita ferramentas nem atualização; limita acesso (1), aulas avançadas, voto no roadmap e encontros.
- **Atualização como produto:** quando a IA muda, a ferramenta muda; a cópia de quem saiu envelhece. Atualizar exige um token válido, revalidado no painel a cada 30 dias sem uso.
- **Aula de uso:** vídeo curto por ferramenta, em português e inglês desde o início; aulas avançadas só na assinatura. *Revisado em 2026-10-06: guia escrito no pacote de cada versão, com vídeo opcional dentro dele (ver "Guias").*
- **Receitas:** fluxos que encadeiam ferramentas até um resultado.
- **Novidades:** o que mudou nas IAs e o que isso muda nas ferramentas.

**O que ele não é:** curso com começo e fim, comunidade de networking, marketplace de terceiros, nem ferramenta que gasta crédito de IA do seu lado: o integrante usa o próprio plano ou API.

**Sua vantagem de origem:** cada ferramenta nasceu em produção (MedChina, radar de conteúdo, pipeline de vídeo, o próprio harness). É o que separa o clube de quem monta ferramenta para vender ferramenta.

## Decisões tomadas 2026-09-30

Registradas ao transformar a base copiada do MedChina na plataforma do flyee.club. O detalhe técnico de cada uma está em [`docs/PLANO-IMPLEMENTACAO.md`](PLANO-IMPLEMENTACAO.md).

**Fronteira entre plataforma e produto**

| Peça deste documento | Onde nasce | Observação |
| --- | --- | --- |
| Painel flyee.club: login, pagamento em BRL e USD, vitrine, aulas, receitas, changelog, perfil, revalidação do token | Plataforma (este repositório) | Escopo atual |
| Servidor de pacotes: valida token e plano, entrega a versão com checksum, registra instalação e uso | Plataforma (este repositório) | API `/api/cli/*`; contrato em `docs/CLI-CONTRACT.md`, escrito na fase 3 do plano |
| Schema do manifesto `flyee.module.json` | Plataforma (este repositório) | Pacote `packages/catalog`, criado na fase 3; o produto o consome |
| Métricas por segmento, lista de espera, newsletter, encontros, roadmap votado | Plataforma (este repositório) | Escopo atual |
| Instalador `npx flyee`, core do harness, módulos e receitas como arquivos | Produto (projeto separado) | Fora deste repositório; consome a API e o manifesto |
| Harness de desenvolvimento deste repositório (`.claude/`, hooks, skills) | Ferramenta interna da plataforma | Nunca distribuído; skills de terceiros ficam só aqui |

**Decisões**

| Tema | Decisão |
| --- | --- |
| Base | Este repositório não tem mais vínculo com o template flyee. O escopo npm `@flyee/*` continua, porque flyee é a marca. |
| Banco | Projeto Supabase novo, com um conjunto enxuto de migrações escrito do zero só com o que é genérico. |
| Pagamento | Asaas para BRL e Stripe para USD, escolhidos pela moeda de cada compra. |
| Site público | Completo desde já, bilíngue e indexado: português em `/`, inglês em `/en`, com textos provisórios. |
| Marca | Nome flyee.club. Logo oficial entregue em 2026-10-01 (`apps/web/public/brand/`). Tipografia definida na mesma data: Londrina Solid nos títulos, JetBrains Mono em comandos e Mulish no texto. Paleta ainda provisória: o tema laranja do template, até a paleta do flyee.club virar tokens. A TT Chocolates, licenciada para o MedChina, saiu. |
| "1 acesso" | Limite de dispositivos por degrau: kit 1, assinatura 3, Pro 5. |
| Canal de atualização | O mesmo para todos na v1. A separação entre estável e latest fica preparada para depois de medir a conversão kit → assinatura em 60 dias. |
| Segmentos | Produto próprio, freelancer ou agência, profissional que usa IA todo dia, dev, e "outro" para quem não se encaixa. "Outro" não entra na regra de foco. *Revisado em 2026-10-06: os segmentos passaram a ser os perfis do site (negócio, agência, produto digital, dev e outro), migração `0028`.* |
| Console de perguntas ao banco | `/admin/insights` continua, com uma chave de IA paga pelo operador. Não gasta crédito do integrante. |
| Vídeos das aulas | YouTube não listado para todas as aulas, inclusive as avançadas. A plataforma só entrega o id do vídeo avançado a quem tem direito; um link repassado continua assistível, e esse risco está aceito. *Revisado em 2026-10-06: o guia passou a ser escrito, no pacote; o vídeo, quando há, é opcional e fica dentro do guia, com a mesma regra de acesso.* |
| Nota fiscal | Emitida direto no Asaas. A plataforma não tem lógica fiscal. |
| Encontros | Por link externo (Zoom, Meet ou transmissão). O painel guarda o link e conta o clique em "entrar" como presença. |
| Endereços em inglês | Traduzidos já na v1: `/en/pricing`, `/en/how-it-works`, `/en/catalog` e assim por diante. |
| Termos de uso, privacidade e cookies | Considerados revisados. Entram como versão 1 nos dois idiomas, sem marca de provisório. |

**Premissas adotadas no plano (confirme ou corrija)**

- ~~O kit concede acesso e atualização sem prazo.~~ Revisado em 2026-10-06 pelo brief da home: o kit vale por 1 ano a partir do pagamento, sem renovação automática, e é renovado comprando de novo (o novo prazo começa quando o atual termina); pode ser parcelado no cartão; todo plano pago pode ser usado em projetos de clientes; o reembolso continua pelo suporte. Quem assina sem ter comprado o kit e cancela perde a atualização; a tela de cancelamento oferece o kit para mantê-la.
- O Pro é uma família de plano própria, não um complemento da assinatura.
- Máquinas sem navegador entram pelo fluxo de código de dispositivo, com as mesmas regras de token: 30 dias sem update e revogação no cancelamento.
- Eventos de uso ficam numa tabela do próprio Supabase e são lidos em `/admin/metricas`. PostHog não entra.
- Uma conta corresponde a um integrante. Planos por assento ficam para o degrau 5.
- Vendas em USD pela Stripe: se a nota de exportação for exigida, o operador a emite no Asaas; a plataforma não automatiza.
- A assinatura anual em USD vale 10 vezes a mensal, como hipótese.
- Só o site público usa endereços com idioma. O painel do integrante, o admin, o login e o checkout seguem o idioma do perfil, sem `/en`, porque não são indexados.

**Ordem.** Este documento recomenda vender o kit antes de construir o painel. O plano respeita isso: a página de espera é o primeiro deploy e o checkout do kit vem antes do painel completo, então a pré-venda pode começar enquanto o resto da plataforma avança. Construir não é abrir: os planos de assinatura podem ficar ocultos e o card de upsell desligado até o portão destacado da fase 2 (ver "Etapas").

## Decisões tomadas 2026-10-06

Registradas no alinhamento do repositório do produto com a plataforma. O que cabe à plataforma está detalhado na fase 9 de [`docs/PLANO-IMPLEMENTACAO.md`](PLANO-IMPLEMENTACAO.md); o que cabe ao produto fica no repositório dele.

**O nome e a escada (alinhamento com o brief da home, opção 1)**

| Tema | Decisão |
| --- | --- |
| Nome | A plataforma se chama **FlyeeClub**. O domínio continua flyee.club e a CLI continua `npx flyee`. |
| Dois planos | O acesso de pagamento único é o plano **"FlyeeClub"**, e é ele que todo CTA vende ("Assinar FlyeeClub agora"). A assinatura é o **"FlyeeClub Pro"**: guias avançados, receitas, encontros, voto, a camada "abrir o capô" (herdada do Pro) e 3 máquinas. O Pro de antes saiu da vitrine: linhas `pro-*` inativas, sem apagar (migração `0025`). |
| Ofertas depois da compra | Quem tem o FlyeeClub recebe a oferta do FlyeeClub Pro no painel e na revalidação. O app sob medida, a mentoria remota e a consultoria completa não são planos: são contratados sob demanda, oferecidos no painel a quem já paga e pedidos pelo formulário de contato (`/contato?assunto=app`, `mentoria` ou `consultoria`). |
| Medição da home | Opção 1 (2026-10-06): a postura da plataforma fica (`docs/TRACKING.md`): Pixel e GA4 com opt-out, `product_events` só para uso de integrante, visitas por porta no servidor. Os eventos da seção 8 do brief viram eventos custom do GA4 pelo `lib/site-events.ts` (declarados com `data-track` nos elementos e `track` nas seções), sem PostHog e sem tabela `events`. O `segment` é capturado por link (`?segment=`) ou clique e pré-preenche a lista de espera, o cadastro e o onboarding ; desde a migração `0028` os perfis do site e os segmentos são um vocabulário só (ver "Segmentos"). |
| Preço e vagas | Opção 1 (2026-10-07): a regra 5 do brief (sem preço riscado, "de/por", contagem regressiva ou "vagas" na página) vira regra da plataforma inteira para o preço e fica restrita à página da oferta para as vagas. Nenhum card risca o preço de tabela, nem na home, nem em `/planos`, nem em `/fundadores`, nem no painel: com cupom, o card mostra só o preço cobrado e nomeia o cupom ("Com o cupom X"). O card de fundador mostra o preço de fundador sozinho, sem o preço anual riscado nem a porcentagem de economia; o preço normal está em `/planos`. O contador de vagas e a data limite, lidos do banco (`founders_offer()`), ficam só em `/fundadores`; `/planos` diz apenas que o preço de fundador está aberto e leva à oferta. O campo de âncora saiu do console da oferta. A mensagem do painel que confirma um cupom continua dizendo o desconto e por quantos ciclos ele vale, porque é termo do cupom e não comparação de preço. A economia do plano anual sobre o mensal continua no seletor de ciclo, calculada dos preços reais, porque compara dois ciclos à venda e não risca nenhum preço. O teste `apps/web/src/lib/honest-pricing.test.ts` segura a regra. |
| Regras de texto | Opção 1 (2026-10-07, migração `0035`): as regras de texto do brief valem para todo texto que visitante e integrante leem, nos dois idiomas: site, painel, checkout, e-mails, sino, mensagens da CLI, a descrição da fatura do provedor e os textos legais em vigor. Nada de travessão (— ou –), ponto de exclamação ou emoji (© e → ficam, de propósito), nem das palavras proibidas: desbloqueie, potencialize, sem esforço, soluções inovadoras; unlock, elevate, empower, seamless, robust, supercharge, game-changing, "it's not just". Onde caberia um travessão vai dois-pontos, vírgula ou frase nova, e "·" separa itens. O console do operador fica fora. Três testes seguram a regra: `apps/web/src/lib/i18n/copy-rules.test.ts` (catálogos, copy da home, e-mails, sino, CLI e o resto do código que chega às pessoas), o pgTAP `0033_copy_rules` (o que as migrações semeiam, os textos legais em vigor entre eles) e o e2e, que lê o texto renderizado das páginas públicas e de entrada. Os termos de uso em inglês (versão 5) e o termo de conexão da CLI em inglês (versão 2) trocaram "unlocks" por um verbo comum; os textos em português não mudaram. O que o operador escreve no console (blog, ajuda, avisos, textos dos apps, descrição dos planos) segue a mesma regra, ainda sem checagem automática. |
| Selos da loja | Opção 1 (2026-10-06, migração `0034`): os dois selos dos cards vêm dos dados. "Novo" aparece quando a primeira publicação do app tem até N dias (N em `platform_settings.catalog.new_badge_days`, 30 para começar, editável na aba Categorias da loja). "Usa sua conta X" usa os nomes das credenciais obrigatórias que o operador cadastra no app (`lib/catalog/store-badges.ts`). Os dois já aparecem nos cards da home e de `/catalogo`, e o banner de destaque os usa quando a home for refeita pelo brief. |
| Próximos na loja | Opção 1 (2026-10-06, migração `0033`): o bloco do brief é alimentado pelo roadmap, com dois dados novos. O mês em que uma ideia foi a mais votada é registrado quando o operador a planeja pelo card do mais votado. A marca "contratado" é posta pelo operador numa ideia vinda de um pedido pago. Uma leitura pública (`roadmap_coming_next`) entrega só as ideias planejadas e em construção, e cada uma leva um selo, o mais específico que for verdade (`lib/roadmap-coming-next.ts`): "Em desenvolvimento, sai para todos" para as contratadas, "Mais votado de {mês}", "Em produção" e, para as planejadas sem outro selo, "Planejado", que o brief não tinha. O bloco some quando não há nenhuma ideia e entra quando a home for refeita pelo brief; a home atual não o tem. |
| IAs prometidas | Opção 1 (2026-10-06): o site promete as quatro IAs de terminal (Claude Code, Codex, Gemini CLI e Cursor), com o plano ou a chave de API do integrante, e diz que a página de cada app mostra em quais ele foi testado (o `compatible_ais` do manifesto). O requisito do brief ("Um plano pago do Claude com Claude Code, ou do ChatGPT com Codex") passa a ter esse texto na home refeita, coerente com os quatro logos do hero. Os dois níveis "testado" e "compatível pelo padrão" continuam na fase 10. |
| Botões | Opção 1 (2026-10-06): os botões de compra do acesso dizem "Assinar FlyeeClub agora" (hero, card do FlyeeClub, CTA final, rodapé), e o card do FlyeeClub Pro diz "Assinar FlyeeClub Pro". O botão do topo mantém o texto do brief, "Quero montar meu sistema", e não é compra: leva aos planos (na home, rola até a seção de preços). Antes da abertura da loja, todos dizem "Entrar na lista de espera" (`lib/launch.ts`, `primaryCtaFor` e `navCtaFor`). |
| Para quem é | Opção 1 (2026-10-06, migração `0032`): o operador marca, em cada app, os perfis do site para os quais ele é um bom começo (negócio, agência, produto digital, dev; nunca "outro"), no console, como a categoria da loja e fora do manifesto. O bloco "Para quem é" da home do brief mostra até 3 apps publicados por perfil, na ordem do catálogo (`lib/catalog/starters.ts`); perfil sem app marcado fica sem chips. Os apps escritos à mão no brief (Copy LP, Radar e outros) não aparecem enquanto não forem publicados. O bloco entra quando a home for refeita pelo brief; a home atual não o tem. |
| App contratado | Opção 2 (2026-10-06, migração `0031`): o app desenvolvido sob demanda entra na loja para todos os integrantes quando fica pronto, salvo acordo de exclusividade combinado por escrito no contato antes da contratação. O preço e o prazo da exclusividade ficam fora da plataforma. O aviso aparece onde a contratação começa (o card "App sob medida" do painel, o card do roadmap e a página de contato aberta para um app) e na cláusula da versão 4 dos termos de uso. O FAQ do brief ("Se outra pessoa pagar por um app, eu recebo também? Recebe.") passa a ser verdade, com essa ressalva. |
| Equipes | Opção 1 (2026-10-06): o FlyeeClub Pro libera mais computadores para a mesma pessoa (o teto é `plans.limits.devices`, hoje 3), nunca mais pessoas. Os termos já proíbem compartilhar o acesso. Equipe é assunto do contato até existir um plano por pessoa (o degrau "Time", depois). O FAQ de `/planos` responde "Tenho uma equipe. Como faço?" assim. Na home refeita pelo brief, essa resposta substitui a do brief ("o completo libera mais acessos"), e a linha de acessos da tabela mostra "Até N computadores" lido do plano, no lugar de "Mais de um". |
| Sem terminal | Opção 1 (2026-10-06): o FAQ "Funciona no app do Claude ou do ChatGPT, sem terminal?" continua respondendo "Ainda não", como a home já faz, e não o "Sim" do brief. Hoje a entrega é só pela CLI. A porta MCP da fase 10.5 não muda a resposta sozinha: ela lê catálogo, guias e conta, mas não executa apps. A resposta muda só quando um app rodar de fato sem terminal (por exemplo, skills enviadas para a conta). |
| Guias | Opção 1 (2026-10-06, migração `0030`): o guia de cada app é escrito e viaja no pacote de cada versão (`guides/<pt-BR|en>/<usar|abrir-o-capo>.md`), então nunca descreve um app diferente do instalado. O painel mostra o guia da versão instalada e avisa quando sai uma mais nova. O vídeo, quando há, fica dentro do guia. "Guias avançados" é a profundidade "abrir o capô", no FlyeeClub Pro, e o vocabulário passou de "aula" para "guia". Ficou como convenção de caminho, e não como campo do manifesto, porque um campo novo exige `manifest_version` novo e a v2 já está reservada para `automation` e `requires`. |
| Dúvidas no app | Fica para o fim (2026-10-06): o dono do produto quer um suporte com agente de IA integrado, que só faz sentido com a plataforma completa. Vira a fase 11 de `docs/PLANO-IMPLEMENTACAO.md`. Até lá, a home não promete perguntas na página do app. |
| Categorias da loja | Opção 1 (2026-10-06, migração `0029`): duas camadas. As 7 etapas continuam sendo a taxonomia do catálogo (o manifesto declara a etapa; painel, roadmap, regra de uso amplo e API da CLI seguem nelas). A loja pública (home e `/catalogo`) filtra por categoria, os tipos de trabalho do brief: Vender, Divulgar, Vídeo, Pesquisa e Construir, dados editáveis no console e fora do manifesto (mudar a categoria não pede versão nova). App sem categoria aparece só em "Todos". Exemplo: o app de edição de vídeo fica na etapa Divulgar ("fazer o produto ser encontrado") e na categoria Vídeo. |
| Segmentos | Opção 1 (2026-10-06, migração `0028`): os segmentos são os perfis do site, "Seu negócio", "Sua agência", "Seu produto digital" e "Seu trabalho de dev" (`negocio`, `agencia`, `produto`, `dev`), mais `outro`, que fica fora da regra de foco. "Profissional que usa IA" saiu: o site não o oferece. Onboarding, lista de espera, métricas, regra de foco e o resumo de segunda falam a mesma língua do site. |
| App sob medida | Opção 1, o mínimo honesto (2026-10-06, migração `0026`): no FlyeeClub Pro, o integrante propõe o app no roadmap (`propose_roadmap_item`); a proposta fica em análise, visível só ao autor e ao operador, com teto de propostas em análise em `platform_settings.roadmap`; o console abre para votos ou recusa. O roadmap mostra o mais votado do mês (votos dados no mês entre as ideias abertas, `roadmap_month_leader`), que o operador planeja na virada do mês. Contratar direto é o formulário de contato, sem cotação na hora, pagamento ou acompanhamento no painel. A home diz só isso; o bloco "App sob medida" do brief perde a faixa de valor, o pagamento e o acompanhamento. |

**O repositório do produto**

| Tema | Decisão |
| --- | --- |
| Onde nasce | `C:\AppsProjects\flyee`, um monorepo privado separado deste: a CLI, o core do harness e os apps. Consome só `docs/CLI-CONTRACT.md` e o JSON Schema do manifesto publicado em `/api/cli/schema/module`; nunca importa código desta base. |
| O que vai ao npm | Só a CLI, no pacote público `flyee`, que já pertence ao operador (hoje em 0.7.9, de um projeto anterior). A CLI nova sai como `1.0.0` nesse nome, e `platform_settings.cli.min_cli_version` sobe para `1.0.0` no dia da publicação. |
| O que não vai ao npm | Os apps. Cada app é um ZIP com `flyee.module.json`, enviado ao servidor de pacotes da plataforma e entregue pelo token. A versão de cada app vive no manifesto e numa tag do git do produto; o `files` do manifesto é gerado pela ferramenta, nunca escrito à mão. |
| Publicação de versões | Na v1 a CI do produto gera e valida os ZIPs e o operador os envia pelo console `/admin/catalogo`; publicar, marcar estável e retirar continuam ações do console. Um token de serviço para o `POST /api/admin/catalog/versions` fica como pedido do produto à plataforma, para a CI enviar os rascunhos sozinha. |
| Arquivo de entrada do harness | `AGENTS.md` canônico, gerado pelo core em blocos marcados, com ponteiros de uma linha em `CLAUDE.md` (`@AGENTS.md`) e `GEMINI.md` (`@./AGENTS.md`); o Cursor lê o `AGENTS.md` da raiz. Skills de cada app em `.agents/skills/` (Codex, Gemini CLI e Cursor leem aí) com pontes em `.claude/skills/` para o Claude Code, sempre cópias, nunca symlinks. Uma cópia só dos arquivos do app, em `.flyee/modules/<slug>/`. |
| `/flyee` dentro da IA | O core instala uma skill `flyee` que funciona como menu dentro do Claude Code, Codex, Gemini CLI e Cursor: apps instalados e disponíveis, atualizar, guia de cada app, novidades e abrir o painel local. Ela só roda a CLI com `--json`, nunca inventa estado. |
| Painel local | `npx flyee ui`: um servidor em `127.0.0.1` que serve uma página estática com o estado do projeto (apps, versões, conexão, revalidação, credenciais externas, documentação e ofertas lidas da plataforma). Em avaliação de escopo; depende de a plataforma publicar `packages/design-tokens` como pacote npm público, para o painel usar o mesmo sistema de design sem levar código licenciado. |
| Primeiro app | Um app de edição de vídeo, construído primeiro para uso do próprio operador e lançado com o vídeo que o apresenta. A lista de módulos iniciais da seção "Arquitetura da entrega" e a tabela "Catálogo por etapa" passam a ser referência histórica, não compromisso: os apps citados ali serão refeitos ou atualizados quando entrarem. |

**O integrante não usa o terminal**

- A IA do integrante roda todo comando do flyee. Ele só confirma na conversa o que a IA vai fazer, aprova o login no navegador e cola chaves de serviços externos numa página que abre no navegador dele.
- Programas que os apps usam (ffmpeg, yt-dlp…) são instalados pela CLI, pelo gerenciador de pacotes do sistema, sem perguntas além da confirmação do app (`npx flyee need`; o `add` e o `update` instalam o que o app declara). O que só o integrante pode dar, como a senha de administrador no Linux, volta como um passo único.
- Isso vale para os textos da plataforma também: a página "como funciona", o painel e os e-mails dizem o que pedir à IA, e o comando aparece só como referência, nunca como tarefa do integrante. `/instalar.md` (fase 10.3) é a porta de entrada que já segue essa regra.

**O degrau grátis é uma versão, não uma cópia**

| Tema | Decisão |
| --- | --- |
| Modelo | O direito passa a ser por versão, por canal. O plano gratuito fica no canal `free`: baixa e mantém só a versão de cada app marcada como grátis no console. Kit, assinatura e Pro continuam no canal `latest`. Um app inteiro grátis continua possível pela flag `is_free_sample` do módulo, mas é exceção. |
| Qual versão é grátis | Marcação manual, por versão, no console; a primeira versão publicada de um app vem pré-marcada. Marcar outra move o degrau grátis; retirar a versão grátis exige marcar outra. A regra comercial nunca entra no manifesto. |
| Congelamento | A versão grátis nunca recebe atualização porque não há versão nova no canal `free`, não porque a plataforma a bloqueie. A conta sem compra roda `npx flyee update`, renova o token e não recebe nada. É a tese "a cópia envelhece" aplicada ao degrau zero. |
| A distância é visível | O catálogo passa a devolver também a versão mais nova de verdade (`newest`), e a conta sem compra vê, na CLI e no painel, quantas versões está atrás e o changelog do que não tem. Pedir uma versão fora do canal responde `denied_entitlement` com o link de upgrade e grava `update.denied_entitlement`. |
| Lançamento de um app | No dia do vídeo, a 1.0 é a última. Nos apps principais, a 1.0 nasce deliberadamente reduzida e a 1.1 sai no mesmo dia com a fatia completa: a versão grátis vira uma tag antiga no git, nunca mantida em paralelo. Nos apps menores, a paridade inicial é aceita, porque a venda é a loja inteira e as atualizações. |
| O que não existe | Teste grátis do acesso completo (`trial_days` fica em 0), cupom ou desconto por vídeo, e duas versões completas de um mesmo app. |

**O plano gratuito nunca é oferecido**

- Ninguém "assina grátis". A conta sem compra é consequência de um cadastro que veio do conteúdo (o link de um vídeo) ou da mensagem do instalador; ela nunca é vendida, anunciada ou listada: nenhum botão, coluna de preço, selo ou texto público oferece um plano gratuito ou uma "conta grátis". O plano `gratuito` continua com `is_public = false`.
- O site público não anuncia versões grátis nem "amostra grátis". O que a conta sem compra pode instalar aparece dentro do painel, depois do cadastro, com o cadeado e a oferta do kit no resto.
- Dentro do painel, o degrau sem compra é descrito pelo que é ("sem acesso ao catálogo", "versão de entrada"), nunca como um plano com nome comercial.

**O funil de conteúdo**

| Passo | Como funciona na plataforma |
| --- | --- |
| O vídeo entrega o método completo | Decisão de conteúdo: vídeo que para no problema é teaser. O que se vende é o app pronto, as atualizações e a loja. |
| Um link por vídeo | `/catalogo/<slug>?origem=youtube&utm_campaign=<id do vídeo>`: a primeira visita grava a origem num cookie de 90 dias e o cadastro a copia para `signup_attribution`; `account.created` leva `origem`. É o que diz qual vídeo vende. |
| A conta sem compra é o lead | Substitui a skill por e-mail: o cadastro já confirma o endereço e registra segmento, IA, idioma, máquina e instalação, que uma lista de e-mail não registra. A newsletter continua para quem não quer criar conta. |
| `npx flyee add <app>` sem login | A CLI mostra "este app faz parte do acesso flyee.club" e o link da página pública do app, com `origem=cli`, vindo do servidor (a CLI nunca monta URL da plataforma). A origem possível aqui é `cli`; o vídeo só é identificado pelo link da descrição. |
| Conta sem compra pedindo um app pago | O servidor já responde `denied_entitlement` com a mensagem no idioma e o link de upgrade, e grava `update.denied_entitlement`. |
| A revalidação traz de volta | A conta sem compra tem o mesmo token de 30 dias; `/revalidar` mostra a oferta do kit. |
| Arrependimento | Os 7 dias são obrigatórios pelo CDC e têm o mesmo efeito de um teste para quem quiser copiar; o risco está aceito pela tese da cópia que envelhece. |

**Apps com pipeline e execução automática**

| Tema | Decisão |
| --- | --- |
| Pipeline dentro do app | Um app de tipo `workflow` é uma pipeline empacotada: passos de script e passos de IA, arquivos de entrada e saída, estado por execução em `.flyee/runs/<app>/<id>/`. A mesma definição roda dentro da sessão da IA, que executa os passos de IA inline, e fora dela, pela CLI. O app continua sendo um app; personas e subagentes, quando existirem, são detalhe de implementação invisível para quem instala. |
| Duas metades | A metade automática não tem ponto de aprovação; toda decisão fica para a metade sob demanda, que recebe o material pronto em arquivo. Exemplo: às 7h, buscar e pontuar notícias e escrever o material; depois, com o integrante presente, escolher a pauta e escrever o roteiro com aprovações. |
| Disparo | Local, nunca pela plataforma: `flyee schedule <app>` registra a tarefa no Agendador do Windows, no `launchd` ou num timer do `systemd`; `flyee run <app>` executa; tarefa perdida roda na próxima oportunidade. Passos de IA sem supervisão usam a IA do integrante em modo não interativo, com as permissões do manifesto como lista de ferramentas liberadas. Sem processo residente e sem agendadores em nuvem de fornecedor. |
| Custo e consentimento | A metade automática gasta a IA do integrante sem ele presente: é opcional, com horário confirmado na instalação, visível no painel e desligável. Todo app declara quais passos usam IA; onde não há raciocínio, o passo é script puro. |
| Manifesto v2 | Campos novos, só quando o primeiro app automático ou com dependência chegar: `automation` (horário sugerido, uso de IA sem supervisão, o que lê e escreve), `requires` (dependência entre apps) e `example_prompt` ("peça assim"). Propriedade de evento `trigger` com `scheduled` ou `manual`. |

**Compatibilidade, qualidade e distribuição** (aprendido do agency-agents e do goose-skills)

| Tema | Decisão |
| --- | --- |
| Registro declarativo de ferramentas | O core tem uma tabela de ferramentas, não adaptadores escritos à mão: por ferramenta, como detectar, onde escrever, em que formato, em que escopo (projeto ou usuário) e a regra para arquivo alheio (nunca sobrescrever; anexar bloco gerenciado ou registrar que pulou). Adicionar uma ferramenta é uma linha de dados. |
| Dois níveis de compatibilidade | "Testado": as IAs declaradas em `compatible_ais`; no lançamento, Claude Code, Codex, Gemini CLI e Cursor. "Compatível pelo padrão": toda ferramenta que o core detecta e atende por `AGENTS.md` e `.agents/skills`, instalada sem promessa e reportada como `other`; no lançamento, GitHub Copilot, OpenCode, Antigravity, Kimi Code, Windsurf e Aider. Promoção: 30 máquinas vivas numa ferramenta por 4 semanas seguidas a levam ao enum, à matriz de testes e à página de compatibilidade. |
| Avaliação e canário | Todo app leva `tests/eval.json`: casos com prompt, fixtures, asserções e rubrica para um juiz. Roda antes de publicar uma versão e como canário: diário no Claude Code e no Codex, semanal no Gemini CLI e no Cursor, e a matriz inteira quando a versão de uma IA muda. De 3 a 5 casos por app, para caber no plano do operador. Toda falha de suporte vira um caso. |
| Instalação por URL | `flyee.club/instalar.md`: a pessoa cola o endereço na IA, que explica o que vai fazer, pede confirmação, roda só `npx flyee@latest`, confere com `flyee doctor --json` e manda reiniciar a IA. É a resposta ao "nunca abri um terminal". |
| Índice e importação | O repositório do produto gera um índice de apps a partir dos manifestos e READMEs. O primeiro app entra pelo console; a importação do índice pela plataforma, com o token de serviço, entra antes do segundo app. |
| `/flyee` como roteador | Responde "o que você quer fazer?" com os apps certos, inclusive os com cadeado, gerado do catálogo. |
| Metadados por ferramenta | O core gera, de uma fonte só, o `agents/openai.yaml` do Codex, as flags do Cursor e o `whenToUse` do Kimi. |
| Regras de autoria | App com chave externa sempre tem um modo sem a chave que entrega algo. Todo app traz um prompt de exemplo. Descrições de skill têm teto de tamanho, porque entram no contexto de toda sessão; o `/flyee` liga e desliga apps por projeto. |
| Perfil de instalação | `flyee.apps.json` exportável e aplicável com `npx flyee add --from`, para repetir a mesma instalação em projetos de cliente. |
| Porta MCP | Entra no plano em duas partes. Um servidor MCP local dentro da CLI, com estado, catálogo, instalação, guia e telemetria como ferramentas, para qualquer IA com MCP. E um servidor MCP remoto na plataforma, só leitura, para quem usa só o app do Claude ou do ChatGPT: catálogo, guias, novidades e estado da conta, autenticado pelo servidor OAuth que já existe. |

## Mercado: onde está o vão

O concorrente mais próximo tem nome: o Ratos OS vende um `AGENTS.md` com pastas e skills para Claude Code, Codex e Hermes por R$ 97, com um ano de acesso e sem renovação automática. O vão que sobra é exatamente o seu modelo: ninguém vende a atualização contínua como produto, e ninguém entrega em mais de um idioma.

| Oferta | Onde | Preço | O que entrega | Nível |
| --- | --- | --- | --- | --- |
| [Ratos OS](https://ratosdeia.com.br/claudeos/) (Ratos de IA / DobraLabs) | BR | R$ 97 único (de R$ 297), 1 ano de acesso | `AGENTS.md` + pastas (clientes, processos, finanças, marca), instalador guiado de 20 min, 33 aulas (8h56), skills de tráfego, conteúdo e propostas; Claude Code, Codex e Hermes | Quem já usa IA todo dia, sem programar |
| [Comunidade Ratos de IA](https://ratosdeia.com.br/comunidade/) | BR | R$ 597 único (de R$ 697), 1 ano, sem renovação | 4 cursos (82 aulas), WhatsApp VIP, calls com o fundador, fórum curado por agente, skills exclusivas; 350+ membros ativos | Dono de negócio, gestor, marketing, operações |
| [Ratos de IA, skills avulsas](https://ratosdeia.com.br/) | BR | R$ 57 cada | 24 skills prontas para Claude Code; newsletter semanal grátis como topo de funil | Idem |
| [Maestros da IA](https://comunidade.maestrosdaia.com/) (Arthur Endo, Lyria Zoccal) | BR | R$ 97/mês | 147 aulas, 329 recursos (100 skills, 56 apps, 12 agentes), encontros semanais | Iniciante a empresário |
| [Claude Economy](https://claude-economy.vercel.app/) (Marcelo Anders) | BR | R$ 297 único (próximo lote R$ 497) | 12 módulos, 30 skills, 3 agentes, atualização vitalícia, grupo de WhatsApp | Empreendedor e operador |
| [Automators Club](https://automatorsclub.com.br/) (Matheus Fonseca) | BR | R$ 197 único | 14+ módulos, templates, calls semanais | Iniciante a intermediário |
| [Claude Code Club](https://skoolmakers.com/communities/category/ia/) (Duncan Rogoff) | Skool | US$ 9/mês | Construir ferramentas com Claude Code sem saber programar; 7.275 membros | Iniciante |
| [AI Business Hub](https://www.skool.com/ai-leaders-1796/about) (Suleiman Najim) | Skool | US$ 49/mês (US$ 99 após 600 membros) | Curso de Claude, MCPs, skills, templates; 604 membros | Iniciante a avançado |
| [Early AI-dopters](https://skoolmakers.com/communities/category/ia/) (Mark Kashef) | Skool | US$ 77/mês | Generalista de IA com Claude Code; 1.386 membros | Intermediário |
| [AI Automations by Jack](https://skoolmakers.com/communities/category/ia/) (Jack Roberts) | Skool | US$ 77/mês | 110+ blueprints; 3.302 membros | Intermediário |
| [Chase AI+](https://skoolmakers.com/communities/category/ia/) (Chase Hannegan) | Skool | US$ 97/mês | Masterclass de Claude Code, 100+ templates de agentes; 1.365 membros | Agência |
| [RoboNuggets](https://skoolmakers.com/communities/category/ia/) (Jay E) | Skool | US$ 97/mês | 70+ cursos de IA agêntica; 1.180 membros | Técnico |

**O que a tabela mostra**

- **Ratos OS é o seu espelho mais próximo:** mesmo objeto (um arquivo de agente + skills), mesmo público amplo, mesma exigência de que o usuário pague a própria IA. A diferença é o modelo: eles vendem acesso por um ano; você vende atualização contínua. Sua página precisa dizer isso em uma linha.
- **O preço de referência caiu:** R$ 97 único na entrada e R$ 597/ano de comunidade no Brasil; US$ 49 a 97/mês fora. Uma assinatura mensal no Brasil precisa parecer barata ao lado de "R$ 97 por um ano".
- **Todos vendem volume:** "329 recursos", "110+ blueprints", "24 skills". Volume vira commodity; ritmo de atualização não, porque exige alguém operando.
- **Ninguém é multi-idioma:** os brasileiros vendem só em português; os do Skool, só em inglês. Um catálogo bilíngue desde o dia 1 abre os dois mercados com o mesmo trabalho de engenharia.

**Sobre a validação:** ver concorrentes prova que existe mercado, não que ele compra de você. A validação que conta é pagamento, e ela está na fase 1 das etapas.

## Melhorias na ideia

Cinco ajustes transformam "painel com ícones de ferramentas" em algo difícil de copiar. O mais importante é o primeiro: entrar amplo com uma promessa única e deixar os dados de uso escolherem o foco.

1. **Entrar amplo, focar por medição.** Público definido por nível é vago como promessa de venda, mas serve como porta de entrada. A página vende uma promessa única e abre 3 ou 4 portas por perfil (quem opera produto próprio, freelancer ou agência, profissional que usa Claude ou Codex todo dia, dev); o cadastro registra perfil, IA usada e idioma, e o uso por ferramenta decide o foco.
   - Os dois níveis viram duas profundidades da mesma ferramenta: **usar** (sem código) e **abrir o capô** (adaptar, estender, integrar).
2. **Organizar o catálogo pelas etapas que você já domina.** Os ícones ficam, um por módulo; as sete trilhas são o filtro: Planejar, Construir, Publicar, Divulgar, Vender, Escalar, Manter. O integrante entra pela etapa em que está travado.
3. **A ferramenta vai até a IA, não o integrante até o painel.** O painel continua como vitrine e manual. O uso acontece dentro do Claude Code, Codex, Cursor ou Gemini CLI, pelo seu harness: um `npx flyee` instala o agent.md com skills, workflows e rules, e o mesmo comando atualiza (detalhe na seção de arquitetura).
4. **Receitas acima de ferramentas.** Ferramenta solta vira commodity; o resultado encadeado não. Ex.: radar, pauta, roteiro e vídeo; ou briefing, página, anúncio e e-mail.
5. **Aula curta, colada na ferramenta.** Um vídeo por ferramenta e por profundidade, no lugar de curso longo, gravado uma vez em português e traduzido no pipeline de vídeo que você já tem. Menos produção para você, menos tempo até o primeiro resultado para ele.

**Catálogo por etapa do ciclo do produto.** O gráfico original não veio na exportação deste documento. A tabela abaixo foi reconstruída com os módulos citados em "Arquitetura da entrega". O saas-starter aparece entre os primeiros módulos, embora o parágrafo seguinte diga que as etapas de engenharia ainda estão vazias; confirme se ele já está empacotado.

| Etapa | Módulos iniciais |
| --- | --- |
| Planejar | vazia |
| Construir | saas-starter |
| Publicar | vazia |
| Divulgar | radar de conteúdo, pauta e roteiro, roteiro HeyGen, takes com mockups de telas, pesquisa de conteúdo automática, copy de redes |
| Vender | copy de LP e sites |
| Escalar | vazia |
| Manter | vazia |

As ferramentas empacotadas até aqui servem marketing e venda; as etapas de engenharia, que são o seu diferencial, ainda estão vazias no catálogo.

*Nota de 2026-10-06: o primeiro app a entrar no catálogo será o de edição de vídeo, construído para uso do operador antes do vídeo de lançamento. Esta tabela é referência histórica (seção "Decisões tomadas 2026-10-06").*

## O que você pode não estar considerando

Suas decisões resolvem metade dos riscos da primeira versão (cópia, custo de IA, licença, nome). Sobram oito, e os dois primeiros são os que mais podem atrasar: como o npm vai controlar o acesso e como você vai medir o público para decidir o foco.

| Ponto | Por que importa | Resposta proposta |
| --- | --- | --- |
| npm privado não é feito para consumidor | Pacote privado no npm exige [organização paga por usuário](https://docs.npmjs.com/upgrading-to-a-paid-organization-plan/) e conta npm de quem instala. Não serve para vender a centenas de integrantes. | Público no npm só o instalador (`npx flyee`); o conteúdo do plano vem do seu servidor com o token do integrante, versionado e revogável. Você mantém o controle de versões e não expõe o repositório. |
| Medir o público exige instrumentação desde o dia 1 | "Deixar os dados decidirem" só funciona se houver dado. | Cadastro pede perfil, IA usada e idioma; cada ferramenta registra execução (sem conteúdo); o painel mostra compra, ativação e uso semanal por segmento. |
| Suporte cresce com integrantes, não com ferramentas | Quebra frequente é o motivo da assinatura, mas também gera pergunta. Se cada quebra vira atendimento, a energia por entrega volta. | Aviso de versão dentro do harness ("sua versão 1.4, atual 1.6, o que mudou"); suporte só assíncrono e coletivo; FAQ gerada das perguntas. |
| Quem não usa terminal | `npx` alcança quem roda Claude Code, Codex, Cursor ou Gemini CLI. Quem só usa o app do Claude ou do ChatGPT fica de fora; o Ratos OS tem o mesmo limite. | Aceitar o limite na v1 e medir a demanda; segunda porta depois: skills enviadas na conta do Claude e conector MCP para o app. |
| Multi-idioma dobra o conteúdo, não o código | Ferramenta e harness são os mesmos; aula, página e changelog são dois. | Gravar em português e traduzir vídeo e texto no pipeline que você já tem; inglês só do que estiver estável. |
| Segurança e confiança | O padrão de skills [não tem assinatura nem revisão obrigatória](https://anomity.ai/blog/agent-skills-open-standard-adoption-governance/), e já houve campanha de skills maliciosas. Um instalador que escreve no computador do integrante pede confiança. | Instalador com changelog, permissões declaradas e checksum; nada sai da máquina sem aviso. Vira diferencial. |
| Gatilho contra cancelamento tem limite | Criar atrito para cancelar pode ser enquadrado como prática abusiva pelo CDC; mostrar a desvantagem de sair, não. | Gatilho honesto: contador de versões atrás, changelog do que ele perderia, preço de fundador que não volta, plano anual. Cancelar em um clique. |
| Fiscal e jurídico | Cobrança recorrente em dois países, LGPD, termos de uso, nota fiscal. | Contador antes do primeiro pagamento; termos simples desde a pré-venda; plataforma de pagamento que cobre BRL e USD. |

## Diferenciais

Os diferenciais mais fortes já existem: o harness agnóstico e a atualização contínua. O que falta construir barato é a medição por segmento, que decide o foco; o que fica para depois é a porta para quem não usa terminal.

1. **Nascido em produção.** Cada ferramenta mostra onde roda de verdade e o que já quebrou. Ninguém na amostra prova uso real.
2. **Atualização como produto.** Ritmo curto, changelog visível, contador de versão dentro do harness; atualizar exige token revalidado a cada 30 dias, o que traz todo integrante de volta ao painel. O Ratos OS vende um ano de acesso e some; você vende presença contínua.
3. **Catálogo pelo ciclo do produto.** Sete etapas, entrada pela dor do momento.
4. **Revisado e seguro.** Versão, permissões declaradas, checksum, nada sai da máquina sem aviso.
5. **Bilíngue desde o dia 1.** Mesmo catálogo em português e inglês; nenhum concorrente da amostra faz isso.
6. **Harness agnóstico via npm.** Um `agent.md` que roda em Claude Code, Codex, Gemini CLI e Cursor; um comando instala e atualiza. Já está construído.
7. **Receitas.** Fluxos completos até o resultado, não peças soltas.
8. **Duas profundidades.** Usar sem código ou abrir o capô.
9. **Painel de uso e perfil.** Mede quem compra e quem usa por segmento; decide o foco e o que parar de manter.
10. **Roadmap votado.** Integrantes votam na próxima ferramenta.

**Diferenciais por força e custo de construir.** O gráfico original não veio na exportação. A divisão abaixo foi reconstruída a partir do texto desta seção.

| Quadrante | Diferenciais |
| --- | --- |
| Fazer já: custam pouco porque saem do que já existe | 1 nascido em produção, 2 atualização como produto, 3 catálogo pelo ciclo do produto, 5 bilíngue desde o dia 1, 6 harness agnóstico via npm, 9 painel de uso e perfil |
| Depois | 4 revisado e seguro, 7 receitas, 8 duas profundidades, 10 roadmap votado |

A plataforma dá suporte aos dez desde o início, e checksum e permissões declaradas (item 4) entram já na API de entrega. A divisão acima é de prioridade de produto.

Comece pelo quadrante "Fazer já": seis diferenciais que custam pouco porque saem do que você já faz. O painel de uso é a aposta que decide o foco.

## Arquitetura da entrega

Um cadastro, um comando: o painel emite o token do integrante, `npx flyee` instala e atualiza o harness na máquina dele, e o harness carrega skills, workflows e rules em qualquer IA que leia um `agent.md`. Nada do seu lado gasta crédito de IA.

- **Painel flyee.club (web).** Login, pagamento em BRL e USD, vitrine com os ícones, aulas, receitas, changelog e perfil do integrante (segmento, IA, idioma). Emite o token, revalida a cada 30 dias sem update e o revoga no cancelamento; a tela de revalidação mostra o próximo degrau.
- **`npx flyee` (pacote público no npm).** Só o instalador é público: pede o token, baixa o pacote do plano do seu servidor, instala o harness e roda `npx flyee update` depois. O controle de versão fica com você, sem repositório exposto e sem exigir conta npm do integrante.
- **Servidor de pacotes.** Um pacote versionado por plano e idioma, changelog por versão, checksum e registro de instalação e uso por ferramenta. Valida o token a cada `update`: passados 30 dias do último contato, responde "revalide no painel" com o link. As ferramentas já instaladas continuam funcionando; só a atualização espera, e o harness avisa a partir do dia 25.
- **Harness flyee (`agent.md`).** O que você já construiu: um ponto de entrada que centraliza skills, workflows e rules e torna tudo agnóstico. É o que faz "qualquer IA" ser verdade sem um conector por IA.
- **Skills soltas.** Arquivo `SKILL.md` avulso, sem harness e sem atualização. Camada de amostra grátis e porta de entrada. *Substituída em 2026-10-06 pela versão de entrada de cada app no canal `free` (seção "Decisões tomadas 2026-10-06"): a porta de entrada passa a ser a conta sem compra, instalando pela própria CLI, e nenhuma skill solta é distribuída.*

**O limite a aceitar na v1:** `npx` alcança quem usa terminal (Claude Code, Codex, Gemini CLI, Cursor). Quem só usa o app do Claude ou do ChatGPT entra depois, por skills enviadas na conta ou por um conector MCP, quando a medição mostrar que vale.

**Core e módulos:** o harness que existe hoje vira duas coisas. O *core* `flyee` é só o contrato: `agent.md` enxuto, rules, registro de módulos e os comandos `add` e `update`. Cada ferramenta é um *módulo* versionado no seu servidor, instalado sob demanda com `npx flyee add <módulo>`, e é o que aparece como ícone no painel. O starter kit de SaaS é o primeiro módulo da trilha Construir, não o core: quem só quer a ferramenta de vídeo não recebe um esqueleto de SaaS.

| Pergunta | Resposta |
| --- | --- |
| Tudo no mesmo harness? | Não. Um `agent.md` que carrega tudo incha o contexto e degrada a IA; uma quebra no módulo de vídeo não pode exigir release do core; e a métrica por segmento precisa do módulo como unidade (quem instala e usa o quê). |
| Complementos que o integrante adiciona? | Sim. Módulo = pasta com `flyee.module.json` (nome, versão, trilha, tipo, IAs compatíveis, credenciais externas exigidas como HeyGen ou Apify, permissões, aula por idioma, changelog) + skills, workflows e scripts. O core adiciona uma referência ao `agent.md`; nada é concatenado. |
| Pacotes npm separados? | Não para o integrante: um único instalador público, e os módulos vêm do seu servidor pelo token, com o plano decidindo quais. Internamente, um monorepo com um pacote por módulo dá versionamento independente. |
| E as receitas? | Um conjunto nomeado de módulos mais um workflow por cima: `npx flyee add receita:video-semanal` instala radar, pauta, roteiro HeyGen e takes de uma vez. |
| E as trilhas? | Viram filtro e ordem do catálogo, não container. O painel volta a ser a vitrine de ícones que você imaginou: um ícone por módulo, filtrado por etapa. |

Primeiros módulos, pelo que você já tem: saas-starter (Construir); radar de conteúdo, pauta e roteiro, roteiro HeyGen, takes com mockups de telas, pesquisa de conteúdo automática, copy de redes (Divulgar); copy de LP e sites (Vender).

**Arquitetura da entrega.** O diagrama original não veio na exportação. Versão em texto, com a fronteira entre plataforma e produto:

```text
Painel flyee.club [plataforma]
  emite o token, revalida após 30 dias sem update, revoga no cancelamento
      │
      ├─► npx flyee [produto] ──token──► servidor de pacotes [plataforma]
      │                                  confere token, plano e versão;
      │                                  devolve pacote, checksum e manifesto
      ├─► skills soltas [amostra grátis, sem token e sem atualização]
      └─► aulas, receitas e changelog [painel]

Harness flyee na máquina do integrante [produto]
  ──► Claude Code · Codex · Gemini CLI · Cursor (plano ou API do próprio integrante)
```

O token liga tudo: o painel emite, o instalador usa, o servidor confere. Trinta dias sem update, o token vence e o integrante volta ao painel para revalidar; cancelou, o update para e a versão envelhece.

## Modelo de negócio

A escada tem três degraus claros: um produto de entrada barato para medir quem compra, a assinatura como núcleo, e upsells para quem já usa. Os preços são hipóteses ancoradas no Ratos OS (R$ 97 único, 1 ano) e na comunidade Ratos (R$ 597/ano); como o clube não substitui sua renda no curto prazo, o objetivo dos primeiros seis meses é dado, não receita.

| Degrau | O que é | Para quem | Preço de partida (hipótese) | O que prova |
| --- | --- | --- | --- | --- |
| 0 · Amostra | A versão de entrada de cada app, instalada pela CLI numa conta sem compra, + newsletter bilíngue; nunca oferecida, só alcançada pelo conteúdo (decisão de 2026-10-06) | Topo de funil | Sem preço | Interesse por segmento e idioma; qual vídeo traz cadastro e instalação |
| 1 · FlyeeClub, o acesso (low-ticket) | Harness + catálogo inteiro com atualização contínua + aula de uso por ferramenta; 1 acesso; token revalidado no painel a cada 30 dias sem update | Quem quer testar | R$ 97 único / US$ 29 | Quem paga, por qual porta entra e quem volta para revalidar |
| 2 · FlyeeClub Pro, a assinatura | FlyeeClub + guias avançados, receitas, encontros, voto no roadmap, a camada "abrir o capô" (herdada do Pro em 2026-10-06), acesso em mais de uma máquina | Quem usa toda semana e quer ir fundo | R$ 67/mês ou R$ 597/ano; US$ 19/mês; fundador com preço travado | Uso semanal por segmento, conversão kit → assinatura |
| ~~3 · Pro~~ (fora da vitrine desde 2026-10-06: a camada "abrir o capô" passou ao FlyeeClub Pro e as linhas `pro-*` ficam inativas) | Assinatura + camada "abrir o capô" + mais máquinas (a licença comercial passou a valer em todo plano pago em 2026-10-06) | Freelancer e agência | R$ 197/mês / US$ 49 | Quanto do público é profissional de serviço |
| 4 · Mentoria em grupo | Turma trimestral, ao vivo, sobre operar produto com IA | Assinantes engajados | R$ 997 a 1.997 por turma | Demanda por acesso a você |
| 5 · Advisory e Time | Meio dia por semana ([plano de agosto](https://claude.ai/code/artifact/a704c98b-1442-45e3-9e3f-dd4ae0f5166c)) e plano por assento | Empresas | Preço público, sob consulta | Teto da escada |

Os preços desta tabela são dados configuráveis, guardados em `plans` e editados em `/admin/billing`, nunca constantes no código. Os valores são hipóteses de partida.

**Upsell é gatilho de uso, não de tempo:** a revalidação de 30 dias é o momento em que todo integrante, até o do kit, passa pelo painel; é ali que a oferta certa aparece. Desde 2026-10-06: quem tem o FlyeeClub recebe a oferta do FlyeeClub Pro (com a razão de uso quando houver, três ou mais trilhas em 30 dias), e todo integrante pagante vê a mentoria e a consultoria, sob demanda, levando ao contato; o advisory a quem pergunta sobre a própria operação.

**Consequência do kit sem limite de ferramentas:** a camada mais forte (ferramenta + atualização) passa a ser vendida uma vez, por R$ 97. A assinatura precisa valer pela camada de profundidade (aulas avançadas, receitas, encontros, voto), que é a que consome sua energia. Duas formas de proteger: canal estável para o kit (atualização mensal) e canal latest para assinantes (semanal, com beta); ou aceitar e medir a conversão kit → assinatura em 60 dias antes de mexer.

**Retenção honesta:** contador de versões atrás dentro do harness, changelog do que a versão dele já perdeu, preço de fundador que não volta e plano anual. Cancelamento em um clique; o gatilho é a perda visível, não o atrito.

**Conta de referência:** 300 kits de entrada a R$ 97 são R$ 29.100 uma vez; 100 assinantes a R$ 67 são R$ 6.700/mês. Taxas e impostos saem daí.

## Métricas e trackers

O foco não tem data: ele é decidido quando os dados cumprirem uma regra combinada antes. Proposta de regra: um segmento lidera em compra do kit, ativação e uso semanal por 4 semanas seguidas, com pelo menos 30 pessoas em cada segmento comparado. Até lá, o catálogo continua amplo.

**O que registrar (eventos, nunca o conteúdo do uso)**

| Momento | Evento | Dimensões | Serve para |
| --- | --- | --- | --- |
| Cadastro | conta criada | segmento, IA usada, idioma, origem (UTM), degrau comprado | Quem entra e por onde |
| Instalação | `npx flyee` rodou | versão, IA detectada, sistema | Ativação técnica |
| Ativação | primeira ferramenta executada | ferramenta, trilha | Quem passa do install ao uso |
| Uso | ferramenta executada | ferramenta, trilha, versão instalada | Uso semanal por segmento; o que ninguém usa |
| Atualização | `update` rodou, ou falhou por token vencido | versão de → para | Ritmo de atualização; quem ficou para trás |
| Revalidação | token revalidado no painel | dias desde o último update, oferta exibida, clique | Volta ao painel; eficácia da isca |
| Aula | aula iniciada e concluída | ferramenta, idioma, nível | Onde a aula avançada tem demanda |
| Upsell | oferta vista, clicada, comprada | degrau de origem → destino | Conversão kit → assinatura → Pro |
| Saída | cancelamento e motivo | degrau, tempo de casa, uso nos 30 dias anteriores | O que precede o cancelamento |

**As cinco métricas que decidem o foco (uma linha por segmento, toda semana)**

1. Compradores do kit e conversão da página, por porta de entrada.
2. Ativação em 7 dias: instalou e executou ao menos uma ferramenta.
3. Uso semanal: executou em 3 das últimas 4 semanas.
4. Conversão kit → assinatura em 60 dias.
5. Receita por integrante em 90 dias: kit + assinatura + upsell.

**Onde isso vive:** a v1 não precisa de painel interno. Uma tabela de eventos no seu banco (você já usa Supabase) ou um PostHog auto-hospedado, e uma consulta semanal por segmento numa planilha, bastam até a fase 2. O que não pode faltar é o evento registrado desde o primeiro integrante, com o segmento e o idioma gravados no cadastro.

## Etapas

Venda o kit de entrada antes de construir o painel e deixe o uso por segmento escolher o foco. Cada fase termina num portão; as metas são propostas para você ajustar.

**Roadmap em 5 fases e 4 portões.** O diagrama original não veio na exportação. A tabela foi reconstruída a partir do texto desta seção e precisa da sua confirmação.

| Fase | O que acontece | Portão para seguir |
| --- | --- | --- |
| 0 · Preparar (duas semanas) | segmentos e perguntas do cadastro, eventos, inventário, `npx flyee`, página de espera, primeiro conteúdo | página de espera no ar e eventos definidos |
| 1 · Vender o kit | validação por pagamento | 50 compradores; abaixo disso, estender a fase 1 |
| 2 · Medir | eventos registrados e lidos por segmento | **portão destacado**: com a leitura por segmento, abrir painel, assinatura e upsell |
| 3 · Assinatura e upsell | assinatura, aulas avançadas, receitas, encontros, voto | regra de foco cumprida (seção de métricas) |
| 4 · Foco | catálogo e conteúdo concentrados no segmento líder | — |

O portão destacado é o que libera a assinatura: sem eventos registrados e lidos por segmento, não abra painel nem upsell. O foco em si não tem data; ele dispara pela regra da seção de métricas. Abaixo de 50 compradores, estenda a fase 1; se nenhum segmento se destacar, reveja as portas de entrada, não o produto.

**Próximas duas semanas (fase 0)**

- [ ] Definir os 3 ou 4 segmentos de entrada e as perguntas do cadastro (perfil, IA usada, idioma)
- [ ] Definir os eventos da seção de métricas e onde ficam registrados
- [ ] Inventariar as ferramentas por etapa e listar o que fica fora do kit (aulas avançadas, voto, encontros)
- [ ] Empacotar o harness como `npx flyee`: instalador público + pacote no seu servidor com token de 30 dias
- [ ] Subir página de espera bilíngue com lista de e-mail
- [ ] Publicar o primeiro conteúdo (autópsia de produção) apontando para a lista

## Decisões em aberto

Das seis decisões originais, três foram tomadas em 2026-09-30 e estão marcadas. As levantadas no plano da plataforma foram quase todas decididas no mesmo dia.

- [x] **Quais segmentos entram na medição.** Decidido: produto próprio, freelancer ou agência, profissional que usa IA todo dia, dev, e "outro" fora da regra de foco. *Revisado em 2026-10-06: negócio, agência, produto digital e dev, os perfis do site, e "outro" fora da regra de foco (migração `0028`).*
- [ ] **A regra que dispara o foco.** Aceita a proposta (um segmento lidera em compra, ativação e uso semanal por 4 semanas, com 30 ou mais pessoas por segmento) ou prefere outra? O painel de métricas usa a proposta como indicador até você decidir.
- [x] **O que "1 acesso" significa no kit.** Decidido: um dispositivo no kit, três na assinatura, cinco no Pro.
- [x] **Canal de atualização do kit.** Decidido: o mesmo canal para todos na v1.
- [x] **O que fica aberto.** Decidido em 2026-10-06: nenhuma skill solta; o degrau grátis é a versão de entrada de cada app, no canal `free`, instalada pela CLI numa conta sem compra. Do harness, só a CLI é pública (pacote `flyee` no npm); o core viaja dentro dela e os apps vêm do servidor de pacotes.
- [x] **Ordem dos upsells.** Decidido em 2026-10-06, com os dois planos: quem tem o FlyeeClub recebe a oferta do FlyeeClub Pro; a mentoria remota e a consultoria completa são serviços sob demanda, oferecidos no painel a quem já paga e contratados pelo contato; o Pro de antes saiu da vitrine. Desde 2026-10-06 nenhum uso das ferramentas oferece o Pro por conta própria: projetos de cliente valem em todo plano pago.
- [x] **Proteção contra cópia e revenda.** Decidido em 2026-10-06. O que a IA lê fica em texto na máquina do integrante, então nenhuma trava impede copiar arquivos. O conjunto do item 10.6 do plano combina valor fora do disco, licença assinada por app e máquina que prende o harness à conta, marcas rastreáveis, relatório de downloads anômalos, cláusula nos termos, registro da marca no INPI e conteúdo dinâmico servido pela plataforma.

**Levantadas no plano da plataforma**

- [x] **Vídeo das aulas avançadas.** Decidido: YouTube não listado para todas as aulas.
- [x] **Nota fiscal.** Decidido: emitida direto no Asaas.
- [x] **Encontros.** Decidido: link externo.
- [x] **Endereços em inglês.** Decidido: traduzidos já na v1.
- [x] **Revisão jurídica.** Decidido: os termos são considerados revisados.
- [ ] **Quem opera o flyee.club.** Razão social, CNPJ e cidade que os termos de uso e a política de privacidade identificam. Os textos legais herdados ainda identificam a empresa do MedChina; o seed dos termos (fase 2) precisa desse dado antes do primeiro deploy.
- [ ] **Preço anual em USD.** Este documento só traz US$ 19 por mês. A hipótese do plano é 10 vezes a mensal.
- [x] **Trial da assinatura.** Decidido em 2026-10-06: nenhum. `trial_days` fica em 0; a versão de entrada no canal `free` cumpre o papel de teste sem entregar a loja inteira.

**Do lado do produto (fora deste repositório)**

- [ ] **Licenças do saas-starter.** Um módulo derivado desta base não pode levar a chave do MUI X Premium, que é licenciado por desenvolvedor; cada integrante precisaria da própria licença. O código do template licenciado (a vitrine `/ui` e os ícones Nexture) e as fontes comerciais precisam de checagem de licença antes de qualquer redistribuição.
- [x] **Arquivo de entrada do harness.** Decidido em 2026-10-06: `AGENTS.md` canônico com ponteiros `CLAUDE.md` e `GEMINI.md`, skills em `.agents/skills/` com pontes em `.claude/skills/`, geradas pelo core como este repositório já faz em `scripts/sync-agent-harness.mjs` (seção "Decisões tomadas 2026-10-06").

## Fontes

- [Ratos OS](https://ratosdeia.com.br/claudeos/), [Comunidade Ratos de IA](https://ratosdeia.com.br/comunidade/) e [Ratos de IA](https://ratosdeia.com.br/)
- [Skoolmakers: comunidades de IA no Skool](https://skoolmakers.com/communities/category/ia/)
- [Comunidade Maestros da IA](https://comunidade.maestrosdaia.com/) e [Maestros da IA, implementação](https://implementacao.maestrosdaia.com/)
- [Claude Economy](https://claude-economy.vercel.app/)
- [Automators Club](https://automatorsclub.com.br/)
- [AI Business Hub](https://www.skool.com/ai-leaders-1796/about)
- [Agent Skills: padrão aberto, adoção e governança](https://anomity.ai/blog/agent-skills-open-standard-adoption-governance/)
- [ChatGPT e MCP: planos e limites](https://coworker.ai/blog/chatgpt-mcp)
- [npm: plano pago de organização](https://docs.npmjs.com/upgrading-to-a-paid-organization-plan/)
- [Claude Code: hospedar e manter marketplace](https://code.claude.com/docs/en/plugins/host-marketplace)
