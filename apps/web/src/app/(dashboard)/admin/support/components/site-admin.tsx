"use client";

import { useEffect, useState } from "react";

import { Alert, Button, FormControlLabel, Radio, RadioGroup, TextField, Typography } from "@mui/material";

import { CnpjField } from "@/components/product/fields";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";
import { isValidCnpj, onlyDigits } from "@flyee/fields";

type Stage = "waitlist" | "open";

/**
 * What the public site offers (platform_settings `launch`, migration 0019).
 * "Lista de espera" points every primary button of the site at /espera;
 * "Aberto" points them at sign-up and checkout. Public value, read by the
 * anonymous site on every request.
 */
export function LaunchAdmin() {
  const [stage, setStage] = useState<Stage>("waitlist");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data, error: readError } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "launch")
        .maybeSingle();
      if (readError) setError(readError.message);
      setStage((data?.value as { stage?: string } | null)?.stage === "open" ? "open" : "waitlist");
      setLoading(false);
    };
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    const supabase = createClient();
    const { error: writeError } = await supabase
      .from("platform_settings")
      .upsert({ key: "launch", value: { stage }, is_public: true });
    if (writeError) {
      setError(writeError.message);
      setSaving(false);
      return;
    }
    recordAudit(supabase, "admin.launch.updated", {
      entityType: "platform_settings",
      entityId: "launch",
      metadata: { stage },
    });
    setSaving(false);
    setSaved(true);
  };

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Typography variant="h6" component="h2">
        Lançamento do site
      </Typography>
      <Typography variant="body1" className="text-text-secondary">
        Para onde levam os botões principais do site público. Login e cadastro continuam acessíveis nos dois estados.
      </Typography>
      <RadioGroup
        value={stage}
        onChange={(event) => {
          setStage(event.target.value === "open" ? "open" : "waitlist");
          setSaved(false);
        }}
      >
        <FormControlLabel
          value="waitlist"
          disabled={loading}
          control={<Radio />}
          label="Lista de espera: os botões levam para /espera (nada está à venda ainda)"
        />
        <FormControlLabel
          value="open"
          disabled={loading}
          control={<Radio />}
          label="Aberto: os botões levam para o cadastro e o checkout"
        />
      </RadioGroup>
      {stage === "open" && (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          Antes de abrir, confira: checkout do kit testado, empresa preenchida abaixo (os termos citam o rodapé) e
          planos públicos com os preços certos em /admin/billing.
        </Alert>
      )}
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          Estado salvo. O site público muda no próximo carregamento de página.
        </Alert>
      )}
      <div>
        <Button variant="contained" color="primary" onClick={save} disabled={loading || saving}>
          {saving ? "Salvando…" : "Salvar estado"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The company that operates ONE (platform_settings `legal_entity`,
 * migration 0019), printed in the footer of every public page. The terms and
 * the privacy policy identify the operator "in the site footer", so this must
 * be filled in before the site opens. Public value.
 */
export function LegalEntityAdmin() {
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const { data, error: readError } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "legal_entity")
        .maybeSingle();
      if (readError) setError(readError.message);
      const value = (data?.value ?? {}) as { name?: string; document?: string; city?: string };
      setName(value.name ?? "");
      setDocument(value.document ?? "");
      setCity(value.city ?? "");
      setLoading(false);
    };
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    const cleanName = name.trim();
    const digits = onlyDigits(document);
    const cleanCity = city.trim();
    if (digits && !isValidCnpj(digits)) {
      setError("Informe um CNPJ válido, ou deixe o campo em branco.");
      setSaving(false);
      return;
    }
    if (!cleanName && (digits || cleanCity)) {
      setError("A razão social é o que aparece primeiro no rodapé: preencha-a junto com o CNPJ e a cidade.");
      setSaving(false);
      return;
    }
    const supabase = createClient();
    const value = cleanName ? { name: cleanName, document: digits, city: cleanCity } : {};
    const { error: writeError } = await supabase
      .from("platform_settings")
      .upsert({ key: "legal_entity", value, is_public: true });
    if (writeError) {
      setError(writeError.message);
      setSaving(false);
      return;
    }
    recordAudit(supabase, "admin.legal_entity.updated", {
      entityType: "platform_settings",
      entityId: "legal_entity",
      metadata: { name: Boolean(cleanName), document: Boolean(digits), city: Boolean(cleanCity) },
    });
    setSaving(false);
    setSaved(true);
  };

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Typography variant="h6" component="h2">
        Empresa responsável
      </Typography>
      <Typography variant="body1" className="text-text-secondary">
        Aparece no rodapé de todas as páginas públicas. Os termos de uso e a política de privacidade identificam a
        operadora pelo rodapé, então preencha antes de abrir o site. Esses valores são públicos.
      </Typography>
      <TextField
        label="Razão social"
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={loading}
        fullWidth
      />
      <CnpjField
        label="CNPJ"
        value={document}
        onChange={(event) => setDocument((event.target as HTMLInputElement).value)}
        invalidMessage="CNPJ inválido."
        disabled={loading}
        fullWidth
      />
      <TextField
        label="Cidade e UF"
        placeholder="São Paulo, SP"
        value={city}
        onChange={(event) => setCity(event.target.value)}
        disabled={loading}
        fullWidth
      />
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          Empresa salva. O rodapé atualiza no próximo carregamento de página.
        </Alert>
      )}
      <div>
        <Button variant="contained" color="primary" onClick={save} disabled={loading || saving}>
          {saving ? "Salvando…" : "Salvar empresa"}
        </Button>
      </div>
    </div>
  );
}
