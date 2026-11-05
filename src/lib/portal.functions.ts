import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseLoginId } from "@/lib/loginId";


function generatePassword(): string {
  return "123456";
}

async function assertStaff(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (data === true) return;
  const r2 = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "recepcionista",
  });
  if (r2.data === true) return;
  throw new Response("Forbidden", { status: 403 });
}

async function findAuthUserByEmail(supabaseAdmin: any, email: string): Promise<string | null> {
  let page = 1;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const found = data.users.find((u: any) => (u.email ?? "").toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
    page += 1;
    if (page > 10) return null;
  }
}

async function findAuthUserByPhone(supabaseAdmin: any, phone: string): Promise<string | null> {
  // Auth stores phone stripped of leading '+'
  const raw = phone.replace(/^\+/, "");
  let page = 1;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const found = data.users.find((u: any) => {
      const p = (u.phone ?? "").replace(/^\+/, "");
      return p === raw;
    });
    if (found) return found.id;
    if (data.users.length < 200) return null;
    page += 1;
    if (page > 10) return null;
  }
}


export const createPortalUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string; email?: string }) => input)
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve email
    let email = (data.email ?? "").trim().toLowerCase();
    if (!email) {
      const c = await supabaseAdmin
        .from("clients")
        .select("email")
        .eq("id", data.clientId)
        .maybeSingle();
      email = ((c.data?.email as string) ?? "").trim().toLowerCase();
    }
    if (!email) throw new Error("Cliente não possui e-mail cadastrado");

    // Already linked?
    const existing = await (supabaseAdmin as any)
      .from("client_portal_users")
      .select("id")
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (existing.data) throw new Error("Este cliente já possui acesso ao portal");

    // Reuse existing auth user if email already in use
    let userId = await findAuthUserByEmail(supabaseAdmin, email);
    let password: string | null = null;
    let reused = false;

    if (userId) {
      reused = true;
    } else {
      password = generatePassword();
      const created = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { portal_client_id: data.clientId },
      });
      if (created.error || !created.data.user) {
        throw new Error(created.error?.message ?? "Falha ao criar usuário");
      }
      userId = created.data.user.id;
    }

    const link = await (supabaseAdmin as any).from("client_portal_users").insert({
      user_id: userId,
      client_id: data.clientId,
      email,
      created_by: context.userId,
    });
    if (link.error) {
      if (!reused && userId) await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(link.error.message);
    }

    return { email, password, reused };
  });

export const revokePortalUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const row = await (supabaseAdmin as any)
      .from("client_portal_users")
      .select("user_id")
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!row.data) return { ok: true };

    const userId = row.data.user_id as string;
    await (supabaseAdmin as any).from("client_portal_users").delete().eq("client_id", data.clientId);

    // Only delete the auth user if no other client is linked to them
    const remaining = await (supabaseAdmin as any)
      .from("client_portal_users")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    if (!remaining.data || remaining.data.length === 0) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
    }
    return { ok: true };
  });

export const resetPortalPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const row = await (supabaseAdmin as any)
      .from("client_portal_users")
      .select("user_id")
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!row.data) throw new Error("Cliente não tem portal ativo");

    const password = generatePassword();
    const upd = await supabaseAdmin.auth.admin.updateUserById(row.data.user_id as string, {
      password,
    });
    if (upd.error) throw new Error(upd.error.message);

    const u = await supabaseAdmin.auth.admin.getUserById(row.data.user_id as string);
    return { email: u.data.user?.email ?? "", password };
  });


function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const createPortalSignupToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const existing = await (supabaseAdmin as any)
      .from("client_portal_users")
      .select("id")
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (existing.data) throw new Error("Este cliente já possui acesso ao portal");

    // Invalidate previous unused tokens for this client
    await (supabaseAdmin as any)
      .from("portal_signup_tokens")
      .delete()
      .eq("client_id", data.clientId)
      .is("used_at", null);

    const token = generateToken();
    const ins = await (supabaseAdmin as any)
      .from("portal_signup_tokens")
      .insert({ token, client_id: data.clientId, created_by: context.userId })
      .select("token, expires_at")
      .single();
    if (ins.error) throw new Error(ins.error.message);
    return { token: ins.data.token as string, expiresAt: ins.data.expires_at as string };
  });

export const getPortalSignupTokenInfo = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = await (supabaseAdmin as any)
      .from("portal_signup_tokens")
      .select("client_id, expires_at, used_at, clients:client_id(full_name)")
      .eq("token", data.token)
      .maybeSingle();
    if (!row.data) return { valid: false as const, reason: "Link inválido" };
    if (row.data.used_at) return { valid: false as const, reason: "Este link já foi utilizado" };
    if (new Date(row.data.expires_at) < new Date()) return { valid: false as const, reason: "Link expirado" };
    return { valid: true as const, clientName: (row.data.clients?.full_name as string) ?? "" };
  });

export const redeemPortalSignupToken = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; login: string; password: string }) => input)
  .handler(async ({ data }) => {
    const parsed = parseLoginId(data.login);
    if (parsed.kind === "invalid") {
      throw new Error("Informe um e-mail válido ou telefone com DDD.");
    }
    if (!data.password || data.password.length < 6) {
      throw new Error("A senha deve ter pelo menos 6 caracteres");
    }
    const email = parsed.kind === "email" ? parsed.value : null;
    const phone = parsed.kind === "phone" ? parsed.value : null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = await (supabaseAdmin as any)
      .from("portal_signup_tokens")
      .select("id, client_id, expires_at, used_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!row.data) throw new Error("Link inválido");
    if (row.data.used_at) throw new Error("Este link já foi utilizado");
    if (new Date(row.data.expires_at) < new Date()) throw new Error("Link expirado");

    const clientId = row.data.client_id as string;

    const existingLink = await (supabaseAdmin as any)
      .from("client_portal_users")
      .select("id")
      .eq("client_id", clientId)
      .maybeSingle();
    if (existingLink.data) throw new Error("Este cliente já possui acesso ao portal");

    // Se já existe conta usando essa credencial, exige a senha atual para vincular.
    let userId = email
      ? await findAuthUserByEmail(supabaseAdmin, email)
      : await findAuthUserByPhone(supabaseAdmin, phone!);
    let createdNew = false;

    if (userId) {
      const { createClient } = await import("@supabase/supabase-js");
      const { getServerEnv } = await import("@/lib/server-env");
      const anon = createClient(
        getServerEnv("SUPABASE_URL")!,
        getServerEnv("SUPABASE_PUBLISHABLE_KEY")!,
        { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
      );
      const creds = email
        ? { email, password: data.password }
        : { phone: phone!, password: data.password };
      const sign = await anon.auth.signInWithPassword(creds);
      if (sign.error || !sign.data.user) {
        throw new Error(
          "Já existe um cadastro com esses dados. Informe a senha que você já usa para vincular esta conta.",
        );
      }
    } else {
      const createArgs: any = {
        password: data.password,
        user_metadata: { portal_client_id: clientId },
      };
      if (email) {
        createArgs.email = email;
        createArgs.email_confirm = true;
      } else {
        createArgs.phone = phone!;
        createArgs.phone_confirm = true;
      }
      const created = await supabaseAdmin.auth.admin.createUser(createArgs);
      if (created.error || !created.data.user) {
        throw new Error(created.error?.message ?? "Falha ao criar usuário");
      }
      userId = created.data.user.id;
      createdNew = true;
    }

    const link = await (supabaseAdmin as any).from("client_portal_users").insert({
      user_id: userId,
      client_id: clientId,
      email,
      phone,
    });
    if (link.error) {
      if (createdNew && userId) await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(link.error.message);
    }

    await (supabaseAdmin as any)
      .from("portal_signup_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", row.data.id);

    return { ok: true, login: parsed.value };
  });



