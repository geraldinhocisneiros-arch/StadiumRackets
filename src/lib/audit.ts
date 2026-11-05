import { supabase } from "@/integrations/supabase/client";

export type AuditAction = "create" | "update" | "delete";

interface LogParams {
  entity: string;
  entity_id?: string | null;
  action: AuditAction;
  details?: Record<string, unknown>;
}

export async function logAction(params: LogParams) {
  try {
    await supabase.rpc("log_audit_event", {
      _entity: params.entity,
      _entity_id: (params.entity_id ?? null) as unknown as string,
      _action: params.action,
      _details: (params.details ?? {}) as never,
    });
  } catch (e) {
    // Não bloqueia o fluxo se a auditoria falhar
    console.error("audit log failed", e);
  }
}
