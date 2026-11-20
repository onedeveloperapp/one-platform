import EmailShell, { EmailButton, EmailText } from "./shell";

export type AiHealthEmailProps = {
  /** `down`: the provider refuses the platform's account; `up`: it answers again. */
  kind: "down" | "up";
  /** The provider's name as the operator knows it (Anthropic, Gemini). */
  provider: string;
  /** When it went down, or came back: already formatted for the reader. */
  atLabel: string;
  /** Runs refused since it went down (only for `down`). */
  failures?: number;
  /** The operator's console of the AI. */
  consoleUrl: string;
};

/**
 * Internal notice of the platform's AI account (migration 0255). It goes to the platform's operators only, so it is
 * written in Portuguese like the consoles; it names the provider, which no firm is ever told.
 */
export default function AiHealthEmail({ kind, provider, atLabel, failures, consoleUrl }: AiHealthEmailProps) {
  const down = kind === "down";
  return (
    <EmailShell
      locale="pt-BR"
      preview={down ? `A IA do ONE parou: ${provider} recusou a conta da plataforma` : `A IA do ONE voltou: ${provider}`}
      heading={down ? "A IA do ONE parou" : "A IA do ONE voltou"}
      notes={["Você recebe este aviso porque opera a plataforma ONE."]}
    >
      {down ? (
        <>
          <EmailText>
            Desde {atLabel}, a {provider} recusa a conta da plataforma (a chave ou o crédito)
            {failures && failures > 1 ? `, em ${failures} execuções` : ""}.
          </EmailText>
          <EmailText>
            O que depende dela está pausado nos escritórios, sem gastar as tentativas de nenhum trabalho, e o ONE
            confere a conta a cada cinco minutos. Troque a chave ou ponha crédito na conta: assim que ela responder, o
            trabalho continua sozinho.
          </EmailText>
        </>
      ) : (
        <EmailText>
          Desde {atLabel}, a {provider} voltou a responder. O que esperava por ela continua sozinho.
        </EmailText>
      )}
      <EmailButton href={consoleUrl}>Abrir o console de IA</EmailButton>
    </EmailShell>
  );
}
