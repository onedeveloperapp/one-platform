import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { queuePackageSignature } from "@/lib/cases/package-signature-work";
import { getVault } from "@/lib/connections/vault";
import { getMemberContext } from "@/lib/member/context";
import {
  PSC_COLUMNS,
  PSC_COOKIE_PATH,
  PSC_STATE_COOKIE,
  pscClientFor,
  pscRedirectUri,
  type PscRow,
} from "@/lib/psc/provider";
import { signForCourt } from "@/lib/psc/sign";
import { isSignatureHours, type SignatureOutcome } from "@/lib/psc/signature";
import { connectionRefusal } from "@/lib/whatsapp/session";
import { type CertificateFacts, certificateFacts } from "@flyee/psc/certificate";
import { MAX_PERSON_LIFETIME_SECONDS, PscError } from "@flyee/psc/types";

/**
 * Where a PSC sends the lawyer back after they authorized ONE to sign with
 * their certificate in the cloud (`startLawyerSignature`). The state must be
 * the one the cookie of this lawyer's own start kept, for the connection it
 * names, which is this lawyer's own; the code is exchanged with the verifier
 * that cookie kept (PKCE). The authorization is kept only for the lawyer's
 * own certificate: a person's certificate (never a company's, never an AC's
 * of the chain) whose CPF, as ICP-Brasil writes it, is the one the lawyer
 * declared, in force, pinned by its serial; and only for a session of
 * signatures, never a token of one signature a PSC granted in its place. The PSC's token is sealed in the vault with the address it was
 * issued at and its end (what the PSC gave, never more than the lawyer asked,
 * the norm's 7 days or the certificate's own validity), and ONE then signs a
 * short text with it once, through the same path a filing takes, so a PSC
 * whose signature does not hold is found now and not on the day of a filing.
 * A test the PSC did not answer leaves the authorization kept (the first real
 * signature checks it again); any other failed test ends it. Nothing of the
 * token is ever in an address, a log or a message.
 */

const CASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const back = (request: NextRequest, outcome: SignatureOutcome, backToCase: string | null = null) => {
  const destination = new URL("/settings/atuacao", request.url);
  destination.searchParams.set("assinatura", outcome);
  // The case the lawyer came from, by its id alone: their practice's card offers the way back to it.
  if (backToCase && CASE_ID.test(backToCase)) destination.searchParams.set("voltar", backToCase);
  destination.hash = "team-cloud-signature";
  return NextResponse.redirect(destination);
};

const same = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** The short text ONE signs once to try a new authorization, recorded by its hash in the lawyer's list of uses. */
const checkText = (when: Date) =>
  new TextEncoder().encode(`Teste da assinatura em nuvem autorizada ao ONE em ${when.toISOString()}.`);

/** Which certificate the authorization reaches is the lawyer's own, or why none is. */
function lawyersCertificate(
  certificates: { alias: string; facts: CertificateFacts }[],
  declared: string,
  now: number,
): { ok: true; facts: CertificateFacts } | { ok: false; outcome: SignatureOutcome } {
  // An AC a PSC lists beside the holder's certificate is the chain's, nobody's to sign with.
  const holders = certificates.filter((item) => !item.facts.authority);
  if (holders.length === 0) return { ok: false, outcome: "sem-certificado" };
  const own = holders.filter((item) => item.facts.cpf === declared);
  if (own.length === 0) {
    const companyOnly = holders.every((item) => item.facts.cpf === null && item.facts.cnpj !== null);
    return { ok: false, outcome: companyOnly ? "nao-pessoal" : "outro-titular" };
  }
  const inForce = own
    .filter((item) => item.facts.validFrom.getTime() <= now && item.facts.validUntil.getTime() > now)
    .sort((a, b) => b.facts.validUntil.getTime() - a.facts.validUntil.getTime());
  return inForce[0] ? { ok: true, facts: inForce[0].facts } : { ok: false, outcome: "certificado-vencido" };
}

export async function GET(request: NextRequest) {
  // The token's life counts from before it was asked for.
  const startedAt = Date.now();
  const cookieStore = await cookies();
  const kept = cookieStore.get(PSC_STATE_COOKIE)?.value ?? "";
  cookieStore.delete({ name: PSC_STATE_COOKIE, path: PSC_COOKIE_PATH });
  const [state, connectionId, verifier, hoursText, backText] = kept.split(".");
  const backToCase = backText && CASE_ID.test(backText) ? backText : null;
  const query = request.nextUrl.searchParams;
  const hours = Number(hoursText);
  if (!state || !connectionId || !verifier || !isSignatureHours(hours) || !same(state, query.get("state") ?? "")) {
    return back(request, "expirada", backToCase);
  }

  const context = await getMemberContext();
  if (!context?.firm) return back(request, "erro", backToCase);
  if (await connectionRefusal(context)) return back(request, "erro", backToCase);
  const firm = context.firm;

  // Read under the lawyer's own session: a connection of another firm, or of a colleague, is not found.
  const { data: connection } = await context.supabase
    .from("connections")
    .select("id, status, provider, person_id")
    .eq("id", connectionId)
    .eq("org_id", firm.id)
    .eq("person_id", context.userId)
    .maybeSingle();
  if (!connection || !String(connection.provider).startsWith("psc.")) return back(request, "erro", backToCase);
  // A start that came to nothing ends, decided under the row's lock: an authorization in force is left as it was.
  const giveUp = async () => {
    await context.supabase.rpc("end_lawyer_signature", { target_connection: connectionId, target_only_pending: true });
  };
  const providerError = query.get("error");
  if (providerError) {
    await giveUp();
    return back(request, providerError === "access_denied" ? "recusada" : "erro");
  }

  const [{ data: row }, { data: declaredRow }] = await Promise.all([
    context.supabase
      .from("psc_providers")
      .select(PSC_COLUMNS)
      .eq("slug", String(connection.provider).slice(4))
      .maybeSingle(),
    context.supabase.from("lawyer_cpfs").select("cpf").eq("user_id", context.userId).maybeSingle(),
  ]);
  const declared = typeof declaredRow?.cpf === "string" ? declaredRow.cpf : "";
  const client = row ? await pscClientFor(row as PscRow) : null;
  const access = getVault();
  const code = query.get("code") ?? "";
  if (!client || !access.ok || !code || !/^[0-9]{11}$/.test(declared)) {
    await giveUp();
    return back(request, "erro", backToCase);
  }

  let accessToken: string;
  let expiresIn: number;
  let facts: CertificateFacts;
  try {
    const token = await client.provider.exchangeCode({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      code,
      redirectUri: pscRedirectUri(),
      codeVerifier: verifier,
    });
    accessToken = token.accessToken;
    expiresIn = token.expiresIn;
    // A session is what ONE asked: a token of one signature would be spent by the test and end at the first filing.
    if (token.scope && !token.scope.split(/\s+/).includes("signature_session")) {
      await giveUp();
      return back(request, "sem-sessao", backToCase);
    }
    if (token.identification?.type === "CNPJ") {
      await giveUp();
      return back(request, "nao-pessoal", backToCase);
    }
    if (token.identification?.type === "CPF" && token.identification.value !== declared) {
      await giveUp();
      return back(request, "outro-titular", backToCase);
    }
    const readable = (await client.provider.certificates(accessToken)).flatMap((item) => {
      try {
        return [{ alias: item.alias, facts: certificateFacts(item.pem) }];
      } catch {
        return [];
      }
    });
    const found = lawyersCertificate(readable, declared, Date.now());
    if (!found.ok) {
      await giveUp();
      return back(request, found.outcome, backToCase);
    }
    facts = found.facts;
  } catch (thrown) {
    await giveUp();
    if (thrown instanceof PscError && thrown.code === "denied") return back(request, "recusada", backToCase);
    if (thrown instanceof PscError && thrown.code === "expired") return back(request, "expirada", backToCase);
    return back(request, "erro", backToCase);
  }

  // What the PSC gave, never more than the lawyer asked, the norm's 7 days or the certificate's own validity.
  const asked = hours * 3600;
  const lives = Math.floor(
    Math.min(
      expiresIn > 0 ? expiresIn : asked,
      asked,
      MAX_PERSON_LIFETIME_SECONDS,
      (facts.validUntil.getTime() - startedAt) / 1000,
    ),
  );
  if (lives < 60) {
    await giveUp();
    return back(request, "certificado-vencido", backToCase);
  }
  const place = { orgId: firm.id, connectionId };
  let sealed: Awaited<ReturnType<typeof access.vault.seal>>;
  try {
    sealed = await access.vault.seal(
      place,
      // The address it was issued at goes with the token: it is never sent anywhere else.
      { access_token: accessToken, origin: client.origin },
      {
        expiresAt: new Date(startedAt + lives * 1000),
        metadata: {
          holder: facts.holderName,
          // Only the middle of the certificate's CPF, as the screens show one; the database holds it against the
          // declared one, so what it checks is what the certificate says.
          holder_cpf_middle: (facts.cpf ?? "").slice(3, 9),
          valid_until: facts.validUntil.toISOString(),
          issuer: facts.issuerName,
          serial: facts.serialHex,
          // This very certificate: what ONE signs with, whatever else the token reaches under the same serial.
          fingerprint: facts.sha256Hex,
          hours,
        },
      },
    );
  } catch {
    sealed = { kind: "refused", code: "failed" };
  }
  if (sealed.kind !== "sealed") {
    await giveUp();
    return back(request, "erro", backToCase);
  }

  const check = await signForCourt({
    orgId: firm.id,
    personId: context.userId,
    purpose: "authorization.check",
    connectionId,
    documents: [{ id: "teste", content: checkText(new Date()) }],
  });
  // The packages of the lawsuits this lawyer signs that waited for an authorization are signed now (0042).
  if (check.ok || check.code === "psc_unavailable") await queuePackageSignature(null);
  if (check.ok) return back(request, "autorizada", backToCase);
  // A PSC that did not answer leaves the authorization kept: the first signature of a filing checks it again.
  if (check.code === "psc_unavailable") return back(request, "teste-pendente", backToCase);
  await context.supabase.rpc("end_lawyer_signature", { target_connection: connectionId, target_only_pending: false });
  return back(request, "teste-falhou", backToCase);
}
