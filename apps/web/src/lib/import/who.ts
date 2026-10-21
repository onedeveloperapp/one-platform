/**
 * Who brings a firm's portfolio (migration 0032, `import_batch_for_writer`):
 * a partner, a lawyer, or who runs the firm's deadlines. The database decides;
 * this is what a screen shows or hides by.
 */
export const IMPORT_FUNCTIONS: readonly string[] = ["socio", "advogado", "controladoria"];

export const canImportPortfolio = (firmFunction: string | null | undefined): boolean =>
  typeof firmFunction === "string" && IMPORT_FUNCTIONS.includes(firmFunction);
