import { Text } from "@react-email/components";

import EmailShell, { COLOR, EmailText } from "./shell";

export type ContactFormEmailProps = {
  name: string;
  email: string;
  message: string;
};

/**
 * Internal notification of a public contact-form submission. It goes to our
 * own staff, so it is written in Portuguese like the consoles, whatever
 * language the visitor wrote in; replying to it answers the visitor.
 */
export default function ContactFormEmail({ name, email, message }: ContactFormEmailProps) {
  return (
    <EmailShell
      locale="pt-BR"
      preview={`Mensagem de ${name} pelo formulário de contato`}
      heading="Nova mensagem pelo site"
      notes={["Responda a este e-mail para falar com quem escreveu."]}
    >
      <EmailText>
        <strong>{name}</strong> ({email}) escreveu:
      </EmailText>
      <Text style={{ color: COLOR.text, fontSize: 14, lineHeight: "22px", margin: "0 0 16px", whiteSpace: "pre-wrap" }}>
        {message}
      </Text>
    </EmailShell>
  );
}
