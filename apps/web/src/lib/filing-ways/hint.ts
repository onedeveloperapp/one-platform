/**
 * What the screens show of a lawyer's court login (migration 0263, `begin_court_login`): a CPF with its middle hidden
 * ("529.***.***-25"), any other login by its first two characters. Never the login whole: the database refuses a
 * hint with six digits in a row. Pure.
 */
export function loginHint(login: string): string {
  const clean = login.trim();
  const digits = clean.replace(/\D/g, "");
  if (digits.length === 11 && /^[\d.\-\s]+$/.test(clean)) return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
  return `${clean.slice(0, 2)}***`;
}
