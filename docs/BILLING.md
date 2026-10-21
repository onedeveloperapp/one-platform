# Cobrança — escada, moedas e provedores

Desenho vigente da cobrança do FlyeeClub, escrito na fase 4 de `docs/PLANO-IMPLEMENTACAO.md` (2026-10-01). `docs/BILLING-AUDIT.md` é o histórico herdado do MedChina: os achados sobre webhooks e Asaas seguem úteis, os planos e valores de lá não valem aqui.

## Em uma tela

- **Dois planos pagos**: FlyeeClub (`kit`: pagamento único, válido por 1 ano, renovado com uma nova compra) e FlyeeClub Pro (`club`: assinatura mensal ou anual). O Pro de antes (`pro-*`) saiu da vitrine na migração `0025`: inativo, invendável, mantido pelo histórico. Sem compra, a conta fica no Gratuito. Todo plano pago pode ser usado em projetos de clientes. Mentoria e consultoria são serviços sob demanda, não planos: o painel oferece e o formulário de contato recebe.
- **A moeda escolhe o provedor**: real vai para o Asaas, dólar vai para a Stripe. Não existe chave de provedor.
- **Nada é liberado no checkout.** O acesso nasce no webhook do pagamento confirmado, de forma idempotente.
- **Uma só resposta para "o que esta conta pode usar"**: a função `org_entitlements(org)`. Tela nenhuma decide pelo nome ou slug do plano.
- **Preço travado**: a assinatura guarda o preço, a moeda e o cupom com que foi vendida. Mudar o preço do plano só afeta compras novas.
- **Nota fiscal**: o Asaas emite a NFS-e das vendas em real. As vendas em dólar ficam fora dele (ver "Nota fiscal").

## A escada

| Degrau | Planos | Cobrança | Dispositivos | O que libera |
|---|---|---|---|---|
| Gratuito | `gratuito` | nenhuma | 1 | amostras grátis do catálogo |
| FlyeeClub (`kit`) | `kit`, `kit-usd` | pagamento único, válido por `plans.access_months` (12) a partir da fatura paga | 1 | catálogo e atualizações (`catalog_access`), uso em projetos de clientes (`commercial_license`) |
| FlyeeClub Pro (`club`) | `club-mensal`, `club-anual` e as versões `-usd` | recorrente | 3 | o FlyeeClub, mais `advanced_lessons`, `recipes`, `roadmap_vote`, `meetings` e `open_the_hood` |
| Pro (fora da vitrine) | `pro-mensal`, `pro-anual` e as versões `-usd` | nenhuma: inativo desde `0025` | 5 | nada é vendido nem concedido; as linhas ficam pelo histórico |

- Cada plano existe uma vez por moeda: uma linha de `plans` em BRL e outra em USD, com o mesmo `family` e `tier`.
- `club-fundador-anual` é a oferta de fundador: BRL, fora da vitrine (`is_public = false`), alcançada só pelo link da oferta (`platform_settings.founders`).
- Os direitos são chaves numéricas de `plans.limits` (0 = desligado; `devices` é um teto). A lista fica em `packages/billing/src/entitlements.ts`. Desde a migração `0024`, `commercial_license` está ligada em todo plano pago: o uso em projetos de clientes não distingue degrau nenhum.
- **Renovação do kit**: comprar o kit de novo é renovar. A nova concessão começa quando a atual termina (`grant_entitlement_on_invoice` encadeia pelo maior `expires_at` vivo), então renovar cedo não joga dias fora. `org_entitlements` só conta a concessão em curso; a página de cobrança lê `entitlement_grants` para mostrar até quando o acesso vai, renovações incluídas.
- Os preços do seed são hipóteses de lançamento. Eles mudam em `/admin/billing`, nunca no código.

## Quem responde o que a conta pode usar

`org_entitlements(org)` (migração `0004`) soma, nesta ordem: o piso do Gratuito, cada concessão viva, a assinatura viva (ou em carência) e os add-ons. A soma nunca reduz um limite. A resposta traz `active`, `tier` (o degrau mais alto entre as fontes), `sources` (de onde vem cada direito) e `limits`.

Onde ler:

- **No navegador**: o hook `useEntitlements` (`apps/web/src/hooks/use-entitlements.ts`), com `has("advanced_lessons")` e `tier`.
- **No servidor e em código puro**: `hasEntitlement`, `limitOf` e `tierOf` de `@flyee/billing/entitlements`.
- **No SQL e no RLS**: `org_has_entitlement(org, key)`.

## Concessões e assinaturas

São duas tabelas, com papéis diferentes:

| | `entitlement_grants` | `subscriptions` |
|---|---|---|
| O que é | um direito concedido, sem renovação | o contrato recorrente da conta |
| Tipos | `kit` (compra), `comp` (cortesia), `license` (reservado) | um plano recorrente; o Gratuito também é uma linha |
| Quem cria | o webhook, no pagamento confirmado (`grant_entitlement_on_invoice`); o superadmin, na aba "Kits e cortesias" (`grant_entitlement`) | o checkout cria a linha `incomplete`; o webhook ativa |
| Quantas | várias por conta | uma viva por conta (`subscriptions_org_live_unique`) |
| Fim | o prazo (`expires_at`, 12 meses para o kit), reembolso ou estorno (`revert_paid_invoice`), ou revogação no admin | cancelamento, fim do período ou desistência do provedor |

O kit é idempotente por compra: a chave `invoice_key = provedor:id_da_compra` impede conceder duas vezes, e um kit reembolsado não volta com um webhook atrasado. Num kit parcelado, a compra é o parcelamento (o `installment` do Asaas, que toda parcela carrega), não a parcela: doze parcelas confirmadas concedem um prazo só.

## Moeda e provedor

- **Roteamento**: `providerForCurrency` em `packages/billing/src/index.ts`. BRL vai para o Asaas e USD para a Stripe. Uma moeda cujo provedor não tem chave configurada não pode ser comprada: o checkout responde `currency_unavailable`.
- **Moeda exibida ao visitante**: um link com `?moeda=BRL` ou `?moeda=USD` vence; o middleware guarda a escolha num cookie de um ano. Sem escolha, o idioma da página decide: português mostra real, inglês mostra dólar.
- **Guarda no Asaas**: o provedor recusa qualquer plano que não seja BRL (`asaas_currency_unsupported`), para um preço em dólar nunca ser cobrado como o mesmo número em reais.
- **Dados fiscais**: CPF ou CNPJ só são exigidos quando o provedor é o Asaas (`billing_profile_required`). Telefone e endereço são opcionais.
- **Pix**: só em BRL, oferecido quando a conta Asaas tem chave Pix ativa. `BILLING_PIX_ENABLED=false` desliga o Pix na hora.

## Do clique ao acesso

1. A vitrine (`/planos` ou `/settings/billing`) leva a `/assinatura?plan=<slug>`. Sem `plan`, a página abre o kit na moeda do visitante.
2. `startCheckout` (`apps/web/src/app/(dashboard)/settings/billing/actions.ts`) reserva a operação em `billing_operations` (tipo `access_checkout` para o kit, `checkout` para assinatura). A reserva é o que torna o clique duplo inofensivo.
3. O cupom passa por `validate_coupon`: família, moeda, validade e limite de usos.
4. O provedor cria a cobrança:
   - **FlyeeClub**: cobrança avulsa (Asaas `/payments`, à vista ou parcelada no cartão; Stripe Checkout em modo `payment`).
   - **FlyeeClub Pro**: assinatura no provedor (Asaas `/subscriptions`; Stripe Checkout em modo `subscription`).
   - **Parcelado em real** (kit ou anual): uma cobrança parcelada no Asaas (ver "Parcelamento").
5. A operação fecha. Para o kit, só registra o link de pagamento. Para assinatura, grava a linha `incomplete` com o preço vendido, a moeda, o código do cupom e, no parcelado, a referência do parcelamento com `renews = false`.

Respostas de erro do checkout: `coupon_invalid`, `currency_unavailable`, `billing_profile_required`, `offer_closed`, `pix_unavailable` e `unavailable`. Cada uma tem texto próprio na tela.

## Webhooks

| Provedor | Endereço | Autenticação |
|---|---|---|
| Asaas | `/api/webhooks/asaas` | header `asaas-access-token` igual a `ASAAS_WEBHOOK_TOKEN` |
| Stripe | `/api/webhooks/stripe` | assinatura com `STRIPE_WEBHOOK_SECRET` |

Cada evento do provedor vira um evento normalizado:

| Evento do provedor | Evento normalizado |
|---|---|
| Asaas `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` | `payment_succeeded`, mais `subscription_activated` quando a cobrança é de uma assinatura |
| Asaas `PAYMENT_OVERDUE`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` | `payment_failed` |
| Asaas `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE` | `payment_reverted` |
| Asaas `SUBSCRIPTION_DELETED` | `subscription_canceled` |
| Stripe `checkout.session.completed` (modo `payment`, pago) | `payment_succeeded` |
| Stripe `customer.subscription.created` e `.updated` | `subscription_activated` se ativa; `subscription_canceled` se `incomplete_expired`, `unpaid` ou `canceled` |
| Stripe `customer.subscription.deleted` | `subscription_canceled` |
| Stripe `invoice.paid` / `invoice.payment_failed` | `payment_succeeded` / `payment_failed` |
| Stripe `charge.refunded`, `charge.dispute.created` | `payment_reverted` |

O que cada evento normalizado faz (`apps/web/src/app/api/webhooks/[provider]/route.ts`):

- **`payment_succeeded`**: grava a fatura como paga. No kit, concede o direito pelo prazo do plano e, só na primeira entrega, conta o cupom, registra `kit.purchased` e manda o recibo no idioma de cada gestor, com a data em que o acesso termina; num kit parcelado, a primeira parcela confirmada concede e registra a venda pelo valor inteiro (o preço do plano com o cupom, porque o Asaas só manda o valor da parcela). No anual parcelado, a primeira parcela ativa a compra. Uma assinatura em atraso volta a ativa. A primeira fatura de uma assinatura entra na atribuição de campanha.
- **`subscription_activated`**: abre ou mantém o período (`lib/billing-window.ts`), encerra a assinatura substituída, inclusive no provedor, e, na primeira ativação, avisa a conta, registra `subscription.started` e conta o cupom.
- **`payment_failed`**: grava a fatura com o link de pagamento, que é o caminho de recuperação. Uma assinatura ativa passa a `past_due` e abre a carência.
- **`subscription_canceled`**: cancela a linha, devolve a conta ao Gratuito, registra `subscription.canceled` e revoga os tokens da CLI se nenhuma outra fonte mantiver o catálogo.
- **`payment_reverted`**: marca a fatura como reembolsada, revoga o que ela comprou (o kit, inclusive quando a fatura é uma parcela: o webhook passa o parcelamento a `revert_paid_invoice`) e encerra a compra parcelada. Os tokens da CLI caem se o acesso acabou.

Idempotência: cada entrega passa por `claim_billing_webhook_event` e `complete_billing_webhook_event`, com teto de tentativas. A rota processa até 6 segundos na resposta e continua o resto em `after()`. Uma reentrega durante o processamento recebe `event_in_progress` e é ignorada.

Os eventos para assinar no painel de cada provedor são os da tabela acima. O passo a passo do Asaas está em `docs/ASAAS-GO-LIVE.md`.

## Estados da assinatura

| De | Para | Quando |
|---|---|---|
| `incomplete` | `active` | ativação do provedor, ou primeira parcela paga de uma compra parcelada |
| `incomplete` | `canceled` | checkout abandonado por 24 horas (job diário, que também apaga a cobrança no Asaas), ou desistência do provedor |
| `active` | `past_due` | pagamento recusado ou vencido |
| `past_due` | `active` | pagamento confirmado |
| `active` ou `past_due` | `canceled` | o provedor cancela, ou o fim do período chega com `cancel_at_period_end` (job a cada 15 minutos) |

Durante a carência de `past_due` (`platform_settings.dunning.grace_days`, 7 dias), o acesso continua. Depois dela, `org_entitlements` deixa de contar a assinatura, mas a linha segue `past_due` até o provedor desistir ou o pagamento chegar.

## Parcelamento

- **Onde existe**: no kit e nos planos anuais, em real, só no cartão, até `platform_settings.billing.max_installments` (o Asaas aceita no máximo 12). Nunca num plano mensal (`lib/payment-choice.ts`).
- **O que é**: o Asaas não parcela assinaturas. O anual parcelado é uma compra única dividida pela operadora do cartão, e não renova sozinha. A tela diz isso antes do pagamento. O kit parcelado é a mesma compra única de sempre, dividida em parcelas: o prazo de 1 ano conta da primeira parcela confirmada.
- **Ativação**: o checkout guarda a referência do parcelamento em `subscriptions.provider_payment_id`, que toda parcela carrega no webhook. A primeira parcela paga ativa a linha por um período a partir do pagamento, com `cancel_at_period_end`.
- **Uma venda, não doze**: o Asaas confirma todas as parcelas em segundos, em entregas paralelas. Só o handler que tira a linha de `incomplete` registra a venda: aviso, evento, atribuição e Purchase no Meta e no GA4, pelo valor total.
- **Reembolso**: reembolsar a compra encerra o período na hora, porque não existe assinatura no provedor cujo cancelamento a encerraria depois.
- **Fim do período**: o job de cancelamentos encerra a linha. O integrante compra de novo para continuar.

Na vitrine, o card do FlyeeClub em reais mostra "ou em até Nx de R$ X no cartão", com N vindo de `platform_settings.billing.max_installments` e o valor da parcela calculado do preço já com cupom, como o Asaas divide: em centavos inteiros, com a sobra na última parcela (`lib/installments.ts`). O checkout oferece de 1x até N e mostra o valor da última parcela quando ela é diferente. Em dólar não há parcelamento, e a linha não aparece. O mesmo vale para `/settings/billing`.

## Fim do kit e renovação

- **Prazo**: `plans.access_months` (12 no seed; muda em `/admin/billing`, nunca no código). A concessão nasce com `expires_at` e `org_entitlements` para de contá-la nesse dia. Sem prazo (`null`), a concessão não termina.
- **Aviso**: 15 dias antes, um sino e um e-mail (os mesmos do período pago que não renova), reservados em `claim_access_end_notices`; uma concessão já seguida de renovação não é avisada.
- **Fim**: no dia, `claim_access_endings` entrega a concessão ao job, que consulta `org_entitlements`: se nada mais mantém o catálogo (nem renovação, nem assinatura), avisa o integrante (sino e e-mail "seu acesso terminou") e revoga os tokens da CLI (`revoke_member_tokens`), como no fim de uma assinatura sem kit. As ferramentas instaladas continuam funcionando; o que para é a atualização.
- **Renovar**: é comprar o kit de novo, em `/settings/billing` ("Renovar o acesso") ou pelo mesmo checkout. O novo prazo começa quando o atual termina.

## Preço travado

`subscriptions.price_cents`, `currency` e `coupon_code_snapshot` são gravados no checkout e nunca mudam. Os provedores também travam: o Asaas guarda o valor na assinatura e a Stripe recebe o preço em linha (`price_data`) em cada checkout. Mudar o preço de um plano em `/admin/billing` só vale para compras novas. A aba Assinaturas mostra o preço vendido de cada linha.

## Cupons

- **Tipos**: percentual, ou valor fixo. O valor fixo exige moeda e só vale para planos nessa moeda.
- **Alcance**: `plan_families` limita a famílias (`kit`, `club`; `pro` só alcança o histórico). Vazio vale para todas.
- **Duração**: sempre `forever`. Os dois provedores aplicam o desconto em todo ciclo: o Asaas cobra o valor com desconto e a Stripe espelha um cupom permanente com id `flyee-<cupom>-<moeda>`. No kit, o desconto vale no pagamento único.
- **Contagem de usos**: `redeem_coupon` (migração `0020`) conta um uso por compra, numa só transação. A assinatura reserva o uso gravando `coupon_id`, então uma reentrega não conta de novo. O kit conta na primeira concessão da fatura.

## Cancelamento, reembolso e estorno

- **Cancelar**: o integrante cancela em `/settings/billing`, com motivo opcional (`cancel_reason`) e nota (`cancel_note`). O provedor para de renovar na hora, o acesso segue até o fim do período e o cancelamento pode ser desfeito até lá. Eventos: `subscription.cancel_requested` no pedido e `subscription.canceled` quando o período acaba.
- **Reembolsar**: no painel do provedor. O webhook marca a fatura como reembolsada e revoga o que ela comprou. Numa assinatura recorrente, o operador também cancela a assinatura no provedor; o webhook de cancelamento encerra a linha.
- **Reembolso parcial**: hoje é tratado como reembolso total. Ele revoga o kit (o reembolso de uma parcela revoga a concessão do parcelamento inteiro) e encerra a compra parcelada. Para uma cortesia sem tirar o acesso, use cupom ou desconto, nunca reembolso parcial.
- **Estorno (chargeback)**: igual ao reembolso.
- **Garantia**: `platform_settings.guarantee.days` (7) só define o prazo que as telas mostram. O reembolso em si é feito no provedor.

## Inadimplência e Pix provisório

- **Carência**: `platform_settings.dunning.grace_days`. A conta recebe aviso no sino, com o prazo, e `/settings/billing` mostra o botão de pagamento: o portal da Stripe, ou o link da fatura no Asaas. Se o provedor encerrar a assinatura por falta de pagamento, o integrante recebe o e-mail de assinatura encerrada com esse motivo.
- **Pix provisório**: `platform_settings.pix_provisional_access` (desligado no seed) libera o plano por algumas horas enquanto o Pix não confirma, uma vez por conta.

## Avisos ao integrante

Cada transição de cobrança é avisada no sino do painel e, quando faz sentido, por e-mail. Os avisos saem de `lib/billing-notices.ts`, chamados pelo webhook e pelos jobs, cada pessoa no idioma do próprio perfil. O sino alcança todos os integrantes da conta; o e-mail vai para quem a administra (dono e admins).

| Momento | Sino | E-mail |
|---|---|---|
| Assinatura ativada | sim | confirmação com o que o plano libera, lido dos limites do plano |
| FlyeeClub concedido | sim, com a data em que o acesso termina | recibo, com a data em que o acesso termina (ou "sem prazo") e o aviso da nota fiscal em compras em real |
| Pagamento falhou (entrou em carência) | sim | não: o provedor já escreve para o pagador |
| Pagamento atrasado confirmado | sim | não |
| Período pago que não renova termina em até 15 dias | sim, uma vez | sim, uma vez |
| FlyeeClub termina em até 15 dias (sem renovação encadeada) | sim, uma vez | sim, uma vez: o mesmo texto |
| FlyeeClub terminou e nada mais mantém a loja | sim, uma vez | sim: o que continua, o que deixa de chegar, como renovar |
| Assinatura encerrada | sim | sim: o que continua e o que deixa de chegar |

- **Um plano é sempre chamado pelo nome que tem nos dados** (`plans.name`). Nenhum texto escreve "kit" ou "assinatura" por conta própria, então renomear um plano em `/admin/billing` muda os avisos junto.
- **O que continua depois do fim** vem de `org_entitlements`, lido depois da mudança: quem tem o kit lê que o acesso à loja continua, quem não tem lê que as versões novas deixam de chegar. É a mesma resposta que a API da CLI usa.
- **Por que acabou**: o e-mail diz se foi a pedido do integrante, por falta de pagamento ou porque o período pago terminou. Quando a linha não registra motivo (encerrada direto no provedor), o e-mail informa o fim sem atribuir motivo.
- **Uma vez só**: o webhook e o job de liquidação encerram as mesmas assinaturas no mesmo instante. Só quem de fato tira a linha do estado vivo registra o evento e avisa. O aviso de fim de período é reservado no banco antes do envio (`claim_term_end_notices`, migração `0023`), e uma compra nova, que move o fim do período, libera o aviso de novo.
- **Reembolso e estorno não geram e-mail**: são tratados pelo suporte, que já está em contato com a pessoa.
- **Um aviso nunca derruba a conciliação**: as funções de aviso não lançam erro. Quando rodam, o banco já está certo, e um webhook que falhasse por causa de um sino seria reenviado pelo provedor e conciliaria tudo outra vez.

## Tokens da CLI

Os tokens da CLI só valem enquanto a conta tem `catalog_access`. Eles são revogados quando o acesso acaba de fato: assinatura cancelada sem kit, kit reembolsado, cortesia revogada no admin, conta suspensa ou excluída. `revokeTokensIfAccessEnded` (`lib/billing-lifecycle.ts`) consulta `org_entitlements` depois da mudança, então quem tem o kit mantém as atualizações quando a assinatura acaba. As ferramentas já instaladas continuam funcionando; o que para é a atualização. A revogação é uma segunda camada: na fase 3, a API da CLI também consulta `org_entitlements` em toda chamada, então um token que escape da revogação não baixa nada.

## Nota fiscal

- **Vendas em real**: a NFS-e é emitida pelo próprio Asaas, configurado no painel dele para emitir a nota de cada cobrança confirmada. A plataforma não chama a API de notas. O recibo do kit avisa que a nota chega pelo Asaas.
- **Vendas em dólar**: a Stripe não passa pelo Asaas, então nenhuma nota é emitida automaticamente. Como documentar essas vendas é decisão contábil pendente.
- `invoices.fiscal_document_url` fica reservado para guardar o link da nota quando houver integração.

## Eventos e auditoria

- **`product_events`** (atribuídos ao dono da conta): `checkout.started` (`offer`), `kit.purchased`, `subscription.started` (`offer`), `subscription.cancel_requested` (`reason`, `tier_from`) e `subscription.canceled` (`reason`, `tier_from`).
- **`audit_events`**: `kit.checkout_started`, `subscription.checkout_started`, `billing.grant_reverted` (kit reembolsado) e `billing.purchase_reverted` (compra parcelada reembolsada), além das ações dos consoles.
- **Meta CAPI e GA4**: `Purchase` uma vez por fatura paga (uma vez por venda no parcelado) e `Subscribe` uma vez por assinatura.

## Configuração

| Onde | Chave | Para quê |
|---|---|---|
| `platform_settings` | `dunning` | dias de carência |
| `platform_settings` | `billing` | teto de parcelas |
| `platform_settings` | `guarantee` | prazo de garantia exibido |
| `platform_settings` | `founders` | oferta de fundador: plano, vagas, prazo (a chave `compare_plan_slug`, a âncora riscada de antes, não é mais lida desde 2026-10-07) |
| `platform_settings` | `pix_provisional_access` | acesso provisório do Pix |
| env | `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_BASE_URL` | Asaas (BRL) |
| env | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe (USD) |
| env | `BILLING_PIX_ENABLED` | `false` desliga o Pix |

Jobs no Inngest: liquidação de cancelamentos a cada 15 minutos, manutenção diária às 04:20 UTC (leases vencidos e checkouts abandonados) e, todo dia às 13:15 UTC, os avisos de fim de período pago e de fim do kit e a liquidação dos kits que terminaram.

## Consoles

- **`/admin/billing`**: abas Planos (moeda, família, degrau, tipo), Módulos, Cupons (moeda e famílias), Assinaturas (preço vendido, renovação, motivo de cancelamento, suspensão que revoga os tokens), Kits e cortesias (conceder e revogar) e Ofertas (fundador, com a prévia do que o visitante vê).
- **`/settings/billing`**: a escada na moeda do integrante, o degrau atual, cancelar e desfazer, faturas, dados de cobrança, checkout pendente e recuperação de pagamento. A versão orientada a objetivo vem na fase 5.

## Adiado e em aberto

- **Proração e troca agendada**: a troca de plano hoje é um checkout novo que encerra o anterior, e a tela avisa que o período pago não é creditado. Uma troca agendada ganha colunas próprias quando for construída.
- **Reembolso parcial**: decidir se deve manter o acesso.
- **Nota das vendas em dólar**: decisão contábil.
