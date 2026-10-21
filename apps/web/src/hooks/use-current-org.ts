"use client";

import { useCallback, useEffect, useState } from "react";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

/**
 * The signed-in professional's workspace. One workspace per professional in the
 * MVP (root CLAUDE.md), so the first membership IS the workspace; multi-clinic
 * selection is post-MVP and would replace this hook, not extend its callers.
 */
export function useCurrentOrg() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      if (!isSupabaseConfigured) {
        setLoading(false);
        return;
      }
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) {
        setOrgId(null);
        setError(true);
        setLoading(false);
        return;
      }
      if (!user) {
        setOrgId(null);
        setLoading(false);
        return;
      }
      // One person, one workspace: the oldest membership is THE workspace.
      // The timezone belongs to the person (profiles.timezone).
      const [{ data, error: membershipError }, { data: profile }] = await Promise.all([
        supabase
          .from("memberships")
          .select("org_id")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
      ]);
      if (membershipError) {
        setOrgId(null);
        setError(true);
        setLoading(false);
        return;
      }
      setOrgId(data?.org_id ?? null);
      setTimezone((profile?.timezone as string | undefined) || "America/Sao_Paulo");
      setLoading(false);
    } catch {
      setOrgId(null);
      setError(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleOrganizationUpdated = () => {
      void load();
    };
    void load();
    window.addEventListener("one:organization-updated", handleOrganizationUpdated);
    return () => window.removeEventListener("one:organization-updated", handleOrganizationUpdated);
  }, [load]);

  return { orgId, timezone, loading, error, reload: load };
}
