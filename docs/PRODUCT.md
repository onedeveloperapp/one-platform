# ONE · Documento de produto

22 de outubro de 2026.

> **Status.** Este é o documento de produto do ONE: o que ele é, para quem, as decisões do dono que o código assume, o que já existe e o que falta. Ele substitui o PRD do flyee.club que este arquivo tinha até hoje (lido com `git show f4e0c2a:docs/PRODUCT.md`). O andamento técnico, parte por parte, está no `CLAUDE.md` da raiz ("Where things stand"), que é mantido a cada entrega; o plano de engenharia aprovado é o [`docs/ONE-PLANO-DESENVOLVIMENTO.md`](ONE-PLANO-DESENVOLVIMENTO.md). Quando este documento e o `CLAUDE.md` divergirem sobre o estado do código, vale o `CLAUDE.md`, e este documento deve ser corrigido. Os outros arquivos de `docs/` ainda descrevem o flyee.club e são históricos (o `DEPLOY.md` tem no topo uma seção sobre o deploy do ONE).

## 1. O que é o ONE

O ONE é um software por assinatura para escritórios de advocacia de contencioso de massa no Brasil. Ele reúne num só lugar o que o escritório hoje espalha por várias ferramentas e planilhas: o atendimento pelo WhatsApp, a pasta do cliente, os documentos, a peça, o pacote de protocolo, as publicações, os prazos, as audiências e os avisos ao cliente. A apresentação comercial o chama de "Office as a Service".

- **Frase do produto** (`BRAND` em `packages/content`): "O software do escritório de contencioso de massa."
- **Quem compra:** o escritório. Vários escritórios usam o mesmo banco desde o primeiro dia, cada um isolado dos outros.
- **Quem vende:** uma empresa de tecnologia, sem sócios advogados. O ONE é software para escritórios e nunca age como escritório.
- **O primeiro módulo:** ações de passageiro aéreo contra companhias aéreas (atraso, cancelamento, overbooking, bagagem), de passageiros do Brasil inteiro, portanto em muitos tribunais e sistemas.
- **O escritório piloto:** um escritório de contencioso de consumo em Goiânia (TJGO, Projudi). Hoje ele trabalha com o ChatGuru (WhatsApp), o Astrea (gestão de processos), a ZapSign (assinatura), a InfinitePay (links de pagamento) e o protocolo manual no PJe e no Projudi, e gasta com isso e com as horas da equipe cerca de R$ 2.000 por mês. É a referência de preço que o dono deu.

**O que o ONE não é**

- Não é escritório: não presta serviço jurídico, não promete resultado, valor de indenização nem tempo até a sentença.
- Não movimenta dinheiro: registra, lê, calcula, prepara e avisa o dinheiro do escritório e o dos seus clientes (os livros, os honorários, os custos de cada caso), e nunca guarda, recebe, repassa, divide, paga nem cobra, nem em nome do escritório (a linha do dinheiro, decisão de 2026-11-07).
- Não cobra o passageiro. A única cobrança é a assinatura do próprio ONE.
- Não intermedeia causas: o passageiro chega ao escritório pelo canal do escritório, nunca pelo ONE.

## 2. Quem usa

| Quem | Como entra | O que faz no ONE |
| --- | --- | --- |
| **Sociedade** (função `socio`) | Conta, com segundo fator | Responde pelo escritório e acompanha tudo. Muda o que o ONE decide sozinho, escolhe quem assina o que o ONE prepara, decide protocolar ou segurar, aprova peças. |
| **Advocacia** (`advogado`) | Conta, com segundo fator | Atua nos casos e aprova o que vai ao tribunal: a peça, o pacote, a assinatura em nuvem dos arquivos, o recibo do protocolo. |
| **Controladoria** (`controladoria`) | Conta | Cuida de publicações, prazos, audiências e protocolos. |
| **Atendimento** (`atendimento`) | Conta | Fala com os clientes pelo WhatsApp e reúne os documentos. |
| **Cliente** (o passageiro, e quem responde por um menor) | Sem conta: um link por token, mandado pelo escritório | Preenche os dados e os da família, a viagem, manda documentos e o relato, confirma a ordem dos fatos, aceita textos, assina, responde se aceita a vara cível, recebe os avisos do processo pelo WhatsApp sem precisar concordar antes, podendo parar quando quiser, e acompanha o processo. Vê só a marca do escritório. |
| **Agência parceira** (uma agência de viagens) | Conta de uma agência, com segundo fator, por convite do escritório; nunca de um escritório | Na área da agência (`/parceiro`): cadastra os passageiros que a parceria cobre a partir dos documentos, que o ONE lê e a agência confere (a identidade, o comprovante de endereço e o bilhete, que pode ser um print da reserva ou a foto do impresso), e as viagens pelo bilhete; digitar fica como contingência, e também entram por planilha ou pela API com uma chave, registra a cláusula do contrato e manda a cada passageiro o link do acordo. Não vê nada do escritório nem dos casos. |
| **Passageiro de uma agência** | Sem conta: o link do acordo (`/acordo/[token]`), mandado pela agência | Concorda, ou não, que o ONE acompanhe os voos e que o escritório o avise de um problema, no WhatsApp que o link mostra pelo final ou que ele informa; o acordo vale para ele e para as crianças por quem responde, e um adulto que viaja junto dá o próprio acordo, na viagem em nome dele; manda documentos; baixa o que a agência guarda dele e pede que seja apagado. Só depois de dizer sim ao aviso de um problema vira cliente do escritório, com o que a agência tinha, e continua passageiro da agência nas próximas viagens, cada uma com o seu acordo. |
| **Operador da plataforma** | Conta de superadmin | Consoles em `/admin`: escritórios, IA (versões de instruções, autonomia das tarefas, medidas), calendário forense, cobrança, auditoria, backups, suporte assistido, conteúdo do site. |

Além da função, cada pessoa tem um papel na conta do escritório (titular, administração, equipe), que decide quem gerencia equipe, conexões e plano. Uma pessoa pertence a um escritório só, ou a uma agência só, nunca aos dois. O segundo fator é pedido por papel e por cada ação que dá ou tira acesso.

## 3. Decisões do dono que o código assume

| Data | Decisão |
| --- | --- |
| 2026-10-08 | Vários escritórios desde o primeiro dia; o ONE é vendido a outros escritórios já no primeiro ano. |
| 2026-10-08 | Só o módulo de passagens aéreas nesta fase. Salário-maternidade, plano de saúde e trabalhista ficam fora. Passageiros do Brasil inteiro. |
| 2026-10-08 | O cliente do ONE paga assinatura e nada passa pelo ONE: sem taxas, sem valores de processo, sem pagamentos. |
| 2026-10-08 | O ONE é uma empresa de tecnologia. O conteúdo jurídico padrão do módulo vem de um advogado contratado como curador; cada escritório revisa e responde pelo que usa. Todos os tipos de certificado digital (A1, A3 em token ou cartão, nuvem) precisam funcionar. |
| 2026-10-08 | Plano de desenvolvimento em marcos M0 a M6 aprovado. Identidade provisória (paleta `theme-blue`, logos provisórios) até a arte oficial. |
| 2026-10-09 | Uma pessoa não pertence a mais de um escritório. O material de origem (`attachments/`) não entra no repositório. |
| 2026-10-13 | "Viagem Blindada" passa a se chamar **Direito do Passageiro**. |
| 2026-10-14 | **Automação primeiro.** O ONE decide sozinho por padrão, inclusive nos atos do advogado (o texto da peça, protocolar ou segurar, os prazos), e cada escritório escolhe, decisão por decisão, que uma pessoa confira uma parte ou decida tudo. |
| 2026-10-14 | Uma credencial do advogado é guardada quando uma automação do ONE precisar dela (o protocolo no sistema do tribunal), sob regras de custódia próprias. |
| 2026-10-14 | Uma família com menor vai junta à vara cível, num processo só. Dividir (adultos no juizado, o menor na vara cível) é escolha registrada de um advogado. Cada autor de um processo na vara cível aceita, antes do protocolo, o que isso implica de custas. |
| 2026-10-15 | Protocolo pelo ONE: primeiro o que não precisa de autorização de tribunal (a assinatura em nuvem do advogado, o arquivo assinado que o tribunal aceita, o cliente do MNI). Automação da tela de um tribunal só onde nenhuma regra escrita do tribunal ou do CNJ a proíbe; uma previsão de hostilidade não impede. Cada tribunal é conferido contra os próprios atos antes. |
| 2026-10-21 | Nenhum componente que exija licença paga (só os pacotes MIT do MUI X). Repositório próprio (`onedeveloperapp/one-platform`), publicado pela Vercel via GitHub Actions. |
| 2026-10-27 | **Valor da Causa Pedido.** O valor que cada autor pede tem esse nome em todas as telas, e o escritório escolhe se o define, por tipo de problema. Sem valor definido, a ação vai sem valor e o juiz define: a peça diz "o valor que este Juízo arbitrar". |
| 2026-10-27 | Os dados que o cliente preencheria vêm dos documentos que ele manda, e por isso os documentos vêm primeiro no link. A agência vinculada ao escritório anexa os documentos do passageiro e o ONE os usa, com a concordância do passageiro no contrato da agência (substitui a decisão de 8/10 de que a agência não passava dados). Falta escolher como a agência entra no ONE, e o parecer sobre captação de clientes responde se o escritório pode receber clientes assim. |
| 2026-10-29 | **Direito do Passageiro é um módulo do ONE**, separado do núcleo, para que outros módulos venham depois do mesmo jeito. A agência de viagens parceira do escritório tem uma área só dela, onde cadastra os passageiros cobertos pela parceria, para os dados e documentos já estarem prontos quando o caso precisar. Uma agência trabalha com um escritório por módulo de cada vez; o escritório convida a agência; o passageiro confirma o acordo num link do ONE; depois do cadastro, a agência só vê em que pé está o acompanhamento; sem caso, o que a agência guarda é apagado 30 dias depois de uma viagem sem problema e 180 dias depois de um problema que não virou caso (uma configuração); a leitura dos documentos pela IA e as consultas à FlightAware contam para o escritório parceiro; a API vem depois do resto. |
| 2026-10-30 | **Cada módulo tem uma área própria.** No início, os módulos aparecem como acesso rápido, cada um com o ícone que diz o que ele é; o contratado abre a sua área, com os processos só dele, o trabalho do escritório que é dele (atendimento, aprovações, protocolo, publicações, prazos, agenda) e o que só ele tem (no Direito do Passageiro, as agências parceiras, a importação da carteira, o Valor da Causa Pedido e o chat de teste). O menu principal tem "Módulos", com os que vêm marcados "Em breve" e um disponível que o escritório não contratou com um cadeado. Cada página do trabalho mostra todos os módulos ou um só. A configuração do escritório não tem nada que leve para fora dela antes de terminar. Num escritório sem sócio, quem administra a conta decide o que o sócio decide. Os convites oferecem, já na primeira tela, copiar o link ou enviar por e-mail. |
| 2026-10-30 | **Um módulo é um pacote contratado com a assinatura do ONE.** O Direito do Passageiro é o primeiro, e o escritório vê, no início, no passo a passo de configuração e na página de módulos, quais módulos contratou e desde quando. Direito Previdenciário e Direito Trabalhista aparecem como "Em breve", para mostrar que o sistema ganha módulos. A contratação pela própria plataforma (o checkout da assinatura e dos pacotes) fica para a cobrança do ONE. O escritório acompanha cada agência parceira pelos seus próprios números: os casos que vieram dela, os que esperam o cliente confirmar e, para quem gerencia, o consumo do dia; nada dos passageiros da agência que não disseram sim, até o parecer sobre captação. O teste do problema no voo começa pela agência: ela cadastra o passageiro, a viagem, os dados e os documentos, o passageiro concorda em ser avisado, e só então seguem os passos do roteiro. |
| 2026-10-27 | O que o ONE gera ou decide diz que ele pode errar, para o escritório estar sempre ciente. O sistema do tribunal de cada ação é do ONE, e o escritório só aprova ou não: a aprovação fica como decisão do escritório, e quem não aprova diz por quê, para a plataforma conferir nos atos do tribunal. |
| 2026-11-07 | **A linha do dinheiro** (substitui em parte a decisão de 8/10 de que nada passa pelo ONE, que fica como histórico). O ONE registra, lê, calcula, prepara e avisa o dinheiro do escritório e o dos seus clientes; nunca guarda, recebe, repassa, divide, paga nem cobra dinheiro, nem em nome do escritório: não abre conta nem subconta, não tem comissão e não manda cobrança, lembrete ou link de pagamento ao cliente. A única cobrança do ONE é a da própria assinatura. Os sócios veem e configuram o financeiro, e concedem a outras pessoas "Vê", "Lança e concilia" ou "Configura" com o segundo fator; as demais leem os custos dos casos. Uma visita de suporte não vê nada dos livros. |
| 2026-11-03 | **O que não precisa de uma pessoa, a IA do ONE faz.** É uma premissa do ONE: uma tarefa que não pede decisão de ninguém e que a IA do ONE consegue fazer com o que o escritório já tem (ler um documento, preencher um cadastro com ele, fazer dele um modelo, conferir contra uma regra, pedir o que falta) é trabalho do ONE, porque poupa tempo, pessoas e custo do escritório. A pessoa só responde o que só ela sabe ou decide (uma resposta, uma escolha do escritório, um documento a mandar de novo depois de uma recusa com o motivo), cada escritório escolhe quanto o ONE faz sozinho, e o que o ONE fez diz que ele pode errar. Antes de sugerir ou construir uma funcionalidade, a primeira pergunta é se o ONE pode fazer a tarefa no lugar da pessoa, e o que ele precisaria perguntar. O primeiro caso: o escritório envia a procuração, o contrato ou a petição que já usa, e o ONE confere o documento, recusa o que não serve com o motivo, pergunta o que só o escritório sabe e monta o modelo do escritório. |
| 2026-11-03 | **O trabalho do ONE nunca aparece como tarefa do escritório.** Uma lista, uma contagem, uma pendência, uma tela vazia ou uma mensagem só dá ao escritório o que uma pessoa dele faz ou decide. O que o ONE faz sozinho (abrir o caso quando o passageiro aceita o aviso ou quando ele vem da agência parceira, enviar o link ao cliente, criar as ações, escrever a peça, pedir o pacote) aparece como trabalho do ONE, feito, em andamento ou esperado. A lista "Deixe o escritório pronto" termina no que o escritório entrega ao ONE (quem assina, a equipe, o canal): o primeiro caso chega por um dos módulos contratados e o ONE o abre, e o início diz que o ONE espera o primeiro caso. Abrir um caso à mão continua possível, como exceção. |
| 2026-11-03 | **A configuração do escritório é o núcleo; cada módulo contratado tem a sua.** O passo a passo do escritório pede só o que todo escritório precisa (segundo fator, quem assina, equipe, papéis do cliente, canal). Em seguida, para cada módulo contratado, vem a configuração do módulo, na cor dele, antes do início: no Direito do Passageiro, o Valor da Causa Pedido, o texto da cláusula que as agências parceiras registram e a agência parceira. Os módulos não contratados aparecem desabilitados, como o que o escritório pode contratar depois. O texto da cláusula é do escritório (a parte jurídica da parceria); a agência o registra no contrato dela com o passageiro. Cada pessoa que entra no escritório tem o seu próprio passo a passo: o segundo fator e, para sócio e advogado, a inscrição na OAB, pela qual o ONE lê as publicações. |
| 2026-11-04 | **O relato do cliente vem antes da peça.** O ONE só cria a ação e pede a peça depois que o cliente conta o que aconteceu e a ordem dos fatos fica pronta. A IA que organiza o relato diz o que falta para a peça (a compra, como soube do problema, o que a companhia ofereceu, a chegada, a assistência, os gastos, o que perdeu) e o link do cliente pergunta só isso; o que o caso já registra do voo nunca é perguntado. Depois de três rodadas, o caso segue com o que o cliente contou. O ONE também pergunta pelo WhatsApp, na conversa que ele conduz, e a resposta do cliente ali vale como resposta. A peça lê o registro oficial do voo, a compra que o bilhete mostra e os gastos dos recibos aceitos. |
| 2026-11-03 | **Os avisos ao cliente saem sem pedir aceite.** Os avisos do processo pelo WhatsApp (o que o cliente enviou chegou, o protocolo, as audiências e suas mudanças, o andamento, o alerta contra golpe, o documento a reenviar) são o único caminho do escritório até o passageiro, e um cliente que não respondesse à pergunta do link perderia uma audiência e deixaria o processo parado. O aviso sai para quem tem WhatsApp no caso, a menos que a pessoa peça para parar: no próprio link, ao escritório (que registra como foi) ou respondendo SAIR, o que todo aviso diz no rodapé. O pedido vale para a pessoa até ela pedir para voltar. |
| 2026-11-03 | **Todo cadastro começa pelos documentos.** Onde o dado já está escrito num documento que a pessoa tem (a identidade, o comprovante de endereço, o bilhete, um print da reserva, a foto de um papel impresso), ela envia o documento, o ONE lê e preenche os campos, e ela só confere o que o ONE leu e completa o que nenhum documento traz. Digitar tudo é a contingência, nunca a primeira tela. O primeiro a seguir a regra é o cadastro de passageiros e viagens da agência. |
| 2026-11-05 | **O passageiro que já teve um caso continua com a agência nas próximas viagens.** "Com o escritório" vale para a viagem que virou caso, não para a pessoa. A agência continua atualizando o cadastro, mandando documentos, cadastrando viagens e mandando o link do acordo para cada viagem nova; enquanto o passageiro não concorda, a viagem aparece como "Falta concordar de novo", e quando ele concorda o ONE acompanha o voo. Da viagem que virou caso a agência não manda mais nada: o que o caso precisar dela, o escritório pede ao passageiro. Uma viagem nova que vira caso vai para o mesmo cliente do escritório, pelo CPF. O que a agência muda no cadastro não muda o que o escritório já recebeu, e a agência guarda os dados enquanto houver viagem pela frente, contando o prazo de apagar a partir da última. |
| 2026-11-25 | **Comprovante de endereço em nome de outra pessoa: um ou outro.** Ele vale com um documento do vínculo do cliente com o titular (certidão de casamento ou de união estável, certidão de nascimento, contrato de aluguel, declaração assinada do titular), que o ONE confere pelos nomes escritos nele, ou, sem nenhum, com a declaração de residência que o cliente assina (Lei 7.115/1983). Construído na migração 0294. |

**Regras de produto que valem em tudo**

- Adultos vão ao juizado especial cível; um adulto acima do teto de 40 salários mínimos vai à vara cível sozinho. O foro padrão é o domicílio do passageiro; outro foro só numa cidade de aeroporto da viagem e com motivo registrado.
- O WhatsApp é o oficial (Cloud API da Meta), com o número de cada escritório, em coexistência com o aplicativo do celular.
- A marca do escritório em tudo o que o passageiro vê. Só português do Brasil.
- Texto para pessoas (site, app, e-mails, WhatsApp): simples, sem travessão, sem ponto de exclamação, sem emoji. Testes seguram a regra.
- Regras do domínio (foro, tipo de processo, prazo, Tema 1.417, contagem de causas por estado) são código puro, versionado e testado. A IA nunca decide uma regra.
- O que não precisa de uma pessoa, a IA do ONE faz: uma tela não pede à pessoa uma tarefa que o ONE pode fazer sozinho, e só pergunta o que só ela sabe ou decide.
- Toda execução de IA fica registrada (tarefa, versão das instruções, modelo, entrada, saída, custo).
- Nenhuma senha, semente de segundo fator ou arquivo de certificado de advogado é guardado. A única custódia construída é a da autorização de assinatura em nuvem (seção 6).

## 4. A jornada de um caso

O que existe hoje, na ordem em que o caso anda. "Construído" quer dizer código, banco e telas prontos e testados; a seção 8 diz o que já rodou contra o fornecedor real.

| Etapa | O que o ONE faz | Onde | Estado |
| --- | --- | --- | --- |
| Atendimento | Conversas do número do escritório; o que pode ser enviado é decidido pelo banco (texto livre só nas 24 horas depois da última mensagem da pessoa, modelo aprovado fora delas, nunca a quem pediu para sair); envio de arquivos do caso; abrir um caso a partir da conversa. | `/atendimento` | Construído. O atendente de IA, o CRM e os follow-ups são o M4. |
| Pasta do cliente | Link do cliente por token, que começa pelos documentos: o que o ONE lê neles já aparece nos dados dele e dos filhos, marcado como lido do documento, e o cliente confere e completa o resto (estado civil, profissão); depois a viagem, o relato e os aceites. O escritório confere no Serpro o CPF de um adulto. A foto de um documento é medida na chegada (tamanho, nitidez, luz) e o cliente é avisado na hora se não dá para ler. | `/c/[token]`, `/casos/[id]` | Construído. |
| Conferência dos documentos | A IA confere cada documento que sabe ler (identidade, comprovante de endereço, bilhete, cartão de embarque, recibo), lê os trechos do voo de um bilhete e o que uma identidade e um comprovante de endereço dizem da pessoa (nome completo, CPF, nascimento, nacionalidade, endereço). O ONE aceita ou recusa; aceito, o que o documento diz entra no cadastro só onde nada estava escrito, e o caso diz que o ONE pode ter lido errado. Um documento recusado é pedido de novo ao cliente pelo WhatsApp, com o motivo. | `/casos/[id]`, `/aprovacoes` | Construído. |
| Assinatura do cliente | O PDF vai para assinatura pela ZapSign da conta do escritório, pelo gov.br ou pelo e-Notariado. O PDF assinado vira documento aceito do caso. | `/casos/[id]`, `/c/[token]` | Construído. |
| Relato | O cliente manda áudio ou texto; a IA transcreve e propõe a ordem dos fatos; o cliente confirma ou diz o que está errado. | `/casos/[id]`, `/c/[token]` | Construído. |
| O voo | Cada trecho é conferido no registro oficial da ANAC (VRA); a FlightAware responde, a pedido, o que o VRA ainda não tem. Os METAR da REDEMET guardados como prova. | `/casos/[id]` | Construído. |
| Como o caso vai a juízo | As regras planejam as ações: foro, juizado ou vara cível, família com menor junta, teto por autor, o Valor da Causa Pedido de cada autor (sem ele, o juiz define), a triagem do Tema 1.417 (risco de a suspensão nacional alcançar o caso), o aviso de inscrição suplementar na OAB. | `/casos/[id]` | Construído. |
| Reclamação administrativa | O escritório registra o canal (Anac Passageiro, consumidor.gov.br, Procon, a companhia), o protocolo e o prazo de resposta. O ONE não protocola nada lá. | `/casos/[id]` | Construído. |
| A peça | A IA escreve o primeiro texto a partir do modelo do escritório, sem receber CPF, endereço ou telefone. Só é aprovado o texto cujas citações estão todas na biblioteca conferida do escritório e sem nada a completar; o advogado aprova na prévia o texto exato, ou direto no card da peça, sem revisar (com o mesmo portão), ou devolve à IA com o que mudar. O PDF sai em nome do escritório. | `/casos/[id]`, `/biblioteca` | Construído (só a petição inicial). |
| Modelo a partir de um documento | O escritório envia a petição, a procuração ou o contrato que já usa, em Word ou PDF. O ONE mantém o texto do escritório, troca o que era do caso original pelas marcas que preenche em cada caso e mostra o que trocou e o que ainda parece ser do caso original; um sócio ou um advogado confere e salva. | `/biblioteca` | Construído. |
| Dossiê | Documento do caso, com código público de verificação: quem é cada pessoa, o que fizeram no link, o que assinaram, o que contaram, o que foi tentado antes. | `/casos/[id]`, `/verificar/[code]` | Construído. |
| Pacote de protocolo | Os arquivos na ordem, com nomes simples, divididos pelo limite do sistema (Projudi, eproc, PJe), com o passo a passo do sistema. O sistema de cada ação é o que o ONE define pelo tribunal e pelo tipo de processo, e o pacote espera um sócio, um advogado ou a controladoria aprovar; quem não aprova diz por quê, e a plataforma confere nos atos do tribunal. No Projudi do TJGO, o ONE assina cada arquivo (`.p7s`) com a autorização em nuvem de um advogado da ação. O advogado protocola com o próprio login e anexa o recibo. | `/protocolo`, `/casos/[id]` | Construído. O protocolo pelo próprio ONE (MNI) é o próximo passo. |
| Carteira existente | Importação da planilha do sistema anterior (Excel ou texto), lida no navegador, com conferência linha a linha antes de gravar, e desfeita se preciso. | `/casos/importar` | Construído. |
| Andamento | O processo é lido no tribunal pelo número: Projudi do TJGO pelo webservice público; os outros tribunais por um agregador ainda a escolher. | `/casos/[id]` | Construído (TJGO); fora de Goiás espera o agregador. |
| Publicações | O DJEN é lido por inscrição na OAB de cada advogado; uma pessoa tria (prazo, audiência, decisão, pagamento, ciência, outro); a IA tria em modo sombra e, nas categorias que bateram a meta, com amostra. | `/publicacoes` | Construído. |
| Prazos | Contados pela regra sobre o calendário do tribunal (dias úteis, recesso, suspensões), confirmados por uma pessoa ou pelo ONE; o ONE lê o prazo de uma publicação triada como prazo. | `/prazos` | Construído. Só o calendário do TJGO de 2026 está registrado. |
| Audiências | Registradas com fuso do tribunal, modalidade, local ou link e quem vai; escritas na agenda Google do escritório; o ONE lê a audiência de uma publicação triada como audiência. | `/agenda` | Construído. |
| Avisos ao cliente | Pelo WhatsApp do escritório, só a quem aceitou: lembrete de audiência (um mês, uma semana, um dia, no dia), audiência que mudou, andamento a cada quinze dias, alerta contra o golpe do falso advogado no dia em que um pagamento é triado, documento recusado. No link, o cliente vê o processo e a próxima audiência. | `/settings/connections`, `/casos/[id]`, `/c/[token]` | Construído. |
| O que precisa de alguém hoje | Contagens do dia: documentos a conferir, peças esperando advogado, pacotes prontos, publicações a triar, prazos vencendo, audiências sem aviso, leituras atrasadas. | `/inicio`, `/casos` | Construído. |

**O ONE leva o caso adiante sozinho.** Quando um caso tem o que as ações pedem, o ONE cria as ações, nomeia quem assina, pede a peça à IA, aprova o texto se ele passa pelo portão, pede o pacote e assina os arquivos, cada passo como o escritório deixou. Quando para, o caso diz o que ele espera e quem resolve. Nada que uma pessoa desfez é refeito.

**Cobertura do fluxo do escritório piloto.** Os mapas de fluxo do piloto (`attachments/fluxo_geral.md`, `fuxo_passageiros.md`, fora do repositório) comparados ao que existe:

| Etapa do fluxo | No ONE |
| --- | --- |
| Lead e marketing (tráfego, conteúdo) | Fora do ONE. A origem do lead entra com o CRM do M4. |
| Atendimento (script, follow-up, "não tem direito") | Conversas construídas; atendente de IA, CRM e follow-ups no M4. |
| Contratação (procuração, contrato, dados, documentos, questionário, resumo dos fatos) | Construído. O pagamento por PIX ou link fica fora, por decisão. |
| Reclamação administrativa | Registro construído. |
| Petição inicial (fatos, direitos, pedidos, documentos na vertical, em PDF, no tamanho e na ordem) | Construído. |
| Distribuição (PJe, eproc, e-SAJ, Projudi) | Pacote para Projudi, eproc e PJe; o advogado protocola. e-SAJ não tem pacote. |
| Acolhimento (número do processo, audiência na agenda, lembretes, alerta de golpe) | Construído. |
| Analisar publicações e prazos | Construído. |
| Acompanhamento (andamento ao cliente) | A cada quinze dias (o fluxo pedia uma vez por mês). Pesquisa de satisfação e pedido de indicação não estão no plano. |
| Audiência (resumo para o audiencista, valor para acordo) | Não construído. A faixa de acordo por companhia é do M5. |
| Sentença e recursos (embargos, recurso inominado, contrarrazões, réplica) | Prazos e publicações sim; peças além da inicial não estão no plano atual. |
| Balcão virtual | Não está no plano. |
| Financeiro (receber, pagar cliente) | Os livros do escritório, as contas a pagar e a receber, o resultado de cada ação, os honorários e custos do caso e a divisão do dinheiro do cliente com o repasse estão construídos; o ONE registra, divide e calcula e nunca recebe, paga nem cobra (a linha do dinheiro). |
| Resumo semanal de cada etapa | O resumo semanal do sócio falta no M3. |
| Direito do Passageiro (mensagens no dia do voo, verificação de atraso) | M4. |

## 5. O que o ONE decide sozinho

Cada decisão abaixo tem três modos, escolhidos por um sócio com o segundo fator em `/settings/autonomia`: **o ONE decide sozinho** (o padrão da plataforma), **o ONE decide e uma parte espera a conferência de uma pessoa**, ou **uma pessoa decide**. O operador pode segurar uma decisão em todos os escritórios quando a medida dela cai. Toda decisão do ONE fica na linha do tempo do caso e na auditoria como do ONE. O que o ONE gera ou decide diz na tela, ao lado, que ele pode errar e o que conferir: a ação que ele criou, o sistema do tribunal que ele definiu, os dados que ele leu dos documentos, o prazo, a audiência, a classificação de uma publicação, a decisão do Tema 1.417, a peça e a petição que ele aprovou.

| Decisão (como a tela diz) | O que o ONE faz sozinho |
| --- | --- |
| Aceitar ou recusar os documentos do cliente | Aplica a conferência da IA. |
| Mandar a ordem dos fatos ao cliente | Põe a cronologia proposta no link do cliente. |
| Aprovar o primeiro texto da peça | Aprova o texto da IA quando todas as citações estão na biblioteca e nada ficou a completar, e gera o PDF. Um texto que um advogado tocou nunca é aprovado pelo ONE. |
| Confirmar os prazos | Confirma no dia contado, sempre pelo dia mais cedo quando a contagem supôs algo. |
| Decidir entre protocolar ou segurar (Tema 1.417) | Segura no risco alto, protocola no médio, baixo ou fora do tema; não decide quando a triagem não sabe. |
| Criar as ações do caso | Cria as ações que as regras planejam quando o caso tem o que elas pedem, cada uma com o sistema do tribunal que a tabela da plataforma dá para o tribunal e o tipo de processo. |
| Pedir a peça à IA | Pede o primeiro texto do modelo padrão do escritório para aquele tipo de ação. |
| Montar o pacote de protocolo | Pede o pacote quando a peça vira a petição, os documentos estão aceitos e o escritório aprovou o sistema do tribunal da ação. |
| Assinar os arquivos do protocolo | Assina com a autorização em nuvem de um advogado da ação, onde o sistema aceita arquivo assinado. |
| Propor o prazo de uma publicação | Lê o prazo de uma publicação que uma pessoa triou como prazo e o propõe, só quando o texto não deixa dúvida. |
| Registrar a audiência de uma publicação | Lê a audiência de uma publicação triada como audiência e a registra, só quando o texto não deixa dúvida. |
| Montar o modelo a partir do documento do escritório | Confere o documento que o escritório já usa (a procuração, o contrato ou uma petição), recusa com o motivo o que não serve, pergunta o que só o escritório sabe e salva o modelo do escritório, que passa a ser usado. Espera uma pessoa quando o texto ainda parece ter algo do caso original ou quando a própria IA pede para conferir um ponto. |

**O que continua sempre com uma pessoa:** triar uma publicação como prazo, audiência, decisão ou pagamento (a IA fica em modo sombra nessas categorias); devolver uma resposta da IA com o que mudar; protocolar no sistema do tribunal; aprovar ou não o sistema do tribunal que o ONE definiu para cada ação; escolher outro foro; dividir uma família.

As tarefas de IA que existem: `caso.documento.conferencia`, `caso.relato.transcricao`, `caso.relato.cronologia`, `caso.peca.minuta`, `publicacao.triagem`, `publicacao.prazo`, `publicacao.audiencia`, `biblioteca.modelo.transcricao` e `biblioteca.modelo.marcacao` (o modelo do escritório a partir do documento que ele já usa) e `plataforma.verificacao` (a checagem do executor, sem dado de cliente). O modelo de cada uma é dado da versão publicada das instruções, trocado pelo operador em `/admin/ai`.

## 6. Assinatura, certificados e protocolo

- **Hoje o advogado protocola** no sistema do tribunal, com o próprio login. O ONE entrega o pacote pronto e guarda o recibo.
- **Assinatura em nuvem.** O advogado autoriza o ONE no PSC do próprio certificado ICP-Brasil em nuvem (o provedor credenciado pelo ITI), por no máximo sete dias. O ONE guarda essa autorização selada, nunca o certificado nem os fatores que o desbloqueiam, e a usa só para o que foi declarado antes (os arquivos de um pacote de uma ação que o advogado assina). Os arquivos assinados só saem do ONE pelas mãos do advogado que assinou. O advogado, um sócio ou quem gerencia o escritório encerra a autorização a qualquer momento.
- **Inventário de certificados.** Cada advogado declara o tipo de certificado com que assina em cada sistema, a validade e a última vez que conferiu que o computador assina lá. Nada do certificado em si.
- **O que vem a seguir:** o cliente do MNI (`entregarManifestacaoProcessual`), para o ONE entregar a petição pelo canal do próprio tribunal, com um dublê onde o tribunal fica, e depois o protocolo pela tela do tribunal onde nenhuma regra escrita proíbe.
- **Por que guardar o certificado não basta:** o PJe, a PDPJ e o eproc pedem segundo fator por aplicativo autenticador também a quem entra com certificado; o Projudi do TJGO manda um código por e-mail; a lei reserva a chave privada ao titular.

## 7. Modelo de negócio

- O ONE cobra só a própria assinatura, pelo Asaas, em reais. As faixas são dados (tabela `plans`), com limites como processos ativos, IA incluída e números de WhatsApp, e o monitor de voo do Direito do Passageiro como adicional.
- **Ainda não construído.** A cobrança do ONE é do M3. O código de cobrança ainda é o herdado (acesso avulso mais assinatura, Stripe e dólar, degraus `kit`, `club` e `pro`), e o único plano semeado é "Sem assinatura". Nenhum preço foi decidido.
- **Âncora de preço:** o piloto gasta cerca de R$ 2.000 por mês com o que o ONE substitui.
- **Nunca:** pagamento atrelado ao resultado do processo, percentual de causa, cobrança do passageiro.

## 8. Fornecedores e o que já rodou de verdade

| Fornecedor | Para quê | Quem contrata | Estado |
| --- | --- | --- | --- |
| Meta (WhatsApp Cloud API) | O número de cada escritório | O app é da plataforma; o número é do escritório | Construído; roda no simulador. Falta o app do ONE na Meta (portfólio, Embedded Signup, revisão de Tech Provider). |
| Anthropic | Conferência de documentos, cronologia, peça, triagem | Plataforma | Rodou na primeira caminhada (2026-10-21): Sonnet 5.5 nos documentos, Opus 5.5 na peça e na checagem do executor. A tabela de preços dos modelos está vazia, então nenhuma execução tem custo ainda. |
| Google Gemini | Transcrição de áudio | Plataforma | Falta a chave. |
| ZapSign | Assinatura do cliente | Escritório | Construído; testado só com dublê. |
| Serpro (Consulta CPF) | Conferir o CPF de um adulto | Plataforma | Construído; falta o contrato. |
| DJEN (CNJ) | Publicações | Público, sem chave | Conferido à mão desta máquina; nunca a partir do app publicado. |
| Projudi do TJGO (webservice público) | Andamento em Goiás | Público, sem chave | Conferido à mão desta máquina. |
| Escavador, Judit, Codilo | Andamento fora de Goiás | Plataforma | Esperando chaves de teste para o comparativo; nenhum rodou. |
| ANAC (VRA) | Registro oficial dos voos | Público | Um mês lido desta máquina. |
| FlightAware (AeroAPI) | Voo recente ou no exterior | Plataforma | Falta saber se o uso do ONE cabe no plano Standard ou exige o Premium. |
| REDEMET | METAR dos aeroportos | Plataforma | Falta o cadastro da chave. |
| Google Agenda | Agenda de audiências do escritório | Plataforma (projeto) e escritório (conta) | Construído; falta o projeto Google publicado. |
| PSC (BirdID, SerproID e outros) | Assinatura em nuvem do advogado | Advogado (certificado), plataforma (cadastro como aplicação) | Construído; falta o cadastro do ONE em cada PSC e um certificado SSL ICP-Brasil do domínio. |
| Asaas | Assinatura do ONE | Plataforma | Não construído. |
| Supabase, Vercel, Inngest, Resend | Banco, hospedagem, jobs, e-mail | Plataforma | Projeto Supabase de desenvolvimento com a base (43 migrações, 1.397 asserções pgTAP passando); Vercel publicando em `one-platform-two.vercel.app` (plano Hobby); homologação e produção no Supabase em São Paulo, Inngest e domínio ainda por criar. |

**A primeira caminhada pelo app** (2026-10-21, contra o banco de desenvolvimento): escritório fundado com segundo fator, cada tela do menu, um caso aberto e o link do cliente no celular, documentos conferidos pelo modelo real e aceitos pelo ONE, um trecho lido do cartão de embarque, conversa pelo simulador, convite aceito, e o ONE levando o caso até o primeiro texto da peça. Telas que ainda não foram percorridas com dados: publicações, prazos, audiências, pacote e assinatura, importação, dossiê.

## 9. Onde está o desenvolvimento

| Marco | O que entrega | Estado em 2026-10-22 |
| --- | --- | --- |
| M0 · Base limpa e segura | Repositório do ONE, só pt-BR, sem nada de outro produto | Pronto (2026-10-08). |
| M1 · Fundação para vários escritórios | Escritório e equipe, segundo fator, cofre, arquivos, camada de IA com fila de aprovação, WhatsApp, `/inicio` | Pronto. |
| M2 · Do contrato assinado à petição inicial | Caso, link do cliente, assinatura, conferência de documentos, regras, relato, peça, biblioteca, dossiê, pacote, DJEN | Pronto, menos o teste do posto de protocolo no Projudi com um advogado do piloto. |
| M3 · Carteira nacional viva e pronto para outros escritórios | Andamento, importação, prazos, triagem com amostra, pacotes eproc e PJe, audiências, avisos ao cliente, autonomia por escritório, o ONE levando o caso, assinatura em nuvem | Em andamento. Construído: S8, S9 e dez partes do S10. Falta: o cliente do MNI e o protocolo pelo ONE; o resumo semanal do sócio; a vigia do DJEN e da troca de sistema de um tribunal; a cobrança do ONE (Asaas, faixas, medição, painel de consumo); o suporte assistido e o console de escritórios refeitos; o backup adaptado. |
| M4 · Atendimento com IA e Direito do Passageiro | Atendente de IA em modo sugestão, CRM com origem do lead, follow-ups; o passageiro se cadastra na página do escritório antes de voar e recebe mensagens informativas no dia do voo | Adiantado em 2026-10-29: o Direito do Passageiro virou um módulo separado do núcleo, com a área da agência parceira (passageiros, viagens, documentos lidos pela IA, link do acordo, planilha, API), a passagem do cadastro da agência para o caso quando o passageiro aceita a ajuda depois de um problema no voo, a retenção e os direitos do passageiro. |
| M5 · Números | Resultados, faixa de acordo por companhia, estimativa de tempo com margem de erro, painel de volume e semelhança | Não começado. |
| M6 · Escala para novos escritórios | Módulo versionado como dado, instalação de um escritório em um dia, migração pela OAB, raio-x pela OAB | Não começado. |

## 10. O que depende do dono, fora do código

A lista completa, com o estado de cada item, é o documento "ONE · O que providenciar fora da plataforma" (https://claude.ai/code/artifact/2b7654a2-a43b-407e-b042-c27c43ea3664). Os que mais seguram o produto:

- Projetos Supabase de homologação e produção em São Paulo; plano Pro na Vercel (o Hobby é só para uso pessoal); conta no Inngest; domínio do ONE com o Resend.
- O app do ONE na Meta, sem o qual nenhum número real conecta.
- A identidade oficial (logo, paleta, tipografia) e os textos legais (termos de uso, privacidade, cookies), que nenhuma migração semeia.
- Contrato com o Serpro; resposta da FlightAware sobre o plano; cadastro na REDEMET; chaves de teste de Judit, Escavador e Codilo, e depois o contrato do agregador escolhido.
- Projeto Google com a API de agenda, publicado fora do modo de teste.
- Cadastro do ONE como aplicação nos PSC, com um certificado SSL ICP-Brasil do domínio, e um advogado do piloto com certificado em nuvem.
- O acesso ao MNI do TJGO, pedido pelo piloto à engenharia de software do tribunal, com o ambiente de teste do Projudi.
- O teste do posto de protocolo no Projudi, no eproc e no PJe com um advogado (login, assinador, limites reais de arquivo, tipos de cada arquivo).
- O cabeçalho de uma exportação do Astrea feita pelo piloto (só os nomes das colunas), para a importação reconhecer as colunas sozinha.
- A meta que uma categoria da triagem de IA precisa bater para sair do modo sombra (os números da configuração são uma proposta).
- A conta do Asaas e as faixas e preços da assinatura.
- O curador do conteúdo padrão do módulo e os textos que o cliente aceita no link.

## 11. Pontos em aberto e riscos de produto

- **O site promete o contrário do padrão.** A descrição do ONE no site e nos metadados diz "com o advogado no controle de cada decisão", enquanto o padrão, desde 2026-10-14, é o ONE decidir sozinho, inclusive a peça e o prazo. O escritório pode mudar isso, mas o texto público precisa refletir a decisão. É do dono escolher a frase.
- **Recomendação n. 001/2024 do Conselho Federal da OAB, item 3.1:** o julgamento profissional não é feito por IA generativa sem supervisão humana, e nenhuma atividade privativa da advocacia é delegada a ela. O padrão de o ONE aprovar sozinho o texto da peça fica em tensão com isso; a tela de autonomia cita o item ao lado das decisões do advogado, e o card do protocolo diz quando nenhum advogado leu a petição.
- **A ação da OAB-SP contra a Enter** (2026-10-07, Justiça Federal de São Paulo) aponta quatro marcas que valem para qualquer fornecedor: pagamento atrelado ao resultado, estratégia sem decisão registrada de um advogado, peças "prontas para protocolar" validadas mais rápido do que se lê, e intermediação de causas. A Enter vende a defesa de massa às companhias que os escritórios do ONE processam, e os tribunais têm ferramentas próprias que procuram padrões (Berna no TJGO, Atalaia no CNJ, InfoVoo). A análise completa está em `reports/Análise da Enter para o ONE.md` (fora do repositório).
- **Família dividida:** o TJMT e a 2ª Turma Cível do TJDFT rejeitaram a divisão adultos no juizado e menor na vara cível; a 7ª Turma Cível do TJDFT aceitou. Por isso a família vai junta por padrão; os julgados ficam no console do operador.
- **Achados da primeira caminhada que esperam o operador:** o modelo aceitou documentos marcados "documento de teste, sem validade" (as instruções da tarefa não pedem que recuse; uma nova versão se publica em `/admin/ai`); a tabela de preços dos modelos está vazia; o trecho lido de um bilhete não é marcado como o trecho afetado, que as regras leem.
- **Todo sistema de tribunal está "não confirmado"** na tabela até o operador conferir os atos do tribunal, então um pacote espera por isso ou por um advogado que nomeie o sistema na ação.
- **Só o calendário de 2026 do TJGO está registrado.** Nos outros tribunais e anos, a contagem de prazo usa fins de semana, feriados nacionais e o recesso, e diz isso.
- **Leitura por inscrição na OAB:** quando um advogado sai do escritório, as publicações dos processos dele deixam de ser lidas para esse escritório (o escritório é avisado).
- **A biblioteca começa vazia.** Uma lista de fontes sugerida pela plataforma seria decisão do dono.
- **Tribunais federais e do trabalho** não entram: a importação os recusa e não há calendário para eles.
- **Agência parceira e captação de clientela:** o passageiro de uma agência chega ao escritório pelo aviso de um problema no voo, depois de concordar no link do acordo. O parecer jurídico sobre captação (Estatuto da Advocacia, art. 34, IV, e Código de Ética, art. 7º) diz se o escritório pode receber clientes assim; até lá, o primeiro aviso a um passageiro real espera a liberação do operador, como qualquer outro. A cláusula do contrato da agência é dela, e o texto do ONE que vem antes dela no link é uma configuração da plataforma para o curador revisar.
- **Faltam, pelo que a defesa ataca primeiro:** procuração com assinatura ICP-Brasil ou por escritura quando o juiz pedir (a Nota Técnica NEA 01/2026 do TJGO permite), conferência mais funda do comprovante de endereço, prova de embarque por pessoa, e uma medida de que o advogado leu (tempo entre a prévia e a aprovação).

## 12. Fora do escopo agora

- Outros módulos: Direito Previdenciário (com o salário-maternidade) e Direito Trabalhista aparecem como "Em breve" desde 2026-10-30; plano de saúde depois.
- Aplicativo móvel; outro idioma além do português.
- Qualquer controle de valores de processo, repasse ao cliente ou nota fiscal do escritório.
- Peças depois da inicial, pesquisa de satisfação, balcão virtual.

## Fontes

- `CLAUDE.md` da raiz ("Where things stand", "Product decisions the code assumes"): o estado do código, mantido a cada entrega.
- [`docs/ONE-PLANO-DESENVOLVIMENTO.md`](ONE-PLANO-DESENVOLVIMENTO.md): o plano de engenharia aprovado em 2026-10-08. Algumas premissas dele mudaram depois (a autonomia, a custódia da assinatura em nuvem, a família com menor, AeroDataBox trocado por ANAC e FlightAware); vale o que este documento e o `CLAUDE.md` dizem.
- `attachments/` (fora do repositório): a apresentação "ONE, Tudo em um só lugar", os mapas de fluxo geral e do passageiro e a transcrição da reunião com o advogado do piloto.
- `reports/Análise da Enter para o ONE.md` e `research_notes/` (fora do repositório): a análise da Enter, os julgados sobre a família dividida, a nota técnica do TJGO e a pesquisa sobre protocolo automatizado.
- "ONE · O que providenciar fora da plataforma" (https://claude.ai/code/artifact/2b7654a2-a43b-407e-b042-c27c43ea3664): o que o dono providencia.
