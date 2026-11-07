# Plano da página home: Página de vendas

Escrito em 2026-11-07. Onde fica: o endereço principal do produto, ou o destino das campanhas e dos links. O roteiro completo do tipo está no app, em references/tipos/landing.md.

## Os fatos

| O quê | Valor |
|---|---|
| o nome do produto oferecido | ONE |
| o que ele é, em uma frase | Software de automação com IA para escritórios de contencioso de massa: atende o cliente no WhatsApp do escritório, confere os documentos, escreve a peça, conta os prazos e monta o pacote do protocolo, e o escritório escolhe o que uma pessoa revisa. |
| para quem é a página, em uma frase | Sócios e equipes de escritórios de advocacia de contencioso de massa no Brasil. |
| o texto do botão principal | Entrar na lista de espera |
| o texto do segundo chamado, se houver | Falar com a gente |
| o endereço da página para a conferência | / |

Os campos em [a decidir] são perguntados numa mensagem só, cada um com uma sugestão.

## As seções, na ordem

1. A faixa de cima, só com uma promoção de verdade: o que é, até quando e um chamado
2. O topo: para quem é e o resultado no título, uma frase com o que o produto faz, o chamado principal e o secundário, a linha de condições embaixo e uma prova curta
3. O produto funcionando: a tela real, um vídeo curto ou uma demonstração animada com dados de exemplo marcados como fictícios
4. A dor nas palavras do cliente, em três ou quatro cartões, e a frase que liga a dor à solução
5. Os recursos do dia a dia, um por bloco, com o resultado no título e a tela ao lado
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
- [ ] A duração da demonstração é a mesma no topo, nos chamados e na agenda
- [ ] Os exemplos de código e as telas batem com o produto e com a documentação
- [ ] As regras da promoção são as mesmas na faixa, na seção, na janela, nos planos e nas perguntas frequentes
- [ ] Os depoimentos falam deste produto e vêm de clientes diferentes
- [ ] O que depende do plano está escrito perto do recurso

## A conferência automática

- O botão principal na primeira tela do celular (`cta_first_screen`)
- Um título principal (h1) (`h1_present`)
- Números que não começam em zero (`numbers_not_zero`)
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
- Vídeo automático sem som, com capa (`video_autoplay_ok`)
- A regra de menos movimento (`reduced_motion`)
- Imagens com texto alternativo (`images_alt`)

## Modelos deste tipo

- Juridiq: a página de vendas de um software jurídico (vista em 2026-11-07): demonstração e teste no topo, com a linha de condições embaixo; a janela da promoção abre na metade da página, nunca na chegada, com recusa visível; barra fixa no celular quando o botão do topo sai da tela; demonstrações animadas com a etiqueta de exemplo fictício e botão de pausa; perguntas frequentes com as objeções de quem troca de sistema.
- JuriChat: a página de vendas do atendimento por WhatsApp (vista em 2026-11-07): as dores do dia a dia em quatro cartões antes da solução; a história de uma cliente em quatro passos, numa conversa presa na tela; os painéis do atendente e do gestor com números de exemplo; o que depende do plano escrito junto do recurso; o teste em destaque no topo e os 7 dias escritos nos planos.
