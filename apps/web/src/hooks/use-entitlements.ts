"use client";

import { useCallback, useEffect, useState } from "react";

import { type Entitlements, type RpcEntitlements, toEntitlements } from "@/lib/entitlements";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

export type { EntitlementSource, Entitlements } from "@/lib/entitlements";

export function useEntitlements(orgId: string | null) {
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!orgId || !isSupabaseConfigured) {
      setEntitlements(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("org_entitlements", { target_org: orgId });
      if (rpcError) throw rpcError;
      setEntitlements(toEntitlements((data ?? {}) as RpcEntitlements));
    } catch {
      setEntitlements(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { entitlements, loading, error, reload: load };
}
