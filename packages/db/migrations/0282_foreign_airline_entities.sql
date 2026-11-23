-- ============================================================
-- 0282_foreign_airline_entities: the legal entity in Brazil of the foreign airlines a passenger sues.
--
-- The owner's test of 2026-11-23: a piece against Qatar Airways came out with "[COMPLETAR: CNPJ da companhia,
-- razão social da companhia]" for a lawyer to complete, while the client had sent everything asked of her. What
-- answers in court for an airline is not on any paper of the passenger: ONE writes it from what is recorded of the
-- airline (`airlines.legal_name`, `cnpj` and `address`, filled into `[[RE]]` by `case_draft_filled`, 0218), and only
-- the four Brazilian operators had it (0058).
--
-- Recorded here, for the twenty foreign airlines of the table, the establishment each one keeps in Brazil, the one a
-- passenger's lawsuit names: each CNPJ checked on 2026-11-23 in the Receita Federal's open CNPJ data (through
-- BrasilAPI, publica.cnpj.ws or ReceitaWS), active, the head of its registration in Brazil (0001), scheduled passenger
-- air transport, with the address the Receita Federal has for it, written as 0215 writes the Brazilian operators'. The name is the registered one, written as the
-- company writes it. Ethiopian Airlines also has the CNPJ of its foreign head office (21477704000120, with an address
-- abroad): the establishment in São Paulo is the one recorded. JetSMART has three registrations in Brazil: JA is the
-- Chilean JetSMART Airlines SpA. LATAM keeps one code (0059), its head office recorded since 0215. Avianca
-- Brasil (O6) stopped flying and stays as it was. A piece ONE wrote against them and nobody touched is owed
-- ONE's approval again. Nothing else of the airlines changes.
-- ============================================================

update public.airlines a
set legal_name = x.legal_name, cnpj = x.cnpj, address = x.address, updated_at = now()
from (values
  ('QR', 'Qatar Airways Group (Q.C.S.C.)', '08734301000150',
   'Alameda Santos, nº 787, 12º andar, conjunto 122, Cerqueira César, São Paulo/SP, CEP 01419-001'),
  ('TP', 'Transportes Aéreos Portugueses S.A.', '33136896000190',
   'Avenida Paulista, nº 453, 14º andar, Bela Vista, São Paulo/SP, CEP 01311-000'),
  ('AA', 'American Airlines Inc.', '36212637000199',
   'Rua Doutor Fernandes Coelho, nº 64, 7º ao 9º andares, Pinheiros, São Paulo/SP, CEP 05423-040'),
  ('AF', 'Société Air France', '33013988000182',
   'Rua Gomes de Carvalho, nº 1629, 3º andar, salas 304 e 305, Vila Olímpia, São Paulo/SP, CEP 04547-006'),
  ('KL', 'KLM Cia. Real Holandesa de Aviação', '33643420000145',
   'Rua Gomes de Carvalho, nº 1629, 3º andar, salas 304 e 305, Vila Olímpia, São Paulo/SP, CEP 04547-006'),
  ('AM', 'Aerovías de México S.A. de C.V. Aeroméxico', '01369588000118',
   'Avenida Paulista, nº 37, 4º andar, Bela Vista, São Paulo/SP, CEP 01311-902'),
  ('AR', 'Aerolíneas Argentinas S.A.', '33605239000144',
   'Rodovia Hélio Smidt, s/nº, Terminal 2, nível check-in C, sala 92, Aeroporto, Guarulhos/SP, CEP 07190-100'),
  ('AV', 'Aerovías del Continente Americano S.A. Avianca', '33712837000112',
   'Avenida Paulista, nº 2064, 14º andar, sala 1429, Edifício Paulista Center 3, Bela Vista, São Paulo/SP, CEP 01310-928'),
  ('BA', 'British Airways PLC', '50710730000154',
   'Rodovia Hélio Smidt, s/nº, sala 1T3088, Aeroporto, Guarulhos/SP, CEP 07190-971'),
  ('CM', 'Compañía Panameña de Aviación S.A.', '03834757000179',
   'Avenida Paulista, nº 1337, 4º andar, conjuntos 41 e 42, Bela Vista, São Paulo/SP, CEP 01311-200'),
  ('DL', 'Delta Air Lines Inc.', '00146461000177',
   'Rodovia Hélio Smidt, s/nº, Terminal 3, nível 1, sala 1P3052, Aeroporto, Guarulhos/SP, CEP 07190-100'),
  ('EK', 'Emirates', '08692080000103',
   'Rua James Joule, nº 92, 7º andar, conjuntos 71 e 72, Cidade Monções, São Paulo/SP, CEP 04576-080'),
  ('ET', 'Ethiopian Airlines Group', '18002679000113',
   'Rua Doutor Rafael de Barros, nº 210, escritório 41, Paraíso, São Paulo/SP, CEP 04003-041'),
  ('H2', 'Sky Airline S.A.', '20023372000140',
   'Rua Barão de Itapetininga, nº 255, 3º andar, sala 311, República, São Paulo/SP, CEP 01042-917'),
  ('IB', 'Iberia Líneas Aéreas de España Sociedad Anónima Operadora', '13115840000141',
   'Rua Haddock Lobo, nº 337, conjunto 71, Cerqueira César, São Paulo/SP, CEP 01414-901'),
  ('JA', 'JetSMART Airlines SpA', '35185597000170',
   'Avenida Guido Caloi, nº 1000, 4º andar, bloco 5, sala 416, Jardim São Luís, São Paulo/SP, CEP 05802-140'),
  ('LH', 'Deutsche Lufthansa AG', '33461740000184',
   'Rua Gomes de Carvalho, nº 1108, 6º andar, Vila Olímpia, São Paulo/SP, CEP 04547-004'),
  ('TK', 'Turkish Airlines Inc. (Turk Hava Yollari Anonim Ortakligi)', '10576103000158',
   'Alameda Santos, nº 1978, 6º andar, conjunto 62, Cerqueira César, São Paulo/SP, CEP 01418-102'),
  ('UA', 'United Airlines, Inc.', '01526415000166',
   'Avenida Paulista, nº 777, conjuntos 81, 82, 91 e 92, Cerqueira César, São Paulo/SP, CEP 01311-100'),
  ('UX', 'Air Europa Líneas Aéreas Sociedad Anónima', '02204537000107',
   'Avenida Tancredo Neves, nº 620, sala 3303, Caminho das Árvores, Salvador/BA, CEP 41820-020')
) as x (iata, legal_name, cnpj, address)
where a.iata = x.iata;

-- The pieces ONE wrote against these airlines and nobody touched, whose defendant was left to complete: owed ONE's
-- approval again, the marks now filled (as 0245 did once an airline was read from the legs).
select public.rearm_draft_approvals(k.id)
from public.cases k
where k.status not in ('filed', 'closed', 'declined')
  and k.airline_iata in ('QR', 'TP', 'AA', 'AF', 'KL', 'AM', 'AR', 'AV', 'BA', 'CM', 'DL', 'EK', 'ET', 'H2', 'IB', 'JA',
                         'LH', 'TK', 'UA', 'UX')
  and exists (select 1 from public.case_drafts d where d.case_id = k.id and d.status = 'proposed');
