import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { supabase: any; userId: string };

/**
 * Cadastros pendentes de professor feitos pelo próprio interessado
 * no portal público (/professor) — ver src/lib/portal-signup.functions.ts.
 * A conta e o papel já existem no momento do autocadastro; o que fica
 * pendente é a REVISÃO da recepção/diretoria pra:
 *   - vincular a um cadastro já existente (evita duplicar professor/cliente), ou
 *   - aprovar como cadastro novo, ou
 *   - rejeitar (apaga a conta criada).
 */

async function requireStaff(context: Ctx) {
  const { data: roles } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
  if (!set.has("admin") && !set.has("diretoria") && !set.has("recepcionista")) {
    throw new Error("Sem permissão");
  }
}

async function requireAdmin(context: Ctx) {
  const { data: roles } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
  if (!set.has("admin")) {
    throw new Error("Apenas administradores podem rejeitar/apagar um cadastro");
  }
}

export interface PendingSignupRow {
  user_id: string;
  kind: "professor";
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  // Vínculo criado automaticamente no momento do autocadastro (registro novo
  // em `teachers`).
  autoLinkedId: string | null;
  autoLinkedName: string | null;
}

export const listPendingSignups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireStaff(context);

    const { data: pending, error } = await context.supabase
      .from("pending_signups")
      .select("user_id, kind, full_name, email, phone, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (pending ?? []) as {
      user_id: string;
      kind: "professor";
      full_name: string | null;
      email: string | null;
      phone: string | null;
      created_at: string;
    }[];
    if (rows.length === 0) return [] as PendingSignupRow[];

    const userIds = rows.map((r) => r.user_id);
    const [teachersRes, portalRes] = await Promise.all([
      context.supabase.from("teachers").select("id, name, user_id").in("user_id", userIds),
      context.supabase
        .from("client_portal_users")
        .select("user_id, client_id, clients(full_name)")
        .in("user_id", userIds),
    ]);
    const teacherByUser = new Map<string, { id: string; name: string }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (teachersRes.data ?? []).forEach((t: any) =>
      teacherByUser.set(t.user_id, { id: t.id, name: t.name }),
    );
    const clientByUser = new Map<string, { id: string; name: string }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (portalRes.data ?? []).forEach((p: any) =>
      clientByUser.set(p.user_id, { id: p.client_id, name: p.clients?.full_name ?? "—" }),
    );

    return rows.map((r) => {
      const link =
        r.kind === "professor" ? teacherByUser.get(r.user_id) : clientByUser.get(r.user_id);
      return {
        ...r,
        autoLinkedId: link?.id ?? null,
        autoLinkedName: link?.name ?? null,
      };
    });
  });

/** Aprova como está (mantém o professor/cliente criado no autocadastro). */
export const approvePendingSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("userId obrigatório");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { error } = await context.supabase.rpc("approve_pending_signup", {
      target_user: data.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Vincula o professor recém-cadastrado a um registro de professor JÁ
 * EXISTENTE (em vez do registro novo criado automaticamente no
 * autocadastro), pra não duplicar. Remove o registro duplicado criado no
 * autocadastro e aprova o pendente.
 */
export const linkPendingSignupToTeacher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; teacherId: string }) => {
    if (!input?.userId || !input?.teacherId) throw new Error("Dados obrigatórios ausentes");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target, error: targetErr } = await supabaseAdmin
      .from("teachers")
      .select("id, user_id")
      .eq("id", data.teacherId)
      .maybeSingle();
    if (targetErr) throw new Error(targetErr.message);
    if (!target) throw new Error("Professor de destino não encontrado");
    if (target.user_id && target.user_id !== data.userId) {
      throw new Error(
        "Esse professor já tem um login vinculado. Escolha outro ou rejeite o cadastro.",
      );
    }

    // Registro duplicado criado automaticamente no autocadastro (se houver).
    const { data: dup } = await supabaseAdmin
      .from("teachers")
      .select("id")
      .eq("user_id", data.userId)
      .neq("id", data.teacherId)
      .maybeSingle();

    const { error: updErr } = await supabaseAdmin
      .from("teachers")
      .update({ user_id: data.userId })
      .eq("id", data.teacherId);
    if (updErr) throw new Error(updErr.message);

    if (dup) {
      // client_schedules.teacher_id tem ON DELETE SET NULL — seguro apagar.
      const { error: delErr } = await supabaseAdmin.from("teachers").delete().eq("id", dup.id);
      if (delErr) throw new Error(delErr.message);
    }

    const { error: apErr } = await supabaseAdmin.rpc("approve_pending_signup", {
      target_user: data.userId,
    });
    if (apErr) throw new Error(apErr.message);
    return { ok: true };
  });

/**
 * Vincula o cliente recém-cadastrado a um cliente JÁ EXISTENTE (em
 * vez do cliente casado/criado automaticamente por e-mail/telefone no
 * autocadastro), pra corrigir um casamento errado. Aprova o pendente.
 */
export const linkPendingSignupToClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; clientId: string }) => {
    if (!input?.userId || !input?.clientId) throw new Error("Dados obrigatórios ausentes");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existingLink } = await supabaseAdmin
      .from("client_portal_users")
      .select("id, client_id")
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (existingLink && existingLink.client_id === data.clientId) {
      const { data: sameUser } = await supabaseAdmin
        .from("client_portal_users")
        .select("user_id")
        .eq("client_id", data.clientId)
        .maybeSingle();
      if (sameUser && sameUser.user_id !== data.userId) {
        throw new Error(
          "Esse cliente já tem um login vinculado. Escolha outro ou rejeite o cadastro.",
        );
      }
    }

    const { error: updErr } = await supabaseAdmin
      .from("client_portal_users")
      .update({ client_id: data.clientId })
      .eq("user_id", data.userId);
    if (updErr) throw new Error(updErr.message);

    const { error: apErr } = await supabaseAdmin.rpc("approve_pending_signup", {
      target_user: data.userId,
    });
    if (apErr) throw new Error(apErr.message);
    return { ok: true };
  });

/**
 * Rejeita o autocadastro: apaga a conta de login criada e os registros
 * criados automaticamente pra ela (registro de professor duplicado). Ao contrário de "revogar acesso" (users.functions.ts), aqui
 * o cadastro nunca chegou a ser um vínculo de verdade — é descartado.
 */
export const rejectPendingSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; kind: "professor" }) => {
    if (!input?.userId || !input?.kind) throw new Error("Dados obrigatórios ausentes");
    return input;
  })
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.kind === "professor") {
      await supabaseAdmin.from("teachers").delete().eq("user_id", data.userId);
    } else {
      await supabaseAdmin.from("client_portal_users").delete().eq("user_id", data.userId);
    }
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("pending_signups").delete().eq("user_id", data.userId);

    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
