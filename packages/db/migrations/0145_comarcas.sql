-- ============================================================
-- 0145_comarcas: a lawsuit planned at the client's city goes to the comarca
-- that city belongs to.
--
-- The plan of a case (`lawsuitPlan`, `foro-v1`) puts a lawsuit at the
-- passenger's domicile and wrote the city as its comarca. A city with no
-- comarca of its own belongs to another's (Brazabrantes to Goianira, Abadia de
-- Goiás to Guapó): its lawsuit would go to a comarca that does not exist. Which
-- comarca each municipality belongs to is data the court's state publishes
-- (`court_comarcas`, by the IBGE's code of the municipality, the platform's),
-- and a planned lawsuit whose comarca is still the city as written takes the
-- comarca of that city when its court is in the table
-- (`proceedings_comarca`). A comarca a person wrote that is not the city stays
-- theirs. Whether the comarca is one the table knows is said on the lawsuit
-- (`comarca_checked`); where it is not, the case says "comarca não conferida".
--
-- Seeded with Goiás: its 246 municipalities and the 127 comarcas of the
-- compiled Lei estadual nº 16.435/2008, Anexo III (Tabela de Classificação e
-- da Abrangência Territorial das Comarcas), read on 10/11/2026 at the Casa
-- Civil of Goiás, with the changes of later laws as that compilation writes
-- them (what it strikes through left out: Lei nº 16.872/2010, art. 18, and
-- Lei nº 19.938/2017). The law writes four municipalities otherwise than the
-- IBGE (Rilma, Santa Teresa de Goiás, São Miguel do Passo Quatro, Teresópolis
-- de Goiás); the table keeps the IBGE's names. Every row is unconfirmed until
-- the operator checks it against the court's own acts, as `court_systems`.
-- The units of each comarca and their competence are not in it yet.
-- ============================================================

create table public.court_comarcas (
  court text not null references public.courts (acronym) on update cascade,
  ibge_code integer not null,
  municipality text not null,
  -- The municipality as `slugify` writes it, which is how a city written by a person is found.
  municipality_key text not null,
  comarca text not null,
  source_url text not null,
  read_on date not null,
  confirmed boolean not null default false,
  primary key (court, ibge_code),
  constraint court_comarcas_ibge_check check (ibge_code between 1000000 and 9999999),
  constraint court_comarcas_names_check check (
    char_length(municipality) between 2 and 120 and char_length(comarca) between 2 and 120
    and municipality_key = public.slugify(municipality)
  ),
  constraint court_comarcas_source_check check (source_url like 'https://%' and char_length(source_url) <= 500)
);

create unique index court_comarcas_city_idx on public.court_comarcas (court, municipality_key);
create index court_comarcas_comarca_idx on public.court_comarcas (court, (public.slugify(comarca)));

alter table public.court_comarcas enable row level security;
create policy "court_comarcas_select_member" on public.court_comarcas for select to authenticated using (true);
grant select on table public.court_comarcas to authenticated;

insert into public.court_comarcas (court, ibge_code, municipality, municipality_key, comarca, source_url, read_on)
select 'TJGO', v.code, v.municipality, public.slugify(v.municipality), v.comarca,
  'https://legisla.casacivil.go.gov.br/api/v2/pesquisa/legislacoes/87161/pdf', date '2026-11-10'
from (values
  (5200100, 'Abadiânia', 'Abadiânia'),
  (5200134, 'Acreúna', 'Acreúna'),
  (5200308, 'Alexânia', 'Alexânia'),
  (5200605, 'Alto Paraíso de Goiás', 'Alto Paraíso de Goiás'),
  (5220009, 'São João d''Aliança', 'Alto Paraíso de Goiás'),
  (5200803, 'Alvorada do Norte', 'Alvorada do Norte'),
  (5203962, 'Buritinópolis', 'Alvorada do Norte'),
  (5206701, 'Damianópolis', 'Alvorada do Norte'),
  (5212709, 'Mambaí', 'Alvorada do Norte'),
  (5220686, 'Simolândia', 'Alvorada do Norte'),
  (5220702, 'Sítio d''Abadia', 'Alvorada do Norte'),
  (5200159, 'Adelândia', 'Anicuns'),
  (5200852, 'Americano do Brasil', 'Anicuns'),
  (5201306, 'Anicuns', 'Anicuns'),
  (5201108, 'Anápolis', 'Anápolis'),
  (5204854, 'Campo Limpo de Goiás', 'Anápolis'),
  (5215405, 'Ouro Verde de Goiás', 'Anápolis'),
  (5201405, 'Aparecida de Goiânia', 'Aparecida de Goiânia'),
  (5201702, 'Aragarças', 'Aragarças'),
  (5203104, 'Baliza', 'Aragarças'),
  (5203401, 'Bom Jardim de Goiás', 'Aragarças'),
  (5201603, 'Araçu', 'Araçu'),
  (5202809, 'Avelinópolis', 'Araçu'),
  (5205208, 'Caturaí', 'Araçu'),
  (5202502, 'Aruanã', 'Aruanã'),
  (5203807, 'Britânia', 'Aruanã'),
  (5202601, 'Aurilândia', 'Aurilândia'),
  (5204201, 'Cachoeira de Goiás', 'Aurilândia'),
  (5203203, 'Barro Alto', 'Barro Alto'),
  (5203302, 'Bela Vista de Goiás', 'Bela Vista de Goiás'),
  (5203500, 'Bom Jesus de Goiás', 'Bom Jesus de Goiás'),
  (5203906, 'Buriti Alegre', 'Buriti Alegre'),
  (5200209, 'Água Limpa', 'Buriti Alegre'),
  (5204102, 'Cachoeira Alta', 'Cachoeira Alta'),
  (5204250, 'Cachoeira Dourada', 'Cachoeira Dourada'),
  (5209937, 'Inaciolândia', 'Cachoeira Dourada'),
  (5204409, 'Caiapônia', 'Caiapônia'),
  (5207253, 'Doverlândia', 'Caiapônia'),
  (5215652, 'Palestina de Goiás', 'Caiapônia'),
  (5204508, 'Caldas Novas', 'Caldas Novas'),
  (5218789, 'Rio Quente', 'Caldas Novas'),
  (5200555, 'Alto Horizonte', 'Campinorte'),
  (5204706, 'Campinorte', 'Campinorte'),
  (5214879, 'Nova Iguaçu de Goiás', 'Campinorte'),
  (5204904, 'Campos Belos', 'Campos Belos'),
  (5213509, 'Monte Alegre de Goiás', 'Campos Belos'),
  (5205000, 'Carmo do Rio Verde', 'Carmo do Rio Verde'),
  (5220280, 'São Patrício', 'Carmo do Rio Verde'),
  (5205109, 'Catalão', 'Catalão'),
  (5206909, 'Davinópolis', 'Catalão'),
  (5215504, 'Ouvidor', 'Catalão'),
  (5221304, 'Três Ranchos', 'Catalão'),
  (5205307, 'Cavalcante', 'Cavalcante'),
  (5221080, 'Teresina de Goiás', 'Cavalcante'),
  (5201454, 'Aparecida do Rio Doce', 'Caçu'),
  (5204300, 'Caçu', 'Caçu'),
  (5211305, 'Itarumã', 'Caçu'),
  (5205406, 'Ceres', 'Ceres'),
  (5210158, 'Ipiranga de Goiás', 'Ceres'),
  (5214861, 'Nova Glória', 'Ceres'),
  (5205497, 'Cidade Ocidental', 'Cidade Ocidental'),
  (5205513, 'Cocalzinho de Goiás', 'Cocalzinho de Goiás'),
  (5205901, 'Corumbaíba', 'Corumbaíba'),
  (5212907, 'Marzagão', 'Corumbaíba'),
  (5205802, 'Corumbá de Goiás', 'Corumbá de Goiás'),
  (5206206, 'Cristalina', 'Cristalina'),
  (5206404, 'Crixás', 'Crixás'),
  (5221577, 'Uirapuru', 'Crixás'),
  (5206503, 'Cromínia', 'Cromínia'),
  (5212600, 'Mairipotaba', 'Cromínia'),
  (5218391, 'Professor Jamil', 'Cromínia'),
  (5201207, 'Anhanguera', 'Cumari'),
  (5206602, 'Cumari', 'Cumari'),
  (5207352, 'Edealina', 'Edéia'),
  (5207402, 'Edéia', 'Edéia'),
  (5207501, 'Estrela do Norte', 'Estrela do Norte'),
  (5214101, 'Mutunópolis', 'Estrela do Norte'),
  (5219605, 'Santa Tereza de Goiás', 'Estrela do Norte'),
  (5207600, 'Fazenda Nova', 'Fazenda Nova'),
  (5215207, 'Novo Brasil', 'Fazenda Nova'),
  (5207808, 'Firminópolis', 'Firminópolis'),
  (5207907, 'Flores de Goiás', 'Flores de Goiás'),
  (5222203, 'Vila Boa', 'Flores de Goiás'),
  (5204003, 'Cabeceiras', 'Formosa'),
  (5208004, 'Formosa', 'Formosa'),
  (5208103, 'Formoso', 'Formoso'),
  (5213772, 'Montividiu do Norte', 'Formoso'),
  (5221452, 'Trombas', 'Formoso'),
  (5208509, 'Goiandira', 'Goiandira'),
  (5214804, 'Nova Aurora', 'Goiandira'),
  (5203609, 'Brazabrantes', 'Goianira'),
  (5208806, 'Goianira', 'Goianira'),
  (5219738, 'Santo Antônio de Goiás', 'Goianira'),
  (5208400, 'Goianápolis', 'Goianápolis'),
  (5221197, 'Terezópolis de Goiás', 'Goianápolis'),
  (5208608, 'Goianésia', 'Goianésia'),
  (5219456, 'Santa Rita do Novo Destino', 'Goianésia'),
  (5222302, 'Vila Propício', 'Goianésia'),
  (5209101, 'Goiatuba', 'Goiatuba'),
  (5207535, 'Faina', 'Goiás'),
  (5208905, 'Goiás', 'Goiás'),
  (5208707, 'Goiânia', 'Goiânia'),
  (5200050, 'Abadia de Goiás', 'Guapó'),
  (5201801, 'Aragoiânia', 'Guapó'),
  (5209200, 'Guapó', 'Guapó'),
  (5209705, 'Hidrolândia', 'Hidrolândia'),
  (5209903, 'Iaciara', 'Iaciara'),
  (5214903, 'Nova Roma', 'Iaciara'),
  (5206800, 'Damolândia', 'Inhumas'),
  (5210000, 'Inhumas', 'Inhumas'),
  (5204805, 'Campo Alegre de Goiás', 'Ipameri'),
  (5210109, 'Ipameri', 'Ipameri'),
  (5200902, 'Amorinópolis', 'Iporá'),
  (5207105, 'Diorama', 'Iporá'),
  (5210208, 'Iporá', 'Iporá'),
  (5210307, 'Israelândia', 'Israelândia'),
  (5212006, 'Jaupaci', 'Israelândia'),
  (5210406, 'Itaberaí', 'Itaberaí'),
  (5209606, 'Heitoraí', 'Itaguaru'),
  (5210604, 'Itaguaru', 'Itaguaru'),
  (5201504, 'Aporé', 'Itajá'),
  (5210802, 'Itajá', 'Itajá'),
  (5212253, 'Lagoa Santa', 'Itajá'),
  (5209457, 'Guarinos', 'Itapaci'),
  (5209804, 'Hidrolina', 'Itapaci'),
  (5210901, 'Itapaci', 'Itapaci'),
  (5216908, 'Pilar de Goiás', 'Itapaci'),
  (5211008, 'Itapirapuã', 'Itapirapuã'),
  (5212956, 'Matrinchã', 'Itapirapuã'),
  (5209291, 'Guaraíta', 'Itapuranga'),
  (5211206, 'Itapuranga', 'Itapuranga'),
  (5211404, 'Itauçu', 'Itauçu'),
  (5211503, 'Itumbiara', 'Itumbiara'),
  (5211602, 'Ivolândia', 'Ivolândia'),
  (5213400, 'Moiporá', 'Ivolândia'),
  (5209952, 'Indiara', 'Jandaia'),
  (5211701, 'Jandaia', 'Jandaia'),
  (5211800, 'Jaraguá', 'Jaraguá'),
  (5212055, 'Jesúpolis', 'Jaraguá'),
  (5219902, 'São Francisco de Goiás', 'Jaraguá'),
  (5211909, 'Jataí', 'Jataí'),
  (5216452, 'Perolândia', 'Jataí'),
  (5200506, 'Aloândia', 'Joviânia'),
  (5212105, 'Joviânia', 'Joviânia'),
  (5212204, 'Jussara', 'Jussara'),
  (5219258, 'Santa Fé de Goiás', 'Jussara'),
  (5203559, 'Bonfinópolis', 'Leopoldo de Bulhões'),
  (5212303, 'Leopoldo de Bulhões', 'Leopoldo de Bulhões'),
  (5212501, 'Luziânia', 'Luziânia'),
  (5200829, 'Amaralina', 'Mara Rosa'),
  (5212808, 'Mara Rosa', 'Mara Rosa'),
  (5205059, 'Castelândia', 'Maurilândia'),
  (5213004, 'Maurilândia', 'Maurilândia'),
  (5218052, 'Porteirão', 'Maurilândia'),
  (5221551, 'Turvelândia', 'Maurilândia'),
  (5204656, 'Campinaçu', 'Minaçu'),
  (5213087, 'Minaçu', 'Minaçu'),
  (5213103, 'Mineiros', 'Mineiros'),
  (5218102, 'Portelândia', 'Mineiros'),
  (5219407, 'Santa Rita do Araguaia', 'Mineiros'),
  (5213707, 'Montes Claros de Goiás', 'Montes Claros de Goiás'),
  (5213756, 'Montividiu', 'Montividiu'),
  (5213806, 'Morrinhos', 'Morrinhos'),
  (5213905, 'Mossâmedes', 'Mossâmedes'),
  (5202155, 'Araguapaz', 'Mozarlândia'),
  (5214002, 'Mozarlândia', 'Mozarlândia'),
  (5214408, 'Nazário', 'Nazário'),
  (5219100, 'Santa Bárbara de Goiás', 'Nazário'),
  (5214507, 'Nerópolis', 'Nerópolis'),
  (5215009, 'Nova Veneza', 'Nerópolis'),
  (5205521, 'Colinas do Sul', 'Niquelândia'),
  (5214606, 'Niquelândia', 'Niquelândia'),
  (5214051, 'Mundo Novo', 'Nova Crixás'),
  (5214838, 'Nova Crixás', 'Nova Crixás'),
  (5215231, 'Novo Gama', 'Novo Gama'),
  (5215306, 'Orizona', 'Orizona'),
  (5213053, 'Mimoso de Goiás', 'Padre Bernardo'),
  (5215603, 'Padre Bernardo', 'Padre Bernardo'),
  (5205455, 'Cezarina', 'Palmeiras de Goiás'),
  (5215702, 'Palmeiras de Goiás', 'Palmeiras de Goiás'),
  (5216007, 'Panamá', 'Panamá'),
  (5216304, 'Paranaiguara', 'Paranaiguara'),
  (5216403, 'Paraúna', 'Paraúna'),
  (5220058, 'São João da Paraúna', 'Paraúna'),
  (5216809, 'Petrolina de Goiás', 'Petrolina de Goiás'),
  (5217104, 'Piracanjuba', 'Piracanjuba'),
  (5202353, 'Arenópolis', 'Piranhas'),
  (5217203, 'Piranhas', 'Piranhas'),
  (5217302, 'Pirenópolis', 'Pirenópolis'),
  (5217401, 'Pires do Rio', 'Pires do Rio'),
  (5217609, 'Planaltina', 'Planaltina'),
  (5200175, 'Água Fria de Goiás', 'Planaltina'),
  (5217708, 'Pontalina', 'Pontalina'),
  (5222054, 'Vicentinópolis', 'Pontalina'),
  (5215256, 'Novo Planalto', 'Porangatu'),
  (5218003, 'Porangatu', 'Porangatu'),
  (5209408, 'Guarani de Goiás', 'Posse'),
  (5218300, 'Posse', 'Posse'),
  (5209150, 'Gouvelândia', 'Quirinópolis'),
  (5218508, 'Quirinópolis', 'Quirinópolis'),
  (5218607, 'Rialma', 'Rialma'),
  (5218706, 'Rianápolis', 'Rialma'),
  (5219357, 'Santa Isabel', 'Rialma'),
  (5218805, 'Rio Verde', 'Rio Verde'),
  (5219712, 'Santo Antônio da Barra', 'Rio Verde'),
  (5213855, 'Morro Agudo de Goiás', 'Rubiataba'),
  (5214705, 'Nova América', 'Rubiataba'),
  (5218904, 'Rubiataba', 'Rubiataba'),
  (5203939, 'Buriti de Goiás', 'Sanclerlândia'),
  (5205703, 'Córrego do Ouro', 'Sanclerlândia'),
  (5219001, 'Sanclerlândia', 'Sanclerlândia'),
  (5206305, 'Cristianópolis', 'Santa Cruz de Goiás'),
  (5215801, 'Palmelo', 'Santa Cruz de Goiás'),
  (5219209, 'Santa Cruz de Goiás', 'Santa Cruz de Goiás'),
  (5219308, 'Santa Helena de Goiás', 'Santa Helena de Goiás'),
  (5204953, 'Campos Verdes', 'Santa Terezinha de Goiás'),
  (5219704, 'Santa Terezinha de Goiás', 'Santa Terezinha de Goiás'),
  (5219753, 'Santo Antônio do Descoberto', 'Santo Antônio do Descoberto'),
  (5204557, 'Caldazinha', 'Senador Canedo'),
  (5220454, 'Senador Canedo', 'Senador Canedo'),
  (5205471, 'Chapadão do Céu', 'Serranópolis'),
  (5220504, 'Serranópolis', 'Serranópolis'),
  (5208152, 'Gameleira de Goiás', 'Silvânia'),
  (5220603, 'Silvânia', 'Silvânia'),
  (5208301, 'Divinópolis de Goiás', 'São Domingos'),
  (5219803, 'São Domingos', 'São Domingos'),
  (5220108, 'São Luís de Montes Belos', 'São Luís de Montes Belos'),
  (5203575, 'Bonópolis', 'São Miguel do Araguaia'),
  (5220207, 'São Miguel do Araguaia', 'São Miguel do Araguaia'),
  (5220405, 'São Simão', 'São Simão'),
  (5210562, 'Itaguari', 'Taquaral de Goiás'),
  (5219506, 'Santa Rosa de Goiás', 'Taquaral de Goiás'),
  (5221007, 'Taquaral de Goiás', 'Taquaral de Goiás'),
  (5204607, 'Campestre de Goiás', 'Trindade'),
  (5221403, 'Trindade', 'Trindade'),
  (5215900, 'Palminópolis', 'Turvânia'),
  (5221502, 'Turvânia', 'Turvânia'),
  (5221700, 'Uruana', 'Uruana'),
  (5220157, 'São Luiz do Norte', 'Uruaçu'),
  (5221601, 'Uruaçu', 'Uruaçu'),
  (5221809, 'Urutaí', 'Urutaí'),
  (5221858, 'Valparaíso de Goiás', 'Valparaíso de Goiás'),
  (5221908, 'Varjão', 'Varjão'),
  (5220264, 'São Miguel do Passa Quatro', 'Vianópolis'),
  (5222005, 'Vianópolis', 'Vianópolis'),
  (5200258, 'Águas Lindas de Goiás', 'Águas Lindas de Goiás')
) as v (code, municipality, comarca);

/** The comarca a city belongs to in a court's table, or null when the table does not know the city. */
create or replace function public.comarca_of(target_court text, target_city text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.comarca from public.court_comarcas c
  where c.court = target_court and c.municipality_key = public.slugify(btrim(coalesce(target_city, '')));
$$;

revoke all on function public.comarca_of(text, text) from public, anon;
grant execute on function public.comarca_of(text, text) to authenticated, service_role;

-- Whether a lawsuit's comarca is one the court's table knows.
alter table public.proceedings add column comarca_checked boolean not null default false;

/**
 * A planned lawsuit whose comarca is the city as written (or none) takes the
 * comarca that city belongs to, when its court is in the table; and every
 * lawsuit says whether its comarca is one the table knows. A lawsuit the court
 * has keeps the comarca it was recorded with.
 */
create or replace function public.proceedings_comarca()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  city text := nullif(btrim(coalesce(new.forum_city, new.comarca, '')), '');
  mapped text;
begin
  if new.status = 'planned' and new.court is not null and city is not null then
    mapped := public.comarca_of(new.court, city);
    if mapped is not null
       and (new.comarca is null or btrim(new.comarca) = '' or public.slugify(new.comarca) = public.slugify(city)) then
      new.comarca := mapped;
    end if;
  end if;
  new.comarca_checked := new.court is not null and nullif(btrim(coalesce(new.comarca, '')), '') is not null
    and exists (
      select 1 from public.court_comarcas c
      where c.court = new.court and public.slugify(c.comarca) = public.slugify(new.comarca)
    );
  return new;
end;
$$;

revoke all on function public.proceedings_comarca() from public, anon, authenticated;

create trigger proceedings_comarca before insert or update of comarca, forum_city, court, status
  on public.proceedings for each row execute function public.proceedings_comarca();

-- The lawsuits there are: the planned ones take their comarca, and every one says whether it is known.
update public.proceedings set comarca = comarca where status = 'planned';
update public.proceedings p set comarca_checked = exists (
  select 1 from public.court_comarcas c
  where c.court = p.court and public.slugify(c.comarca) = public.slugify(p.comarca)
) where p.status <> 'planned' and p.comarca is not null and p.court is not null;
