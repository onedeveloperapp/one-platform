# Plano da página home: Página de vendas

Escrito em 2026-11-08. Onde fica: o endereço principal do produto, ou o destino das campanhas e dos links. O roteiro completo do tipo está no app, em references/tipos/landing.md.

## Os fatos

| O quê | Valor |
|---|---|
| o nome do produto oferecido | ONE |
| o que ele é, em uma frase | Software de automação com IA para escritórios de contencioso de massa: atende o cliente no WhatsApp do escritório, confere os documentos, escreve a peça, conta os prazos e monta o pacote do protocolo, e o escritório escolhe o que uma pessoa revisa. |
| para quem é a página, em uma frase | Sócios e equipes de escritórios de advocacia de contencioso de massa no Brasil. |
| o texto do botão principal | Entrar na lista de espera |
| o texto do segundo chamado, se houver | Falar com a gente |
| a direção visual, em uma frase que diga o que torna a página deste produto | A marca do ONE como está no código, o azul do logo com o ciano, Urbanist nos títulos, Mulish no texto e cantos arredondados, com a faixa escura no topo e no controle, e o próprio produto no lugar de ilustração: a cena do topo e as figuras são os componentes do ONE com dados fictícios. |
| de onde vem a demonstração: componentes reais do projeto, tela real ou réplica | componentes |
| o endereço da página para a conferência | / |

Os campos em [a decidir] são perguntados numa mensagem só, cada decisão com uma sugestão que um sim aceita.

## A direção visual

A marca do ONE como está no código, o azul do logo com o ciano, Urbanist nos títulos, Mulish no texto e cantos arredondados, com a faixa escura no topo e no controle, e o próprio produto no lugar de ilustração: a cena do topo e as figuras são os componentes do ONE com dados fictícios.

- A marca: #1074C6 primária (o azul do logo), #1D8FED primária clara, #00C0EB secundária (o ciano do logo), #303030 faixa escura, #FFFFFF superfície, #48433D texto, #726C65 texto secundário, #AE59F8 acento 1, #ED45CE acento 2, #F57072 acento 3, #F5AB56 acento 4, #C92C4E erro, só para risco e falha; Urbanist (títulos), Mulish (texto), JetBrains Mono (código) (de packages/design-tokens/css/blue.css (paleta theme-blue, provisória) e css/common.css, convertidos de HSL; as letras em apps/web/src/app/layout.tsx (next/font) e docs/DESIGN.md).
- Escolhido de propósito da lista de vícios: texto_degrade.

## A demonstração

| O quê | Valor |
|---|---|
| de onde vem a imagem (componentes, tela ou replica) | componentes |
| o objeto em foco | O topo de um caso no ONE (Andamento do caso), com a conversa da cliente no WhatsApp do escritório sobre a borda do painel. |
| a única ação | O ONE confere a identidade que a cliente mandou pelo WhatsApp. |
| o que muda e fica na tela | O documento aparece aceito em "O que o ONE fez há pouco", e a resposta do ONE fica na conversa, entregue. |
| o que fica de fora | O menu, a busca e os outros cartões do caso, a linha de quem está com o caso, as etapas depois do protocolo, a lista de documentos e o resto da conversa. Nenhum número de uso, logo de cliente ou depoimento. |
| onde cada coisa mostrada existe no produto | O topo do caso é o de casos/[id]/components/journey-card.tsx (ProgressSteps, StateLine e ActivityCards de components/product), com as palavras de lib/cases/journey.ts e lib/cases/now.ts (case-now-checking-one). A foto mandada na conversa entra no caso pela migração 0050_conversation_files e é conferida pela IA na tarefa caso.documento.conferencia (0024), que o ONE decide sozinho por padrão (a decisão document_check do catálogo autonomy_decisions, semeada na 0024). A resposta é a de fileLine em lib/conversations/agent.ts, mostrada como em /atendimento (MessageBubble, autor ONE, Entregue). |
| os dados são inventados para a cena | sim |
| o seletor da cena na página | [data-demo] |

A ordem de preferência, as medidas e o que conferir estão no app, em references/demonstracao.md. A cena mostra só o que o produto faz hoje.

## Os números e as urgências

| O que a página diz | De onde vem |
|---|---|
| Em construção com um escritório piloto | CLAUDE.md: o produto está em construção (M3) e é testado com o escritório piloto (as caminhadas de 2026-10-21 em diante); docs/PRODUCT.md |
| Feito para os sistemas dos tribunais: Projudi, eproc, PJe, e-SAJ | court_systems (0021, semeada de uma amostra do DJEN; 0027 Projudi do TJGO; 0036 eproc do TJSP e do TJSC, PJe do TJCE) e a decisão do protocolo assistido por sistema (CLAUDE.md, Product decisions). São nomes de sistemas, sem logo. |
| DJEN | As publicações lidas pela OAB de cada advogado no Diário de Justiça Eletrônico Nacional (0028, @flyee/courts/providers/djen). |
| Entrar na lista não custa nada | O estágio do site é a lista de espera (platform_settings launch) e nenhum preço foi publicado (offer.price nulo; a cobrança do ONE é do M3). |
| Mariana Souza, 09:41, identidade.jpg (a cena do topo) | Exemplo fictício, com a etiqueta ao lado da cena. |
| 23:41 (a pergunta da cliente e a resposta do ONE) | Exemplo fictício, com a etiqueta embaixo da conversa. |
| Processos de 2099, 12/11 às 14h, vence em 27/11 (os exemplos do radar) | Exemplo fictício, com a etiqueta no cartão; números de processo de um ano por vir, com os dígitos verificadores. |
| Vence em 27/11/2026: 15 dias úteis, disponibilizada no DJEN em 04/11/2026, publicada em 05/11/2026, o primeiro em 06/11/2026, sem contar 20/11/2026 | Calculado na página pela regra do produto (prazo-v1, @flyee/rules/deadlines) sobre um exemplo fictício de Goiânia; 20/11 é feriado nacional pela Lei 14.759/2023; o calendário do TJGO de 2026 (0034) não tem outro dia de novembro. |
| 01-peticao-inicial.pdf a 05-cartao-de-embarque.pdf, Projudi, Pronto para protocolar | Nomes e ordem dados na página pela regra do pacote (planFiling, @flyee/courts/filing) a um exemplo fictício; o limite de 6 MB do Projudi do TJGO vem de court_systems (0027). |
| As cinco decisões do painel de controle e os modos de cada uma | O catálogo autonomy_decisions: aceitar documentos (0024) e responder o cliente (0048) aceitam três modos; prazos (0034), texto da peça (0029) e procuração (0054) aceitam dois. Os nomes são os de /settings/autonomia; as escolhas do painel são de um escritório fictício. |
| Um sócio muda cada decisão com o segundo fator | set_firm_autonomy pede um sócio com o segundo fator (migração 0016, teste pgTAP 0045); num escritório sem sócio, quem gerencia a conta (decides_for_firm, 0078). |
| caso 128 (frases do ONE agora) | Exemplo fictício, com a etiqueta embaixo do painel. |
| carteira.xlsx com 1.240 linhas: 1.198 abrem caso, 37 já estão no ONE, 5 não lidas; Procuração do escritório.docx; os nomes dos clientes | Exemplo fictício, com a etiqueta embaixo de cada tela; 1.198 + 37 + 5 = 1.240; números de processo de 2099 (o último com dígitos que não conferem, de propósito). |
| O primeiro módulo, em teste com um escritório piloto, cuida das ações de passageiros contra companhias aéreas | CLAUDE.md, Product decisions (o módulo Direito do Passageiro) e o escritório piloto. |
| O preço ainda não foi publicado | offer.price nulo; a assinatura do ONE (Asaas, BRL) é do M3 e não tem plano com preço. |

## As seções, na ordem

1. A faixa de cima, só com uma promoção de verdade: o que é, até quando e um chamado
2. O topo: para quem é e o resultado no título, uma frase com o que o produto faz, o chamado principal e o secundário, a linha de condições embaixo, uma prova curta e o produto, de verdade, embaixo ou ao lado
3. O produto funcionando: os componentes reais com dados fixos, a tela real, um vídeo curto ou uma réplica simplificada, nessa ordem, só com o que ele faz hoje e com os dados de exemplo marcados como fictícios
4. A dor nas palavras do cliente, em três ou quatro cartões, e a frase que liga a dor à solução
5. Os recursos do dia a dia, um por bloco, com o resultado no título e a tela ao lado; numa grade, um bloco lidera e nem todo bloco é tela
6. A diferença: por que este produto e não uma alternativa genérica
7. A história de uso: um cliente de exemplo, do primeiro contato ao resultado, passo a passo
8. As integrações, com o que depende do plano escrito
9. A prova: depoimentos com nome, cargo, empresa e cidade, e os números do produto com a origem
10. Os planos, pelo roteiro de planos, ou um chamado para a página de planos
11. As perguntas frequentes com as objeções de compra: migração, tempo para começar, cancelamento, segurança dos dados, suporte
12. O último chamado e o rodapé com quem vende: empresa, CNPJ, endereço, contato, privacidade e termos

## A mecânica

- Um chamado principal e no máximo um secundário, com o mesmo texto em toda a página
- No celular, uma barra fixa com o chamado principal aparece quando o botão do topo sai da tela
- Uma janela de promoção só abre depois que a pessoa mostra interesse, como ao passar da metade da página, uma vez por visita, com recusa visível
- Conteúdo que troca sozinho tem botão de pausa e para com o pedido de menos movimento
- Os números contados com animação já estão no HTML com o valor final
- O menu leva às páginas derivadas: planos, API, contato

## A medição

Eventos: `page_view`, `section_view`, `cta_click`, `demo_request`, `trial_start`, `pricing_view`, `popup_view`, `popup_accept`, `popup_decline`. Cada posição de chamado leva a sua identificação.

## As linhas legais

- Quem vende, com CNPJ e endereço, as condições da oferta e as restrições dela (Decreto 7.962/2013, art. 2, I, II, V e VI)
- O que a página promete sobre preço, prazo e condições entra no contrato (CDC, art. 30)
- Preço riscado, desconto, contador e vagas só quando são verdade (CDC, art. 37, §1)

## Conferir à mão, lendo o código

- [ ] Os números da página têm origem: clientes, horas economizadas, volume de uso
- [ ] A demonstração mostra só o que o produto faz hoje, e os dados inventados para ela levam a etiqueta
- [ ] A página tem a cara deste produto: a direção visual do plano aparece nela, e nenhum vício da lista ficou sem ser escolha
- [ ] A duração da demonstração é a mesma no topo, nos chamados e na agenda
- [ ] Os exemplos de código e as telas batem com o produto e com a documentação
- [ ] As regras da promoção são as mesmas na faixa, na seção, na janela, nos planos e nas perguntas frequentes
- [ ] Os depoimentos falam deste produto e vêm de clientes diferentes
- [ ] O que depende do plano está escrito perto do recurso

## A conferência automática

- O botão principal na primeira tela do celular (`cta_first_screen`)
- Os mesmos chamados em toda a página (`cta_consistent`)
- Um título principal (h1) (`h1_present`)
- Números que não começam em zero (`numbers_not_zero`)
- Os números e as urgências têm origem (`claims_have_origin`)
- Nenhum dado de exemplo esquecido (`placeholder_data`)
- A duração do teste grátis (`trial_terms`)
- A data e as regras da promoção (`promo_terms_shown`)
- As contas de desconto batem (`discount_math`)
- O preço riscado é o preço real (`reference_price_true`)
- Contador com prazo real (`countdown_real`)
- A janela tem saída (`popup_dismissable`)
- Nenhuma janela cobre a página na chegada (`popup_on_arrival`)
- Barra fixa numa página longa (`sticky_cta_long_page`)
- Como cancelar e se há fidelidade (`cancel_terms_shown`)
- Quem vende identificado (`supplier_identified`)
- As linhas legais (`legal_lines`)
- A demonstração marcada e com a etiqueta (`demo_honest`)
- A cena filmada (`demo_film`)
- Os vícios de IA (`ai_defaults`)
- As cores e as letras da marca (`off_brand`)
- Vídeo automático sem som, com capa (`video_autoplay_ok`)
- A regra de menos movimento (`reduced_motion`)
- Nada passa da largura do celular (`mobile_fits`)
- Texto legível no celular (`text_legible`)
- Botões e links fáceis de tocar (`tap_targets`)
- O contraste do texto (`contrast_ok`)
- O texto cabe nos botões (`controls_fit`)
- Imagens leves (`images_light`)
- Imagens com texto alternativo (`images_alt`)

## Modelos deste tipo

- Juridiq: a página de vendas de um software jurídico (vista em 2026-11-07): demonstração e teste no topo, com a linha de condições embaixo; a janela da promoção abre na metade da página, nunca na chegada, com recusa visível; barra fixa no celular quando o botão do topo sai da tela; demonstrações animadas com a etiqueta de exemplo fictício e botão de pausa; perguntas frequentes com as objeções de quem troca de sistema.
- JuriChat: a página de vendas do atendimento por WhatsApp (vista em 2026-11-07): as dores do dia a dia em quatro cartões antes da solução; a história de uma cliente em quatro passos, numa conversa presa na tela; os painéis do atendente e do gestor com números de exemplo; o que depende do plano escrito junto do recurso; o teste em destaque no topo e os 7 dias escritos nos planos.
