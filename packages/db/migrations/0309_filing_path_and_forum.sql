-- ============================================================
-- 0309_filing_path_and_forum: ONE keeps the path of a filing it started, reads the PJe's tabs, sections and
-- pressable cells, and chooses the place inside the comarca by the client's neighbourhood.
--
-- The owner's third filing through the extension in the PJe of TJRJ (2026-11-27, test case 19) went through "Dados
-- iniciais" and "Assuntos" by itself and stopped twice: on "Assuntos" ONE saw no tab to go on to and could not read
-- the subjects already taken; after the lawyer opened "Partes" and said "Continuar", ONE took its own filing for an
-- old draft ("Devo seguir com este rascunho ou abrir Processo > Novo processo?"), as each run read only the screen it
-- was on. The owner also asked the jurisdição of the client's domicile, "Comarca da Capital - Lagoa" for a client of
-- the Jardim Botânico, where ONE had chosen "Comarca da Capital". A recording of the lawyer's own walk of "Novo
-- processo" that day (ONE's recorder only read the screens) showed why ONE could not see: the PJe's tabs are cells of
-- RichFaces' tab panel, not links; each column's name holds a script ("Cod.function clear_l_processoAssunto..."), so
-- no table of codes was ever read line by line; "+ Parte" is a cell with an onclick; a radio's question is a label of
-- the table that holds the options; and the box "Sigiloso" has an empty label before its own.
--
-- 1. A fifth version of the instructions of `protocolo.tela`: every screen is read with the path of the screens before
--    it in this filing (`percurso`, carried across the lawyer's "Continuar"), so a filing ONE started is its own and
--    what was done is done; the tabs ("Aba Partes", "(aberta)"), a field's section ("Polo Ativo"), a radio with its
--    question ("Justiça Gratuita? · Sim") and a cell made pressable; the PJe's parties and costs as the recording
--    showed them; and the place inside the comarca by `processo.foro`. The fourth's schema, model, effort and tokens;
--    in force in its place.
-- 2. `court_forum_areas`: the places of a court inside a comarca and the neighbourhoods each takes, as the court's
--    act lists them, the platform's (read by any account, written only by migrations), each row with its source and
--    unconfirmed until the operator checks it. ONE hands the place of the first claimant's neighbourhood
--    (`forumOfDistrict` of `@flyee/rules/forum`) where the comarca is their city; a neighbourhood not listed goes to
--    the comarca, as before, and nothing is guessed.
-- ============================================================

-- ---------- 1. The fifth instructions of `protocolo.tela` ----------

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'protocolo.tela',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'protocolo.tela'),
  current_version.provider,
  current_version.model,
  current_version.effort,
  $prompt$Você opera, para um escritório de advocacia, a tela de peticionamento do sistema de um tribunal brasileiro, para protocolar uma petição inicial que o advogado já aprovou. O advogado entrou no sistema com o próprio acesso. Você nunca vê os dados das pessoas: você vê a estrutura da tela e os nomes dos fatos do caso, e o programa digita os valores pelos nomes que você indicar. Depois das suas ações, o programa lê a tela de novo; enquanto ela for a mesma tela, você a recebe outra vez, com o que já foi feito nela. A cada tela você recebe também o percurso deste protocolo: as telas pelas quais o ONE já passou antes desta e o que fez em cada uma.

Você recebe, em JSON:
- sistema: o nome do sistema (por exemplo, "eproc do TJSP").
- aprendendo: true quando o ONE ainda não conhece este sistema. Nesse caso, quando a tela for o resumo final antes do envio, diga que é o resumo e não clique no botão que envia.
- fatos: a lista dos fatos do caso que podem ir para a tela, cada um com chave, descrição e, quando não é dado de pessoa, o valor (a classe e o código dela na tabela do CNJ, o rito, a comarca, os assuntos e os códigos deles na tabela do CNJ, o valor da causa, se há pedido de justiça gratuita e de prioridade). Os dados de pessoa (nome, CPF, endereço, e-mail, telefone) vêm só com a chave e a descrição.
- partes: quantos autores e quantos réus, cada um pela sua chave (autor.1, autor.2, reu.1), e quem representa um menor.
- arquivos: os arquivos do pacote, na ordem, cada um com a posição, o tipo do documento e o nome.
- tela: a estrutura da tela, quadro por quadro ("quadro" é a posição dele): os campos, cada um com "alvo" (o endereço pelo qual o programa o acha), tipo, rótulo, nome, se é obrigatório, se está visível e, nas listas do próprio sistema, as opções com código e texto; os botões e os links com o texto e o "alvo"; as abas do sistema, como links de rótulo "Aba" e o nome dela (por exemplo, "Aba Partes"), a aba aberta com "(aberta)" no fim e uma aba que ainda não se pode abrir com disabled true; os títulos e as tabelas (os nomes das colunas e quantas linhas). Um campo pode trazer "section", o título da parte da tela em que está (por exemplo, "Polo Ativo", "Polo Passivo", "Segredo de Justiça"): use-o para distinguir dois campos de mesmo rótulo. Um botão de opção ou uma caixa cuja resposta é só "Sim" ou "Não" vem com a pergunta antes, separada por " · " (por exemplo, "Justiça Gratuita? · Sim"). Um elemento que a página tornou clicável sem ser botão nem link (no PJe, o "+ Parte" de cada polo) vem como botão, com as palavras dele ou o título do ícone. Cada campo diz também o que a tela tem nele agora, sem dizer o que foi escrito: "chosen" é o código da opção escolhida agora numa lista do próprio sistema (vazio ou nulo quando nenhuma), "checked" diz se uma caixa está marcada e "filled" diz se um campo de texto ou de arquivo já tem algo. Uma tabela dos códigos do próprio sistema (os assuntos, as classes) vem com "lines": cada linha com "cells", as palavras das células na ordem das colunas, e "actions", os botões e os links daquela linha, cada um com o seu "alvo"; uma ação que é só um ícone vem com o nome do ícone (por exemplo, "ícone: seta para a esquerda"). Uma tabela de pessoas, de documentos ou de processos traz só os nomes das colunas e quantas linhas tem.
- feito: o que já foi feito nesta mesma tela, nas leituras anteriores, em ordem, cada ação com o resultado: "ok" (feita), "not_done" (a tela não aceitou: o elemento não estava lá, estava desabilitado ou a lista não tinha a opção), "unknown_target", "unknown_fact" ou "unknown_file". Cada ação vem com "rotulo", as palavras do campo em que foi feita. Vem vazio na primeira leitura de uma tela.
- percurso: as telas pelas quais o ONE já passou neste protocolo, antes desta, em ordem: o título de cada uma e o que o ONE fez nela que a tela aceitou, cada ação com "fazer", "rotulo" (as palavras do campo) e, quando digitou um fato, "fato" (a chave dele). Vem vazio na primeira tela do protocolo.

Responda só com o objeto pedido:
- tela.tipo: "login" (pede usuário e senha), "segundo_fator" (pede um código), "formulario" (um passo do peticionamento), "resumo" (o resumo final, antes de confirmar), "recibo" (o processo foi distribuído: mostra o número), "erro" (o sistema recusou algo e diz o quê), "aviso" (algo que só uma pessoa resolve, como um captcha, um termo para aceitar ou uma mensagem do tribunal) ou "outra". tela.titulo: o título da tela como ela mostra.
- acoes: o que fazer agora nesta tela, em ordem, no máximo quarenta. Cada ação tem "fazer" e "alvo" (o "alvo" do campo, do botão ou da ação de linha, copiado exatamente como veio na tela, por exemplo "0|#campo|0", sem tirar nem pôr nada) e, conforme o caso:
  - "preencher" com "fato" (a chave do fato cujo valor o programa digita);
  - "escolher" numa lista do próprio sistema, com "opcao" (o código da opção, exatamente como veio) ou, numa lista que o sistema preenche depois de uma busca, com "fato";
  - "marcar" ou "desmarcar" uma caixa;
  - "clicar" num botão ou link, também na ação de uma linha de tabela (o "alvo" que veio em "actions" daquela linha);
  - "anexar" com "arquivo" (a posição do arquivo do pacote);
  - "esperar" quando a tela precisa terminar de carregar, com o "alvo" do campo que você espera ou vazio.
  Marque "envia": true na ação que manda algo ao tribunal (por exemplo, "Confirmar ajuizamento", "Protocolar", "Finalizar" quando finaliza o envio). Dê "motivo" curto quando a escolha não for óbvia.
- pronto: true quando, depois dessas ações, esta tela estará feita e o sistema vai para a próxima.
- pergunta: vazio, ou o que só o advogado pode responder para seguir (um campo que nenhum fato preenche e que não se pode deixar em branco, uma opção que nenhum fato decide). Quando há pergunta, não invente: pare antes do campo em dúvida.

Regras:
- Nunca preencha um campo de usuário, senha ou código: em "login" e "segundo_fator", responda sem ações; o programa cuida do acesso com o advogado.
- Nunca resolva captcha, nunca aceite termo em nome do advogado e nunca tente contornar uma proteção do sistema: responda "aviso" com a pergunta.
- Nunca invente um valor nem uma opção. Use só os fatos dados, pelas chaves dadas, e só os alvos e códigos que vieram na tela.
- Escolha nas listas do sistema a opção que corresponde ao fato pelo sentido (a classe "Procedimento do Juizado Especial Cível" para o rito do juizado especial, a comarca do caso, o assunto pelo código do CNJ), nunca a primeira da lista.
- O percurso é deste protocolo, feito pelo ONE agora: quando ele mostra telas ou abas já feitas (por exemplo, os Dados iniciais gravados e os assuntos incluídos), a tela aberta é a continuação delas, nunca um rascunho antigo de outra pessoa. Siga dela, da aba ou do passo em que está; não pergunte se deve seguir nem se deve abrir um novo processo. Um participante que o próprio sistema incluiu (no PJe, o advogado que entrou com o acesso dele aparece no polo ativo) não muda isso. Só quando o percurso vem vazio e a tela mostra um cadastro já começado, diga em pergunta.
- O que "feito" ou o percurso mostram com "ok" está feito: não refaça e não pergunte por isso. Quando uma tabela não mostra as linhas do que já foi incluído, mas "feito" ou o percurso mostram a inclusão com "ok", conte como incluído.
- Comarca ou jurisdição: a opção da comarca do caso (processo.comarca; no TJRJ, a cidade do Rio de Janeiro é a "Comarca da Capital"). Quando processo.foro existe, escolha a opção dessa comarca que traz esse foro no nome (por exemplo, "Comarca da Capital - Lagoa" para o foro "Lagoa", "Comarca da Capital - Regional da Barra da Tijuca" para "Regional da Barra da Tijuca"); quando processo.foro é "Central", ou não existe, a opção da comarca sem foro no nome. Nunca escolha um foro por conta própria.
- Antes de agir, veja o que a tela já tem: uma lista cujo "chosen" já é o código certo, uma caixa marcada como deve, um campo com "filled" true. Não refaça o que já está feito: siga do primeiro campo que falta.
- Listas que o sistema carrega depois de outra escolha (por exemplo, a jurisdição depois da matéria e a classe depois da jurisdição): escolha uma lista por vez, termine as ações com "esperar" e responda pronto false; na leitura seguinte, com a próxima lista carregada, escolha nela. Nunca escolha numa lista que ainda não mostra a opção.
- Quando "feito" diz que uma escolha deu "ok" e a tela mostra a lista sem ela ("chosen" vazio ou outro código), a tela desfez a escolha: escolha de novo uma vez e termine com "esperar". Se ela for desfeita outra vez, não repita: diga em pergunta o que a tela não aceita.
- Uma ação com "not_done" em "feito" não se repete igual: espere a tela carregar ou siga outro caminho que a tela oferece; se não houver, diga em pergunta o que falta.
- Busca de assunto ou de classe: preencha o campo do código com o fato do código (processo.assunto_principal_codigo, processo.assunto_complementar_codigo, processo.classe_codigo) quando ele existe, senão o campo do nome com o fato do nome; clique no botão de pesquisar e termine com "esperar". Na leitura seguinte, o resultado vem nas "lines" da tabela: clique na ação da linha cujo código ou cujas palavras correspondem ao fato (por exemplo, "Adicionar" ou o ícone de seta da linha), nunca na primeira linha só por ser a primeira. Quando a busca pelo código não traz nenhuma linha, limpe o campo do código e busque pelo nome (o fato do nome, ou as palavras principais dele, como "transporte aéreo"); quando ainda assim nenhuma linha corresponde, diga em pergunta. Uma tabela dos assuntos já incluídos mostra nas "lines" o que já está lá: não inclua de novo. Inclua o assunto principal e depois o complementar.
- Quando os campos de uma aba ou de um passo estão feitos, clique no botão que os grava (como "Incluir", "Salvar" ou "Próxima"), quando a tela tem um, e, se o sistema segue por abas, clique no link da aba seguinte ("Aba" e o nome dela). Uma aba sem botão de gravar (no PJe, Assuntos, onde cada assunto entra pela ação da linha) está feita quando o que ela pede foi incluído. No PJe as abas são, em ordem: Dados iniciais, Assuntos, Partes, Características, Incluir petições e documentos, Custas judiciais e Protocolar inicial; a aba Protocolar inicial abre o resumo, e o botão "Protocolar" do resumo é o que envia.
- Características da ação: use processo.justica_gratuita, processo.liminar e processo.valor_causa e grave com o botão da parte delas; processo.segredo_de_justica e grave com o botão do sigilo; inclua uma prioridade só quando processo.prioridade existe, a opção que corresponde a ele, e nenhuma outra (como Juízo 100% Digital) sem um fato que a dê. Um fato que falta e a tela exige é pergunta.
- Custas: siga processo.custas; sem guia, escolha o motivo de não gerar custas que corresponde a ele (no PJe do TJRJ, o motivo "Juizado Especial Cível" para o juizado) e grave com "Salvar", deixando a guia em branco. Sem esse fato, diga em pergunta.
- Botão que assina os documentos com o certificado do advogado (como "Assinar documento(s)"): clique nele uma vez, depois de incluídos todos os arquivos, cada um com o seu tipo; o programa para e pede ao advogado que assine no computador dele. Quando "feito" já mostra esse clique com "ok", não clique de novo: siga para a aba seguinte.
- O programa leva cada campo à vista antes de agir: você não precisa rolar a tela.
- Partes no PJe: o autor entra pelo botão "Parte" da seção "Polo Ativo" e o réu pelo botão "Parte" da seção "Polo Passivo" (nunca o de "Procurador | Terceiro Vinculado" nem o de "Outros Participantes"); a janela que abre pede o tipo da parte (AUTOR no polo ativo, RÉU no polo passivo), o tipo de pessoa (Física para o autor, Jurídica para a companhia aérea), "Brasileiro?" e o CPF ou o CNPJ, com "Pesquisar". O advogado que entrou com o acesso dele já vem no polo ativo: não o cadastre de novo.
- Partes: cadastre cada autor e cada réu na ordem das chaves, pela consulta que o próprio sistema oferece (CPF ou CNPJ) e, quando o sistema pedir endereço e contato, pelos fatos de endereço, e-mail e telefone daquela parte.
- Arquivos: anexe todos os arquivos do pacote, na ordem, com o tipo de documento do sistema que corresponde a cada um.
- Com aprendendo true, numa tela "resumo", não inclua a ação que envia: responda pronto false e sem a ação de envio, que o advogado confirma antes.
- Quando a tela é "erro", não repita a ação que falhou: diga o que corrigir em pergunta.$prompt$,
  current_version.output_schema,
  current_version.max_tokens,
  false,
  'Lê cada tela com o percurso deste protocolo (o ONE segue no cadastro que ele mesmo começou), as abas, a seção de cada campo, a pergunta de cada Sim e Não, as células clicáveis do PJe, as partes e as custas como o advogado as percorreu, e o foro da comarca pelo bairro do autor (processo.foro).'
from (
  select v.provider, v.model, v.effort, v.output_schema, v.max_tokens from public.prompt_versions v
  where v.task = 'protocolo.tela'
  order by v.is_active desc, v.version desc limit 1
) as current_version
where not exists (
  select 1 from public.prompt_versions v
  where v.task = 'protocolo.tela' and position('percurso' in v.system_prompt) > 0
);

-- In force: one version per task, so the one in force leaves before the new one comes in.
update public.prompt_versions as v set is_active = false
where v.task = 'protocolo.tela' and v.is_active
  and position('percurso' in v.system_prompt) = 0
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version
      and position('percurso' in w.system_prompt) > 0
  );
update public.prompt_versions set is_active = true
where task = 'protocolo.tela'
  and version = (
    select max(w.version) from public.prompt_versions w
    where w.task = 'protocolo.tela' and position('percurso' in w.system_prompt) > 0
  )
  and not exists (select 1 from public.prompt_versions w where w.task = 'protocolo.tela' and w.is_active);

-- ---------- 2. The places of a court inside a comarca, by neighbourhood ----------

create table public.court_forum_areas (
  court text not null references public.courts (acronym) on update cascade,
  -- The comarca as ONE writes a lawsuit's (`proceedings.comarca`: the city, "Rio de Janeiro").
  comarca text not null,
  kind text not null,
  -- The neighbourhood as the court's act writes it; compared as `districtKey` reads it.
  district text not null,
  -- The place as the court's system names it inside the comarca ("Lagoa", "Regional da Barra da Tijuca", "Central").
  forum text not null,
  source_url text not null,
  read_on date not null,
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint court_forum_areas_kind_check check (kind in ('juizado', 'comum')),
  constraint court_forum_areas_names_check check (
    char_length(comarca) between 2 and 120 and char_length(district) between 2 and 120
    and char_length(forum) between 2 and 120
    and comarca !~ '[[:cntrl:]]' and district !~ '[[:cntrl:]]' and forum !~ '[[:cntrl:]]'
  ),
  constraint court_forum_areas_source_check check (source_url like 'https://%' and char_length(source_url) <= 500)
);

create unique index court_forum_areas_district_idx
  on public.court_forum_areas (court, (public.slugify(comarca)), kind, (public.slugify(district)), (public.slugify(forum)));

alter table public.court_forum_areas enable row level security;
create policy "court_forum_areas_select_member" on public.court_forum_areas for select to authenticated using (true);
grant select on table public.court_forum_areas to authenticated;

-- ---------- 3. The places of the TJRJ's small-claims courts in the Capital ----------
-- As the court's own consolidated listing names them ("Consulta de abrangência" of the Juizados Especiais, read on
-- 2026-11-27: each Juizado with the neighbourhoods it takes and the act that gave them), the places as the PJe's
-- "Jurisdição" names them ("Comarca da Capital - Lagoa", "Comarca da Capital - Regional do Méier"; "Central" is the
-- "Comarca da Capital" itself), and Copacabana and Leme with the "Comarca da Capital" since 2026-06-24 (Ato Executivo
-- Conjunto TJ/CGJ 19/2026: the V Juizado Especial Cível takes no new lawsuit). A neighbourhood the court spells
-- otherwise than the city is kept in both spellings. The neighbourhoods the listing does not name (the bairro
-- Jacarepaguá, Argentino, Ingleses, Vila Kennedy, Jabour) are left out: their lawsuits go to the comarca, as before.
-- The civil courts of the Capital have no such split since 2025-06-02 (Res. TJ/OE 16/2025): none is listed for them.

insert into public.court_forum_areas (court, comarca, kind, district, forum, source_url, read_on)
select 'TJRJ', 'Rio de Janeiro', 'juizado', v.district, v.forum, v.source_url, date '2026-11-27'
from (values
  ('Santo Cristo', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Caju', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Saúde', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Gamboa', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Aeroporto', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Castelo', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Centro', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Fátima', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Lapa', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Praça Mauá', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Rio Comprido', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Estácio', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cidade Nova', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Catumbi', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('São Cristóvão', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Imperial de São Cristóvão', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vasco da Gama', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Benfica', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Mangueira', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Paquetá', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Santa Teresa', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Santa Tereza', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Botafogo', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Catete', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cosme Velho', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Flamengo', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Glória', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Laranjeiras', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Urca', 'Central', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Gávea', 'Lagoa', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Ipanema', 'Lagoa', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Jardim Botânico', 'Lagoa', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Lagoa', 'Lagoa', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Leblon', 'Lagoa', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('São Conrado', 'Lagoa', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vidigal', 'Lagoa', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Humaitá', 'Lagoa', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Tijuca', 'Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Alto da Boa Vista', 'Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Praça da Bandeira', 'Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vila Isabel', 'Vila Isabel', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Andaraí', 'Vila Isabel', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Maracanã', 'Vila Isabel', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Grajaú', 'Vila Isabel', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Ilha do Governador', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Zumbi', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cacuia', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Pitangueiras', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Praia da Bandeira', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cocotá', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Bancários', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Tauá', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Galeão', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Moneró', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Portuguesa', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Jardim Guanabara', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cidade Universitária', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Freguesia (Ilha)', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Freguesia (Ilha do Governador)', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Jardim Carioca', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Ribeira', 'Regional da Ilha do Governador', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Bangu', 'Regional de Bangu', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Padre Miguel', 'Regional de Bangu', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Gericinó', 'Regional de Bangu', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Senador Camará', 'Regional de Bangu', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Campo dos Afonsos', 'Regional de Bangu', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Deodoro', 'Regional de Bangu', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Magalhães Bastos', 'Regional de Bangu', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Mallet', 'Regional de Bangu', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Realengo', 'Regional de Bangu', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Jardim Sulacap', 'Regional de Bangu', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vila Militar', 'Regional de Bangu', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Campo Grande', 'Regional de Campo Grande', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Senador Vasconcelos', 'Regional de Campo Grande', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Senador Augusto Vasconcelos', 'Regional de Campo Grande', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Inhoaíba', 'Regional de Campo Grande', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cosmos', 'Regional de Campo Grande', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Santíssimo', 'Regional de Campo Grande', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Guaratiba', 'Regional de Campo Grande', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Pedra de Guaratiba', 'Regional de Campo Grande', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Barra de Guaratiba', 'Regional de Campo Grande', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Ilha de Guaratiba', 'Regional de Campo Grande', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Taquara', 'Regional de Jacarepaguá', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Tanque', 'Regional de Jacarepaguá', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Praça Seca', 'Regional de Jacarepaguá', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vila Valqueire', 'Regional de Jacarepaguá', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Freguesia (Jacarepaguá)', 'Regional de Jacarepaguá', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Anil', 'Regional de Jacarepaguá', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Pechincha', 'Regional de Jacarepaguá', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Gardênia Azul', 'Regional de Jacarepaguá', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cidade de Deus', 'Regional de Jacarepaguá', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Curicica', 'Regional de Jacarepaguá', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Bento Ribeiro', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Campinho', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cascadura', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Engenheiro Leal', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cavalcanti', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cavalcante', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Honório Gurgel', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Madureira', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Marechal Hermes', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Osvaldo Cruz', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Oswaldo Cruz', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Rocha Miranda', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Turiaçu', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Turiassu', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vaz Lobo', 'Regional de Madureira', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Santa Cruz', 'Regional de Santa Cruz', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Paciência', 'Regional de Santa Cruz', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Sepetiba', 'Regional de Santa Cruz', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Del Castilho', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Engenho da Rainha', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Inhaúma', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Higienópolis', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Maria da Graça', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Tomás Coelho', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Todos os Santos', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cachambi', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Engenho de Dentro', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('São Francisco Xavier', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Rocha', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Méier', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Riachuelo', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Sampaio', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Sampaio Correia', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Lins de Vasconcelos', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Engenho Novo', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Abolição', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Água Santa', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Encantado', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Jacaré', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Piedade', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Pilares', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Quintino Bocaiúva', 'Regional do Méier', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Barra da Tijuca', 'Regional da Barra da Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Joá', 'Regional da Barra da Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Recreio dos Bandeirantes', 'Regional da Barra da Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vargem Grande', 'Regional da Barra da Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Grumari', 'Regional da Barra da Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Itanhangá', 'Regional da Barra da Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Camorim', 'Regional da Barra da Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vargem Pequena', 'Regional da Barra da Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Barra Olímpica', 'Regional da Barra da Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Rocinha', 'Regional da Barra da Tijuca', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Ramos', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Manguinhos', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Olaria', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Bonsucesso', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Brás de Pina', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Penha', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Penha Circular', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vicente de Carvalho', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vila da Penha', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vista Alegre', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vila Kosmos', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Irajá', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Colégio', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Jacarezinho', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vieira Fazenda', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Complexo do Alemão', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Maré', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vila Esperança', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vila do João', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vila do Pinheiro', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Conjunto Pinheiros', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Praia de Ramos', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Timbau', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Marcílio Dias', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Baixa do Sapateiro', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Nova Holanda', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Rubens Vaz', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Parque União', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Roquete Pinto', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Vigário Geral', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Jardim América', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Parada de Lucas', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Cordovil', 'Regional da Leopoldina', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Anchieta', 'Regional da Pavuna', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Ricardo de Albuquerque', 'Regional da Pavuna', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Guadalupe', 'Regional da Pavuna', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Parque Anchieta', 'Regional da Pavuna', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Pavuna', 'Regional da Pavuna', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Coelho Neto', 'Regional da Pavuna', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Acari', 'Regional da Pavuna', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Barros Filho', 'Regional da Pavuna', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Costa Barros', 'Regional da Pavuna', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Parque Colúmbia', 'Regional da Pavuna', 'https://portaltj.tjrj.jus.br/web/juizados-especiais/consulta-abrangencia?CodCom=406&CodAtribuicao=56'),
  ('Copacabana', 'Central', 'https://www3.tjrj.jus.br/consultadje/pdf.aspx?dtPub=25/06/2026&caderno=A&pagina=15'),
  ('Leme', 'Central', 'https://www3.tjrj.jus.br/consultadje/pdf.aspx?dtPub=25/06/2026&caderno=A&pagina=15')
) as v (district, forum, source_url)
on conflict do nothing;
