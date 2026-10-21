/**
 * The term of a one-time access (`plans.access_months`), as a reader says it:
 * whole years when the months divide by twelve ("1 ano"), months otherwise
 * ("18 meses"). The caller turns the parts into words with its own translator
 * (`access-term-years` / `access-term-months`, plural-aware), so the same
 * number reads right in both languages and in every namespace.
 */
export function accessTermParts(months: number): { unit: "years" | "months"; count: number } {
  const whole = Math.max(1, Math.floor(months));
  return whole % 12 === 0 ? { unit: "years", count: whole / 12 } : { unit: "months", count: whole };
}
