// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { SIGN_IN_MARK } from "@/lib/court-browser/marks";
import { courtDomainOf, onCourtDomain, signInState } from "@/lib/court-browser/sign-in-page";

/** A page of a court's sign-in, as the browser has it. Every name and value here is invented. */
function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

const marked = (doc: Document, name: string) => doc.querySelector(`[${SIGN_IN_MARK}="${name}"]`);

// The single sign-on of the eproc of TJSP (Keycloak), as its page is built: the form of the login, a certificate's
// button, and a legacy form of the system hidden beside it.
const SSO = `
  <form id="kc-form-login" action="/realms/eproc/login-actions/authenticate" method="post">
    <label for="username">CPF</label><input id="username" name="username" type="text">
    <label for="password">Senha</label><input id="password" name="password" type="password">
    <input id="kc-login" name="login" type="submit" value="Entrar">
    <button type="button" id="kc-login-certificate">Certificado digital</button>
  </form>
  <div style="display:none">
    <form id="frm-login"><input type="hidden" id="txtUsuario"><input type="text" id="showPwd"></form>
  </div>`;

describe("signInState", () => {
  it("finds the court's form of a login and a password, and marks where ONE types and presses", () => {
    const doc = page(SSO);
    expect(signInState(doc, true)).toEqual({ kind: "form" });
    expect(marked(doc, "login")?.id).toBe("username");
    expect(marked(doc, "password")?.id).toBe("password");
    // The submit, never the certificate's button.
    expect(marked(doc, "submit")?.id).toBe("kc-login");
  });

  it("reads a form without marking anything when asked only where it stands", () => {
    const doc = page(SSO);
    expect(signInState(doc)).toEqual({ kind: "form" });
    expect(doc.querySelector(`[${SIGN_IN_MARK}]`)).toBeNull();
  });

  it("says the court refused the login, or blocked the account, by the court's words", () => {
    expect(
      signInState(page(`${SSO}<span id="input-error" aria-live="polite">Usuário ou senha inválidos.</span>`)),
    ).toEqual({
      kind: "refused",
    });
    expect(signInState(page(`${SSO}<div class="alert alert-error">Conta temporariamente bloqueada.</div>`))).toEqual({
      kind: "blocked",
    });
    // Words the page keeps hidden say nothing.
    expect(signInState(page(`${SSO}<div class="alert" style="display:none">Senha incorreta</div>`))).toEqual({
      kind: "form",
    });
  });

  it("finds the court's code in one field, and says when the court refused the last one", () => {
    const otp = `<form id="kc-otp-login-form"><label for="otp">Código de autenticação</label>
      <input id="otp" name="otp" type="text"><input id="kc-login" type="submit" value="Entrar"></form>`;
    const doc = page(otp);
    expect(signInState(doc, true)).toEqual({ kind: "code", boxes: 0, refused: false });
    expect(marked(doc, "code")?.id).toBe("otp");
    expect(marked(doc, "code-submit")?.id).toBe("kc-login");
    expect(signInState(page(`${otp}<span class="kc-feedback-text">Código de autenticação inválido.</span>`))).toEqual({
      kind: "code",
      boxes: 0,
      refused: true,
    });
  });

  it("finds one box per digit, opened over the form of the login that stays behind it", () => {
    const boxes = Array.from({ length: 6 }, () => '<input type="text" class="otp-box" maxlength="1">').join("");
    const doc = page(`
      <form id="formLogin">
        <input name="Usuario" type="text" id="login"><input name="Senha" type="password" id="senha">
        <input type="reset" value="Limpar"><input type="button" name="entrar" value="Entrar">
      </form>
      <div class="modal">${boxes}<input type="button" value="Validar"></div>`);
    expect(signInState(doc, true)).toEqual({ kind: "code", boxes: 6, refused: false });
    expect(marked(doc, "code-0")).not.toBeNull();
    expect(marked(doc, "code-5")).not.toBeNull();
    expect((marked(doc, "code-submit") as HTMLInputElement | null)?.value).toBe("Validar");
  });

  it("presses the button that says enter where the form has no submit, never the one that clears it", () => {
    const doc = page(`
      <form id="formLogin">
        <input name="Usuario" type="text" id="login"><input name="Senha" type="password" id="senha">
        <input type="button" name="limpar" value="Limpar"><input type="button" name="entrar" value="Entrar">
      </form>
      <div class="modal" style="display:none"><input type="text" class="otp-box" maxlength="1"></div>`);
    expect(signInState(doc, true)).toEqual({ kind: "form" });
    expect((marked(doc, "submit") as HTMLInputElement | null)?.name).toBe("entrar");
  });

  it("says a captcha is asked, which ONE never answers", () => {
    expect(
      signInState(page(SSO.replace("</form>", '<div class="g-recaptcha" data-sitekey="x"></div></form>'))),
    ).toEqual({ kind: "captcha" });
  });

  it("never takes a court's form that signs or sends for a sign-in, though it asks a user and a password", () => {
    expect(
      signInState(
        page(`<form id="frmAssinatura" action="/eproc/controlador.php?acao=assinar">
          <label for="u">Usuário</label><input id="u" name="txtUsuario">
          <label for="p">Senha</label><input id="p" type="password">
          <button type="submit">Assinar e protocolar</button></form>`),
      ),
    ).toEqual({ kind: "in" });
  });

  it("reads a court's own screen as signed in: a field that names a code, a password to sign", () => {
    expect(
      signInState(
        page(`<h1>Peticionamento</h1><label for="c">Código do assunto</label><input id="c" name="txtCodigoAssunto">
          <label for="s">Senha para assinar</label><input id="s" type="password">`),
      ),
    ).toEqual({ kind: "in" });
  });
});

describe("the court's domain", () => {
  it("is the court's own name of each system", () => {
    expect(courtDomainOf("eproc1g.tjsp.jus.br")).toBe("tjsp.jus.br");
    expect(courtDomainOf("projudi.tjgo.jus.br")).toBe("tjgo.jus.br");
  });

  it("is where the login is typed, over HTTPS only", () => {
    expect(onCourtDomain("https://sso.tjsp.jus.br/realms/eproc/protocol/openid-connect/auth", "tjsp.jus.br")).toBe(
      true,
    );
    expect(onCourtDomain("https://eproc1g.tjsp.jus.br/eproc/", "tjsp.jus.br")).toBe(true);
    expect(onCourtDomain("http://sso.tjsp.jus.br/", "tjsp.jus.br")).toBe(false);
    expect(onCourtDomain("https://tjsp.jus.br.example.com/", "tjsp.jus.br")).toBe(false);
    expect(onCourtDomain("https://eviltjsp.jus.br/", "tjsp.jus.br")).toBe(false);
    expect(onCourtDomain("not an address", "tjsp.jus.br")).toBe(false);
  });
});
