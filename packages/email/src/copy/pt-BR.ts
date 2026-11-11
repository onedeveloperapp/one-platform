/**
 * Portuguese copy of every e-mail the platform sends.
 *
 * The structural source of truth: `EmailCopy` is this object's type, and a
 * second language would have to match it, so TypeScript refuses the build
 * when one language gains a line the other lacks.
 *
 * Three rules for whoever edits this:
 * - the copy rules of CLAUDE.md hold here: no dash, no exclamation mark, no
 *   emoji, none of the banned words;
 * - a plan is always called by the name it has in the data (`plans.name`),
 *   never by a word written here, and a sentence never depends on the
 *   grammatical gender of that name;
 * - a date, an amount or a duration arrives already formatted for the reader.
 */
/** "1 caso novo", "3 casos novos". */
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const emailCopy = {
  shell: {
    /** The line under every message. */
    signature: "ONE · o software do escritório de contencioso de massa",
  },

  memberWelcome: {
    subject: "Sua conta no ONE está criada",
    preview: "Casos, documentos, prazos e atendimento do escritório num só lugar",
    heading: "Sua conta está criada",
    greeting: (name: string | null) =>
      name ? `${name}, a sua conta no ONE está pronta.` : "A sua conta no ONE está pronta.",
    body: "O ONE organiza casos, documentos, prazos e atendimento do escritório de contencioso de massa. O acesso é pelo painel, com o e-mail que você cadastrou.",
    button: "Abrir o painel",
    reason: "Você recebe esta mensagem porque criou uma conta no ONE.",
  },

  accessReceipt: {
    subject: (plan: string) => `${plan}: pagamento confirmado`,
    preview: "O acesso está liberado na sua conta",
    heading: "Pagamento confirmado",
    greeting: (name: string | null) => (name ? `${name}, pagamento confirmado.` : "Pagamento confirmado."),
    body: (amount: string, plan: string) => `Recebemos ${amount}, referente a ${plan}.`,
    /** `until` is null for an access with no end date. */
    unlocked: (until: string | null) =>
      until
        ? `O acesso está liberado na sua conta até ${until}.`
        : "O acesso está liberado na sua conta, sem prazo para acabar.",
    button: "Abrir o painel",
    fiscal: "A nota fiscal é emitida pelo Asaas e chega em outro e-mail.",
    keep: "Guarde esta mensagem: ela é o seu recibo de compra.",
  },

  subscriptionActive: {
    subject: (plan: string) => `Pagamento confirmado: ${plan}`,
    preview: (plan: string) => `${plan} já vale na sua conta`,
    heading: "Pagamento confirmado",
    greeting: (name: string | null, plan: string) =>
      name ? `${name}, ${plan} já vale na sua conta.` : `${plan} já vale na sua conta.`,
    button: "Abrir o painel",
    manage: "As faturas e a assinatura ficam em Configurações, Cobrança.",
  },

  subscriptionCanceled: {
    subject: (plan: string) => `${plan}: assinatura encerrada`,
    preview: "O que muda na sua conta",
    heading: "Sua assinatura foi encerrada",
    /** Why it ended: the person asked, a payment was not confirmed, a paid term ran out, or no reason is known. */
    cause: {
      requested: (plan: string, date: string) => `${plan} terminou em ${date}, como você pediu.`,
      payment: (plan: string, date: string) => `${plan} terminou em ${date} porque o pagamento não foi confirmado.`,
      term: (plan: string, date: string) => `${plan} terminou em ${date}: o período pago chegou ao fim.`,
      ended: (plan: string, date: string) => `${plan} terminou em ${date}.`,
    },
    /** Shown when another purchase still keeps the account active; named when the name is known. */
    keepsAccess: (plan: string | null) =>
      plan ? `O acesso continua por outra compra ativa (${plan}).` : "O acesso continua por outra compra ativa.",
    /** Shown when nothing else keeps the account active. */
    stops: "O acesso ao que o plano liberava termina com ele.",
    button: "Ver os planos",
    back: "Para voltar, escolha um plano em Configurações, Cobrança.",
  },

  accessEnded: {
    subject: (plan: string) => `${plan}: o acesso terminou`,
    preview: "O acesso não renova sozinho",
    heading: "Seu acesso terminou",
    body: (plan: string, date: string) => `${plan} terminou em ${date}. O acesso não renova sozinho.`,
    button: "Renovar o acesso",
    back: "Para voltar a usar, faça uma nova compra em Configurações, Cobrança.",
  },

  termEnding: {
    subject: (plan: string, date: string) => `${plan}: o período pago termina em ${date}`,
    preview: "Uma compra única não renova sozinha",
    heading: "O período pago está terminando",
    body: (plan: string, date: string) =>
      `${plan} foi uma compra única, que não renova sozinha. O período pago vai até ${date}.`,
    next: "Para continuar depois dessa data, faça uma nova compra em Cobrança.",
    button: "Abrir Cobrança",
  },

  leadConfirm: {
    subject: "Confirme sua inscrição na lista do ONE",
    preview: "Um clique para entrar na lista de espera do ONE",
    heading: "Confirme sua inscrição",
    body: "Recebemos um pedido para colocar este endereço na lista de espera do ONE. Confirme com o botão abaixo e avisaremos quando abrir para novos escritórios.",
    button: "Confirmar inscrição",
    expiry: "O link vale por 7 dias.",
    ignore:
      "Não foi você? Ignore esta mensagem: endereços não confirmados são apagados em 7 dias e não recebem mais nada.",
  },

  firmInvitation: {
    subject: (firm: string) => `Convite para a equipe de ${firm} no ONE`,
    preview: (firm: string) => `${firm} quer você na equipe`,
    heading: "Você recebeu um convite",
    /** `inviter` is null when the name of who invited is not known. */
    body: (inviter: string | null, firm: string) =>
      inviter
        ? `${inviter} convidou você para a equipe de ${firm} no ONE, o software que o escritório usa para organizar casos, documentos, prazos e atendimento.`
        : `Você recebeu um convite para a equipe de ${firm} no ONE, o software que o escritório usa para organizar casos, documentos, prazos e atendimento.`,
    role: (functionLabel: string) => `Função no escritório: ${functionLabel}.`,
    account:
      "O convite vale para este endereço de e-mail. Entre com ele, ou crie a sua conta com ele, e aceite na página do convite.",
    button: "Ver o convite",
    expiry: (date: string) => `O convite pode ser aceito até ${date}.`,
    ignore: "Não esperava este convite? Ignore esta mensagem: nada acontece sem o seu aceite.",
    /** What a person does in the firm, as the invitation names it. */
    functions: {
      socio: "Sociedade",
      advogado: "Advocacia",
      controladoria: "Controladoria",
      atendimento: "Atendimento",
    },
  },

  accountantPackage: {
    subject: (firm: string, month: string) => `${firm}: pacote do contador de ${month}`,
    preview: (firm: string, month: string) => `Os relatórios de ${month} de ${firm}`,
    heading: "Pacote do mês",
    body: (sender: string | null, firm: string, month: string) =>
      `${sender ? `${sender}, de ${firm},` : firm} enviou o pacote de ${month}: o resultado do mês, o fluxo de caixa, o movimento do mês e os dados das notas fiscais, na planilha anexa.`,
    managerial:
      "São relatórios gerenciais do escritório, não a escrituração contábil nem o Livro Caixa. Cada caso aparece pelo número, sem o nome do cliente.",
    reply: "Para responder, responda este e-mail: a resposta vai para quem enviou.",
  },
  partnerInvitation: {
    /** `firm` invites the agency `partner`; for a colleague, `firm` is null and `partner` invites. */
    subject: (partner: string, firm: string | null) =>
      firm ? `${firm} convidou ${partner} para ser parceira no ONE` : `Convite para a equipe de ${partner} no ONE`,
    preview: (partner: string, firm: string | null) =>
      firm ? `${firm} quer ${partner} como parceira` : `${partner} quer você na equipe`,
    heading: "Você recebeu um convite",
    body: (inviter: string | null, partner: string, firm: string | null) =>
      firm
        ? `${inviter ? `${inviter}, de ${firm},` : firm} convidou ${partner} para ser parceira do escritório no ONE. Na área da agência, vocês cadastram os passageiros da parceria, as viagens e os documentos, e o ONE acompanha os voos.`
        : `${inviter ?? "A agência"} convidou você para a equipe de ${partner} no ONE, onde a agência cadastra os passageiros da parceria com o escritório.`,
    account:
      "O convite vale para este endereço de e-mail. Entre com ele, ou crie a sua conta com ele, e aceite na página do convite. Uma conta de agência não entra em nenhum escritório.",
    button: "Ver o convite",
    expiry: (date: string) => `O convite pode ser aceito até ${date}.`,
    ignore: "Não esperava este convite? Ignore esta mensagem: nada acontece sem o seu aceite.",
  },

  hearingBrief: {
    subject: (caseSeq: number, when: string) => `Resumo para a audiência do caso ${caseSeq}, ${when}`,
    preview: (caseSeq: number, when: string) => `Caso ${caseSeq}: audiência ${when}`,
    heading: (caseSeq: number) => `Audiência do caso ${caseSeq}`,
    intro: (when: string) => `A audiência é ${when}. O ONE preparou o que vale ter em mãos:`,
    mayErr: "O resumo é do ONE e pode errar: confira no caso antes da audiência.",
    reason: (firm: string) => `Você recebe este resumo porque vai a esta audiência por ${firm}.`,
  },
  agendaDigest: {
    subject: (day: string) => `Sua agenda de ${day} no ONE`,
    /** The line a mail client shows beside the subject. */
    preview: (today: number, next: number) =>
      today === 0
        ? `Nada para hoje, ${next === 1 ? "1 item" : `${next} itens`} nas próximas 48 horas`
        : `${today === 1 ? "1 item" : `${today} itens`} para hoje`,
    heading: (day: string) => `Sua agenda de ${day}`,
    todayTitle: "Hoje",
    todayNone: "Nada vence hoje.",
    nextTitle: "Nas próximas 48 horas",
    changed: "mudou desde ontem",
    button: "Abrir a agenda no ONE",
    reason: (firm: string, wholeFirm: boolean) =>
      wholeFirm
        ? `Você recebe a agenda de todo o escritório ${firm} nos dias úteis de manhã, quando há algo.`
        : `Você recebe os prazos e as audiências de que responde em ${firm} nos dias úteis de manhã, quando há algo.`,
    calendar: "O que vale é o ONE: um calendário assinado pode levar horas para mostrar uma mudança.",
    unsubscribe: "Parar este e-mail",
  },

  weeklyDigest: {
    subject: (firm: string, week: string) => `A semana de ${firm} no ONE: ${week}`,
    preview: (opened: number, closings: number, filed: number) =>
      `${plural(opened, "caso novo", "casos novos")} · ${plural(closings, "fechamento", "fechamentos")} · ${plural(filed, "ação ajuizada", "ações ajuizadas")}`,
    heading: (week: string) => `A semana de ${week}`,
    tests: "O escritório ainda não tem casos reais: estes números contam os casos de teste.",
    casesTitle: "Casos",
    opened: (n: number) => plural(n, "caso novo", "casos novos"),
    closings: (n: number) => plural(n, "fechamento", "fechamentos"),
    filed: (n: number) => plural(n, "ação ajuizada", "ações ajuizadas"),
    ended: (n: number) => plural(n, "caso encerrado", "casos encerrados"),
    before: (n: number) => `na semana anterior, ${n}`,
    going: (n: number) => `${plural(n, "caso em andamento", "casos em andamento")} agora`,
    outcomesTitle: "Resultados",
    won: (n: number) => plural(n, "sentença procedente", "sentenças procedentes"),
    partial: (n: number) => plural(n, "sentença parcialmente procedente", "sentenças parcialmente procedentes"),
    lost: (n: number) => plural(n, "sentença improcedente", "sentenças improcedentes"),
    settlements: (n: number) => plural(n, "acordo", "acordos"),
    final: (n: number) => plural(n, "trânsito em julgado", "trânsitos em julgado"),
    received: (n: number, money: string) =>
      `${plural(n, "valor liberado recebido", "valores liberados recebidos")}, somando ${money}`,
    aheadTitle: "Nesta semana",
    deadlines: (n: number) => `${plural(n, "prazo vence", "prazos vencem")} nesta semana`,
    hearings: (n: number) => `${plural(n, "audiência", "audiências")} nesta semana`,
    waitingTitle: "Esperando o escritório",
    overdue: (n: number) => `${plural(n, "prazo passou", "prazos passaram")} do dia sem ser concluído`,
    stagnant: (n: number) => `${plural(n, "caso está parado", "casos estão parados")} além do limite da etapa`,
    decisions: (n: number) => `${plural(n, "resposta da IA espera", "respostas da IA esperam")} uma pessoa`,
    awareness: (n: number) =>
      `${plural(n, "publicação triada pelo ONE espera", "publicações triadas pelo ONE esperam")} a ciência de um advogado`,
    oneTitle: "O que o ONE fez",
    one: (tasks: number, hours: string) =>
      `${plural(tasks, "tarefa", "tarefas")}, cerca de ${hours} de trabalho de uma pessoa, pelas estimativas do escritório`,
    hours: (minutes: number) =>
      minutes < 60 ? "menos de 1 hora" : plural(Math.round(minutes / 60), "hora", "horas"),
    nothing: "Nada nesta semana.",
    open: "Ver no ONE",
    button: "Abrir o ONE",
    reason: (firm: string) =>
      `Você recebe este resumo às segundas-feiras de manhã porque decide pelo escritório ${firm}. Ele traz só números: os casos estão no ONE.`,
    unsubscribe: "Parar este resumo",
  },

  newsletter: {
    reason: "Você recebe este e-mail porque entrou na lista do ONE.",
    unsubscribe: "Sair da lista",
  },
};

export type EmailCopy = typeof emailCopy;
