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
| a direção visual, em uma frase que diga o que torna a página deste produto | O efeito do modelo do Juridiq na marca do ONE: topo escuro de alto contraste, com a luz do azul e do ciano da marca atrás do título e um halo atrás da janela, parte do título em degradê do azul do logo para o ciano e a janela grande do sistema logo abaixo, e depois uma sequência de objetos grandes (o telefone, o radar, os documentos, a petição, o calendário, a pasta do protocolo) com pouco texto ao lado, em Urbanist e Mulish, cantos arredondados, dados fictícios e etiquetados. |
| o título da página, escolhido entre as opções de headline.options | Você advoga. O ONE faz o resto. |
| as figuras: o objeto que cada seção mostra, em figures | [object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object] |
| de onde vem a figura principal: uma versão desenhada para a página (replica), a tela real (tela) ou os componentes do projeto (componentes) | replica |
| o endereço da página para a conferência | / |

Os campos em [a decidir] são perguntados numa mensagem só, cada decisão com uma sugestão que um sim aceita.

## O título

Escolhido: Você advoga. O ONE faz o resto.

As opções pensadas:

- Você advoga. O ONE faz o resto.
- Enquanto sua equipe advoga, o ONE toca o resto do caso
- Cada caso do escritório andando, sem ninguém precisar empurrar
- Chega de advogado preso em trabalho repetido
- Oi, alguma novidade do meu caso?
- Automação com IA no contencioso de massa, do primeiro contato ao protocolo

As formas e os testes estão no app, em references/principios.md, seção 17: em voz alta, trocando o nome, a palavra de dentro e a imagem.

## A direção visual

O efeito do modelo do Juridiq na marca do ONE: topo escuro de alto contraste, com a luz do azul e do ciano da marca atrás do título e um halo atrás da janela, parte do título em degradê do azul do logo para o ciano e a janela grande do sistema logo abaixo, e depois uma sequência de objetos grandes (o telefone, o radar, os documentos, a petição, o calendário, a pasta do protocolo) com pouco texto ao lado, em Urbanist e Mulish, cantos arredondados, dados fictícios e etiquetados.

- A marca: #1074C6 primária (o azul do logo), #1D8FED primária clara, #00C0EB secundária (o ciano do logo), #303030 faixa escura, #FFFFFF superfície, #48433D texto, #726C65 texto secundário, #AE59F8 acento 1, #ED45CE acento 2, #F57072 acento 3, #F5AB56 acento 4, #C92C4E erro, só para risco e falha; Urbanist (títulos), Mulish (texto), JetBrains Mono (código) (de packages/design-tokens/css/blue.css (paleta theme-blue, provisória) e css/common.css, convertidos de HSL; as letras em apps/web/src/app/layout.tsx (next/font) e docs/DESIGN.md).
- Escolhido de propósito da lista de vícios: texto_degrade, tres_cartoes_iguais, mancha_desfocada.

## A figura principal

| O quê | Valor |
|---|---|
| de onde vem a imagem (replica, tela ou componentes) | replica |
| o objeto em foco | A janela do escritório no ONE: o menu de ícones, a busca, quatro números do mês, os casos num quadro por etapa e as pendências do dia, com dois cartões soltos sobre as bordas. |
| a única ação | [a decidir] |
| o que muda e fica na tela | Os casos do escritório, cada um numa etapa e com quem está, e ao lado só o que precisa de uma pessoa hoje. |
| o que fica de fora | A tela de um caso aberto, a barra de etapas e a lista de eventos, que só quem usa reconhece; os cartões e as colunas além de Audiência. Nenhum número de uso, logo de cliente ou depoimento. |
| onde cada coisa mostrada existe no produto | O menu de ícones é MenuType.Minimal (apps/web/src/menu-items.ts); a busca é components/layout/search/global-search.tsx; os quatro números são os de /casos e /controladoria (cases-number-*, firm_cases, migração 0108); o quadro por etapa é controladoria/case-board.tsx (firm_case_board, migração 0112), com os dias na etapa e quem está com o caso (case_standing, migração 0111); as pendências são components/layout/pending/pending-center.tsx (firm_pending, migração 0044). O cartão 'O ONE agora' são as palavras de lib/cases/now.ts (a peça escrita pelo ONE, caso.peca.minuta, migração 0029). O cartão do prazo é a contagem de prazo-v1 (product-examples.ts). |
| os dados são inventados para a cena | sim |
| o seletor da cena na página | [data-demo] |

A ordem de preferência, as medidas e o que conferir estão no app, em references/demonstracao.md. Ela se entende sem ler e mostra só o que o produto faz hoje.

## As figuras

| Seção | O que se vê | O que se entende sem ler | Marca na página |
|---|---|---|---|
| O topo | a janela grande do sistema, com menu de ícones, números, quadro de casos por etapa e pendências, e dois cartões soltos sobre as bordas | existe um sistema inteiro aqui, com os casos do escritório andando | `data-figura="janela-do-sistema"` |
| Atendimento | um telefone grande no centro, com a conversa no visual de um aplicativo de mensagens, e dois cartões escuros de cada lado | o cliente pergunta e recebe a resposta no celular | `data-figura="telefone-conversa"` |
| Depois do protocolo | um radar escuro com o ponteiro que gira e pontos acesos, e um cartão de movimentação embaixo | alguém está vigiando os processos pelo escritório | `data-figura="radar-processos"` |
| O dia a dia: documentos | duas fotos de documento sobrepostas: uma aceita, com a marca de conferido, e uma escura, com o aviso e o botão de tirar outra | o documento bom passa e a foto ruim volta para o cliente | `data-figura="documentos-conferidos"` |
| O dia a dia: a peça | uma folha de petição com as linhas de texto e um trecho marcado para completar, e a lista das citações conferidas sobre a borda | a petição já vem escrita e o que ela cita está conferido | `data-figura="peticao-escrita"` |
| O dia a dia: prazos | o calendário do mês, com os dias contados pintados, o feriado marcado e o último dia em destaque | o prazo foi contado e termina naquele dia | `data-figura="calendario-prazo"` |
| O dia a dia: o protocolo | uma pasta aberta com os arquivos em PDF numerados na ordem | o pacote do protocolo está pronto, em ordem | `data-figura="pasta-protocolo"` |
| Controle | um painel de seletores, um por decisão, com um deles marcado em cada linha, e um campo que digita sozinho | o escritório regula o que o sistema decide sozinho | `data-figura="painel-autonomia"` |
| Chegar ao ONE: o modelo | o arquivo Word do escritório, ligado a uma folha de modelo com os campos marcados em cor | o documento que o escritório já usa vira modelo | `data-figura="modelo-do-escritorio"` |
| Chegar ao ONE: a carteira | uma planilha de processos, com uma marca colorida do que acontece em cada linha | a carteira entra por planilha e cada linha é conferida | `data-figura="planilha-carteira"` |

Sem as letras, cada uma continua sendo um objeto. O guia está no app, em references/demonstracao.md.

## Os números e as urgências

| O que a página diz | De onde vem |
|---|---|
| Em construção com um escritório piloto | CLAUDE.md: o produto está em construção (M3) e é testado com o escritório piloto (as caminhadas de 2026-10-21 em diante); docs/PRODUCT.md |
| Feito para os sistemas dos tribunais: Projudi, eproc, PJe, e-SAJ | court_systems (0021, semeada de uma amostra do DJEN; 0027 Projudi do TJGO; 0036 eproc do TJSP e do TJSC, PJe do TJCE) e a decisão do protocolo assistido por sistema (CLAUDE.md, Product decisions). São nomes de sistemas, sem logo. |
| DJEN | As publicações lidas pela OAB de cada advogado no Diário de Justiça Eletrônico Nacional (0028, @flyee/courts/providers/djen). |
| Entrar na lista não custa nada | O estágio do site é a lista de espera (platform_settings launch) e nenhum preço foi publicado (offer.price nulo; a cobrança do ONE é do M3). |
| Os números da janela do topo: 1.284 em andamento, +4%, 96 novos, 41 ajuizados, 18 arquivados, os totais de cada coluna, os dias na etapa, os casos 128, 131 e os outros, e os nomes dos clientes | Exemplo fictício, em EXAMPLE_WINDOW de product-examples.ts, com a etiqueta embaixo da janela. |
| Hoje às 14h (as pendências da janela) e o caso 128 (o cartão O ONE agora) | Exemplo fictício, com a etiqueta embaixo da janela. |
| 23:41 e 23:42 (a conversa do telefone) e Mariana | Exemplo fictício, com a etiqueta embaixo do telefone. |
| Processos de 2099, 12/11 às 14h, vence em 27/11 (os exemplos do radar) | Exemplo fictício, com a etiqueta no cartão; números de processo de um ano por vir, com os dígitos verificadores. |
| Novembro de 2026, vence em 27/11/2026, 15 dias úteis, feriado de 20/11 (o calendário e o cartão do topo) | Calculado na página pela regra do produto (prazo-v1, @flyee/rules/deadlines) sobre um exemplo fictício de Goiânia, disponibilizado no DJEN em 04/11/2026; 20/11 é feriado nacional pela Lei 14.759/2023; o calendário do TJGO de 2026 (0034) não tem outro dia de novembro. Um teste segura as palavras contra a regra (product-examples.test.ts). |
| 01-peticao-inicial.pdf a 05-comprovante-de-gastos.pdf, Projudi, Pronto para protocolar | Nomes e ordem dados na página pela regra do pacote (planFiling, @flyee/courts/filing) a um exemplo fictício; o limite de 6 MB do Projudi do TJGO vem de court_systems (0027). |
| Lei nº 8.078, art. 14; Lei nº 9.099, art. 3º; Constituição Federal, art. 5º (as citações da petição) | Fontes semeadas na biblioteca da plataforma (migração 0045_platform_library), conferidas nas páginas oficiais em 2026-10-22; a trava de citação é o gate da peça (migração 0029). |
| As cinco decisões do painel de controle e os modos de cada uma | O catálogo autonomy_decisions: aceitar documentos (0024) e responder o cliente (0048) aceitam três modos; prazos (0034), texto da peça (0029) e procuração (0054) aceitam dois. Os nomes são os de /settings/autonomia; as escolhas do painel são de um escritório fictício. |
| Um sócio muda cada decisão com o segundo fator | set_firm_autonomy pede um sócio com o segundo fator (migração 0016, teste pgTAP 0045); num escritório sem sócio, quem gerencia a conta (decides_for_firm, 0078). |
| caso 128 (frases do ONE agora) | Exemplo fictício, com a etiqueta embaixo do painel. |
| carteira.xlsx com 1.240 linhas: 1.198 abrem caso, 37 já estão no ONE, 5 não lidas; Procuração do escritório.docx; os nomes dos clientes | Exemplo fictício, com a etiqueta embaixo de cada tela; 1.198 + 37 + 5 = 1.240; números de processo de 2099 (o último com dígitos que não conferem, de propósito). |
| O primeiro módulo, em teste com um escritório piloto, cuida das ações de passageiros contra companhias aéreas | CLAUDE.md, Product decisions (o módulo Direito do Passageiro) e o escritório piloto. |
| O preço ainda não foi publicado | offer.price nulo; a assinatura do ONE (Asaas, BRL) é do M3 e não tem plano com preço. |

## As seções, na ordem

1. A faixa de cima, só com uma promoção de verdade: o que é, até quando e um chamado
2. O topo: um título que promete o que muda para quem chegou e se diz em voz alta, uma frase com o que o produto faz, o chamado principal e o secundário, a linha de condições embaixo, uma prova curta e, embaixo ou ao lado, a figura grande do produto
3. O produto funcionando: uma figura que se entende sem ler, ou uma cena curta, só com o que ele faz hoje e com os dados de exemplo marcados como fictícios
4. A dor nas palavras do cliente: a frase dele como título, um objeto grande que mostra o problema resolvido, como um telefone com a conversa, três ou quatro cartões curtos e a frase que liga a dor à solução
5. Os recursos do dia a dia, de três a cinco, uma linha por recurso: o resultado no título, até duas linhas de apoio e uma figura grande ao lado, alternando os lados; os menores terminam em até três cartões curtos
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
- [ ] O título passa nos testes de references/principios.md, seção 17: em voz alta, trocando o nome, a palavra de dentro e a imagem
- [ ] Sem as letras, cada figura continua sendo um objeto, e nenhuma seção de recurso ficou só com caixas
- [ ] As figuras mostram só o que o produto faz hoje, e os dados inventados para elas levam a etiqueta
- [ ] A página tem a cara deste produto, e o efeito visual do modelo escolhido aparece nela
- [ ] A duração da demonstração é a mesma no topo, nos chamados e na agenda
- [ ] Os exemplos de código e as telas batem com o produto e com a documentação
- [ ] As regras da promoção são as mesmas na faixa, na seção, na janela, nos planos e nas perguntas frequentes
- [ ] Os depoimentos falam deste produto e vêm de clientes diferentes
- [ ] O que depende do plano está escrito perto do recurso

## A conferência automática

- O título promete em vez de nomear a categoria (`title_promises`)
- As figuras não pedem leitura (`figures_seen`)
- Cartões que se leem de relance (`cards_short`)
- Nenhum cartão com um buraco (`cards_no_holes`)
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

- Juridiq: a página de vendas de um software jurídico (vista em 2026-11-07): cada seção tem um objeto que se entende sem ler: a janela grande do sistema, o telefone, o radar, as colagens de telas; demonstração e teste no topo, com a linha de condições embaixo; a janela da promoção abre na metade da página, nunca na chegada, com recusa visível; barra fixa no celular quando o botão do topo sai da tela; demonstrações animadas com a etiqueta de exemplo fictício e botão de pausa; perguntas frequentes com as objeções de quem troca de sistema.
- JuriChat: a página de vendas do atendimento por WhatsApp (vista em 2026-11-07): as dores do dia a dia em quatro cartões antes da solução; a história de uma cliente em quatro passos, numa conversa presa na tela; os painéis do atendente e do gestor com números de exemplo; o que depende do plano escrito junto do recurso; o teste em destaque no topo e os 7 dias escritos nos planos.
