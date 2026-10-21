/**
 * How a card purchase in reais is split into installments, the way Asaas
 * splits it: the total is divided evenly in whole cents and what does not
 * divide goes to the LAST installment (Asaas, "Criar uma cobrança parcelada":
 * R$ 350,00 in 12x is 11 of R$ 29,16 and one of R$ 29,24). The price pages
 * show `each` ("em até 12x de R$ 8,08"); the checkout also names `last` when
 * it differs, so no number on a page is one the member will not be charged.
 * Pure, shared by the price cards, the billing page and the checkout.
 */
export function splitInstallments(totalCents: number, count: number): { each: number; last: number } {
  const installments = Math.max(1, Math.floor(count));
  const each = Math.floor(totalCents / installments);
  return { each, last: totalCents - each * (installments - 1) };
}
