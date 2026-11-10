"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, FormControl, FormLabel, Input, Switch, Tooltip, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import { Field, SelectField } from "@/app/(dashboard)/admin/billing/components/catalog-shared";
import { slugify } from "@/app/(dashboard)/admin/help/components/help-categories-admin";
import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import StatusChip from "@/components/product/status-chip";
import { LOCALES } from "@/constants";
import IllustrationDocumentation from "@/icons/illustrations/illustration-documentation";
import NiPen from "@/icons/nexture/ni-pen";
import { formatDate } from "@/lib/admin/format";
import { labelOf, LOCALE_LABEL } from "@/lib/admin/labels";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

/** `blog_posts.kind` (migration 0007): a blog post, or a news item that also feeds the members' /novidades. */
const KIND_LABEL: Record<string, string> = { post: "post do blog", news: "novidade" };
/** `blog_posts.audience`: the public site, or only signed-in members. */
const AUDIENCE_LABEL: Record<string, string> = { public: "site público", members: "só integrantes" };

type PostRow = {
  id: string;
  locale: string;
  kind: string;
  audience: string;
  translationGroup: string;
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMd: string;
  coverUrl: string | null;
  authorName: string | null;
  tags: string[];
  isPublished: boolean;
  publishedAt: string | null;
};

type FormState = {
  id: string | null;
  locale: string;
  kind: string;
  audience: string;
  /** The post in the other language this one translates, or "" for none. */
  translationOf: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyMd: string;
  coverUrl: string;
  authorName: string;
  tags: string;
  isPublished: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  locale: "pt-BR",
  kind: "post",
  audience: "public",
  translationOf: "",
  slug: "",
  title: "",
  excerpt: "",
  bodyMd: "",
  coverUrl: "",
  authorName: "",
  tags: "",
  isPublished: false,
};

/**
 * Blog posts and member news: Markdown per language, published with a switch.
 * A post is the public blog (/blog); a news item also feeds the members'
 * /novidades, and "só integrantes" keeps it off the public site. Two posts in
 * different languages are linked as translations, which is what the language
 * switch and the hreflang of the public site follow.
 */
export default function BlogPostsAdmin() {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("blog_posts")
      .select(
        "id, locale, kind, audience, translation_group, slug, title, excerpt, body_md, cover_url, author_name, tags, is_published, published_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        locale: row.locale,
        kind: row.kind,
        audience: row.audience,
        translationGroup: row.translation_group,
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        bodyMd: row.body_md,
        coverUrl: row.cover_url,
        authorName: row.author_name,
        tags: row.tags ?? [],
        isPublished: row.is_published,
        publishedAt: row.published_at,
      })),
    );
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    if (!form || !form.title.trim()) return;
    setError(null);
    const supabase = createClient();
    // Linking takes the other post's group; unlinking a post that had a
    // partner starts a group of its own; otherwise the group is left alone.
    const partner = rows.find((row) => row.id === form.translationOf);
    const current = rows.find((row) => row.id === form.id);
    const currentPartner = current
      ? rows.find((row) => row.translationGroup === current.translationGroup && row.id !== current.id)
      : undefined;
    const translationGroup = partner
      ? partner.translationGroup
      : form.id && currentPartner && !form.translationOf
        ? crypto.randomUUID()
        : undefined;
    const payload = {
      locale: form.locale,
      kind: form.kind,
      audience: form.audience,
      ...(translationGroup ? { translation_group: translationGroup } : {}),
      slug: form.slug.trim() || slugify(form.title),
      title: form.title.trim(),
      excerpt: form.excerpt.trim() || null,
      body_md: form.bodyMd,
      cover_url: form.coverUrl.trim() || null,
      author_name: form.authorName.trim() || null,
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      is_published: form.isPublished,
    };
    const query = form.id
      ? supabase.from("blog_posts").update(payload).eq("id", form.id)
      : supabase.from("blog_posts").insert(payload);
    const { error: writeError } = await query;
    if (writeError) {
      setError(
        writeError.code === "23505"
          ? "Já existe um post com esse slug neste idioma, ou o post escolhido como tradução já tem uma tradução neste idioma."
          : writeError.message,
      );
      return;
    }
    recordAudit(supabase, form.id ? "admin.blog.post.updated" : "admin.blog.post.created", {
      entityType: "blog_post",
      entityId: form.id ?? undefined,
      metadata: { title: payload.title, locale: payload.locale },
    });
    setForm(null);
    refresh();
  };

  const remove = async (id: string) => {
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("blog_posts").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    recordAudit(supabase, "admin.blog.post.deleted", { entityType: "blog_post", entityId: id });
    setForm(null);
    refresh();
  };

  const togglePublished = useCallback(
    async (row: PostRow) => {
      setError(null);
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("blog_posts")
        .update({ is_published: !row.isPublished })
        .eq("id", row.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      recordAudit(supabase, row.isPublished ? "admin.blog.post.unpublished" : "admin.blog.post.published", {
        entityType: "blog_post",
        entityId: row.id,
        metadata: { title: row.title },
      });
      refresh();
    },
    [refresh],
  );

  const openEdit = useCallback(
    (row: PostRow) => {
      const partner = rows.find((entry) => entry.translationGroup === row.translationGroup && entry.id !== row.id);
      setForm({
        id: row.id,
        locale: row.locale,
        kind: row.kind,
        audience: row.audience,
        translationOf: partner?.id ?? "",
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt ?? "",
        bodyMd: row.bodyMd,
        coverUrl: row.coverUrl ?? "",
        authorName: row.authorName ?? "",
        tags: row.tags.join(", "),
        isPublished: row.isPublished,
      });
    },
    [rows],
  );

  const columns = useMemo<GridColDef<PostRow>[]>(
    () => [
      {
        field: "title",
        headerName: "Título",
        flex: 2,
        minWidth: 220,
        renderCell: (params: GridRenderCellParams<PostRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.value}
            </Typography>
          </Box>
        ),
      },
      {
        // The old row let the operator filter by slug — keep the slug the
        // cell's VALUE so the quick filter still reaches it.
        field: "slug",
        headerName: "Caminho",
        flex: 1.5,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<PostRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              /blog/{params.value}
            </Typography>
          </Box>
        ),
      },
      {
        field: "locale",
        headerName: "Idioma",
        minWidth: 110,
        valueGetter: (_, row) => labelOf(LOCALE_LABEL, row.locale),
      },
      {
        field: "kind",
        headerName: "Tipo",
        minWidth: 170,
        valueGetter: (_, row) => `${labelOf(KIND_LABEL, row.kind)} · ${labelOf(AUDIENCE_LABEL, row.audience)}`,
      },
      {
        field: "authorName",
        headerName: "Autor",
        minWidth: 150,
        valueGetter: (_, row) => row.authorName ?? "—",
      },
      {
        field: "publishedAt",
        headerName: "Publicado em",
        minWidth: 150,
        valueGetter: (_, row) => formatDate(row.publishedAt),
      },
      {
        field: "status",
        headerName: "Situação",
        minWidth: 120,
        valueGetter: (_, row) => (row.isPublished ? "publicado" : "rascunho"),
        renderCell: (params: GridRenderCellParams<PostRow, string>) => (
          <Box className="flex h-full items-center">
            <StatusChip label={params.value ?? ""} tone={params.row.isPublished ? "positive" : "neutral"} />
          </Box>
        ),
      },
      {
        // Publish/unpublish is a kill switch: it stays visible on the row,
        // never buried in the kebab.
        field: "isPublished",
        headerName: "Publicado",
        minWidth: 110,
        type: "boolean",
        renderCell: (params: GridRenderCellParams<PostRow, boolean>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.row.isPublished ? "Despublicar" : "Publicar"}>
              <Switch
                checked={params.row.isPublished}
                onChange={() => togglePublished(params.row)}
                size="small"
                slotProps={{
                  input: { "aria-label": params.row.isPublished ? "Despublicar post" : "Publicar post" },
                }}
              />
            </Tooltip>
          </Box>
        ),
      },
      {
        field: "actions",
        headerName: "",
        type: "actions",
        minWidth: 70,
        align: "right",
        headerAlign: "right",
        getActions: (params) => [
          <GridActionsCellItem
            key="edit"
            icon={<NiPen size="medium" />}
            label="Editar"
            onClick={() => openEdit(params.row)}
            showInMenu
          />,
        ],
      },
    ],
    [openEdit, togglePublished],
  );

  return (
    <Box className="flex flex-col gap-3">
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {form && (
        <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
          <Box className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SelectField
              label="Idioma"
              value={form.locale}
              options={LOCALES.map((locale) => ({ value: locale, label: labelOf(LOCALE_LABEL, locale) }))}
              onChange={(value) => setForm({ ...form, locale: value, translationOf: "" })}
            />
            <SelectField
              label="Tipo"
              value={form.kind}
              options={[
                { value: "post", label: "Post do blog" },
                { value: "news", label: "Novidade (também em /novidades no painel)" },
              ]}
              onChange={(value) => setForm({ ...form, kind: value })}
            />
            <SelectField
              label="Quem vê"
              value={form.audience}
              options={[
                { value: "public", label: "Site público e integrantes" },
                { value: "members", label: "Só integrantes (fora do site público)" },
              ]}
              onChange={(value) => setForm({ ...form, audience: value })}
            />
          </Box>
          <Box className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SelectField
              label="Tradução de"
              value={form.translationOf}
              options={[
                { value: "", label: "Nenhum post (sem tradução ligada)" },
                ...rows
                  .filter((row) => row.locale !== form.locale && row.id !== form.id)
                  .map((row) => ({ value: row.id, label: `${row.title} (${labelOf(LOCALE_LABEL, row.locale)})` })),
              ]}
              onChange={(value) => setForm({ ...form, translationOf: value })}
            />
            <Field
              label="Slug (vazio = a partir do título)"
              value={form.slug}
              onChange={(value) => setForm({ ...form, slug: value })}
            />
            <Field
              label="Autor (opcional)"
              value={form.authorName}
              onChange={(value) => setForm({ ...form, authorName: value })}
            />
          </Box>
          <Field label="Título" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
          <Field
            label="Resumo (aparece na lista do blog)"
            value={form.excerpt}
            onChange={(value) => setForm({ ...form, excerpt: value })}
          />
          <FormControl className="outlined" variant="standard" size="small" fullWidth>
            <FormLabel component="label">Conteúdo (Markdown)</FormLabel>
            <Input
              multiline
              minRows={12}
              value={form.bodyMd}
              onChange={(e) => setForm({ ...form, bodyMd: e.target.value })}
              className="font-mono"
            />
          </FormControl>
          <Box className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="URL da imagem de capa (opcional)"
              value={form.coverUrl}
              onChange={(value) => setForm({ ...form, coverUrl: value })}
            />
            <Field
              label="Tags (separadas por vírgula)"
              value={form.tags}
              onChange={(value) => setForm({ ...form, tags: value })}
            />
          </Box>
          <Box className="flex flex-row items-center gap-2">
            <Switch
              checked={form.isPublished}
              onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
              size="small"
            />
            <Typography variant="body2">Publicado</Typography>
          </Box>
          <Box className="flex flex-row gap-2">
            <Button variant="contained" size="small" onClick={save} disabled={!form.title.trim()}>
              {form.id ? "Salvar alterações" : "Criar post"}
            </Button>
            <Button variant="text" color="grey" size="small" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            {form.id && (
              <Button variant="text" color="error" size="small" onClick={() => remove(form.id!)}>
                Excluir post (e os comentários)
              </Button>
            )}
          </Box>
        </Box>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<PostRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          actions={
            form ? undefined : (
              <Button variant="outlined" size="small" onClick={() => setForm(EMPTY_FORM)}>
                Novo post
              </Button>
            )
          }
          noRowsOverlay={
            form ? (
              <Typography variant="body2" className="text-text-secondary">
                Nenhum post ainda.
              </Typography>
            ) : (
              <EmptyState
                layout="row"
                illustration={<IllustrationDocumentation />}
                title="Nenhum post ainda"
                description="Os posts aparecem no blog público. As novidades também aparecem para os integrantes em /novidades, junto com as versões novas das ferramentas."
                action={{ label: "Novo post", onClick: () => setForm(EMPTY_FORM) }}
                className="border-none"
              />
            )
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhum post corresponde à busca.
            </Typography>
          }
          pageSize={20}
          pageSizeOptions={[10, 20, 50]}
        />
      )}
    </Box>
  );
}
