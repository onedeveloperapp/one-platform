-- ============================================================
-- 0222 · Os casos em curso seguem o recurso que pede a justiça gratuita.
--
-- 0218 published, for each module, a new version whose recurso asks free
-- justice for who asks in the recurso of the small-claims court (Lei
-- 9.099/1995, art. 54, parágrafo único; CPC, art. 99, § 7º). A case reads
-- the version it was opened under (0212), and the cases that appeal are the
-- ones already with the court, opened under the version before: their
-- recurso would still be written from the model with no request, waiting
-- for a lawyer to put its mark by hand.
--
-- A recurso that cannot ask free justice is a defect of that version, and a
-- version withdrawn for a defect sends its cases to the latest published
-- (0212, the owner's decision of 2026-11-11). Withdrawn here, with the
-- reason, only a published version that differs from the latest published
-- of its module in the recurso alone: no case changes the documents it asks
-- nor the version of its AI tasks. The latest published version is never
-- withdrawn. Pointed out by the session that built 0212; it was meant for
-- 0218, which the development project had applied by then.
-- ============================================================

update public.module_versions o
set status = 'withdrawn', withdrawn_at = now(),
    withdraw_reason = 'O recurso não pedia a justiça gratuita de quem pede no recurso do juizado: os casos desta versão seguem a versão seguinte, que muda só o modelo do recurso.'
from public.module_versions n
where o.module = n.module and o.status = 'published' and n.status = 'published'
  and n.version = (select max(x.version) from public.module_versions x where x.module = o.module)
  and o.id <> n.id
  and strpos(coalesce(n.manifest #>> '{pieces,kinds,recurso,model}', ''), '[[GRATUIDADE]]') > 0
  and strpos(coalesce(o.manifest #>> '{pieces,kinds,recurso,model}', ''), '[[GRATUIDADE]]') = 0
  and jsonb_set(o.manifest, '{pieces,kinds,recurso,model}', n.manifest #> '{pieces,kinds,recurso,model}') = n.manifest;
