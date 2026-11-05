import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseLoginId } from "@/lib/loginId";

async function findAuthUserByPhone(supabaseAdmin: any, phone: string): Promise<string | null> {
  const raw = phone.replace(/^\+/, "");
  let page = 1;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const found = data.users.find((u: any) => (u.phone ?? "").replace(/^\+/, "") === raw);
    if (found) return found.id;
    if (data.users.length < 200) return null;
    page += 1;
    if (page > 10) return null;
  }
}


interface CreateTeacherAccessInput {
  teacherId: string;
  email: string;
  password: string;
}

async function assertStaff(context: { supabase: any; userId: string }) {
  const [{ data: isAdmin }, { data: isDir }, { data: isRecep }] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "diretoria" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "recepcionista" }),
  ]);
  if (!isAdmin && !isDir && !isRecep) {
    throw new Error("Apenas administradores, diretoria ou recepção podem realizar esta ação");
  }
}

export const createTeacherAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: CreateTeacherAccessInput) => {
    if (!data.teacherId) throw new Error("teacherId obrigatório");
    if (!data.email?.includes("@")) throw new Error("email inválido");
    if (!data.password || data.password.length < 8)
      throw new Error("senha deve ter ao menos 8 caracteres");
    return data;
  })
  .handler(async ({ data, context }) => {
    // apenas admin pode
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) throw new Error("Apenas administradores podem criar acesso");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // cria usuário
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { role: "professor" },
    });
    if (createErr || !created.user) {
      throw new Error(createErr?.message ?? "falha ao criar usuário");
    }
    const userId = created.user.id;

    // vincula ao teacher
    const { error: linkErr } = await supabaseAdmin
      .from("teachers")
      .update({ user_id: userId })
      .eq("id", data.teacherId);
    if (linkErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(linkErr.message);
    }

    // adiciona role professor
    const { error: roleInsertErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "professor" });
    if (roleInsertErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(roleInsertErr.message);
    }

    return { ok: true, userId };
  });

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function findAuthUserByEmail(admin: any, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  while (page <= 10) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const list = data?.users ?? [];
    const found = list.find((u: any) => (u.email ?? "").toLowerCase() === normalized);
    if (found) return found.id as string;
    if (list.length < 200) return null;
    page += 1;
  }
  return null;
}

export const createTeacherSignupToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { teacherId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertStaff(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const teacher = await (supabaseAdmin as any)
      .from("teachers")
      .select("id, user_id")
      .eq("id", data.teacherId)
      .maybeSingle();
    if (!teacher.data) throw new Error("Professor não encontrado");
    if (teacher.data.user_id) throw new Error("Este professor já possui acesso");

    // invalida convites anteriores não usados
    await (supabaseAdmin as any)
      .from("teacher_signup_tokens")
      .delete()
      .eq("teacher_id", data.teacherId)
      .is("used_at", null);

    const token = generateToken();
    const ins = await (supabaseAdmin as any)
      .from("teacher_signup_tokens")
      .insert({ token, teacher_id: data.teacherId, created_by: context.userId })
      .select("token, expires_at")
      .single();
    if (ins.error) throw new Error(ins.error.message);
    return { token: ins.data.token as string, expiresAt: ins.data.expires_at as string };
  });

export const getTeacherSignupTokenInfo = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = await (supabaseAdmin as any)
      .from("teacher_signup_tokens")
      .select("teacher_id, expires_at, used_at, teachers:teacher_id(name)")
      .eq("token", data.token)
      .maybeSingle();
    if (!row.data) return { valid: false as const, reason: "Link inválido" };
    if (row.data.used_at) return { valid: false as const, reason: "Este link já foi utilizado" };
    if (new Date(row.data.expires_at) < new Date()) return { valid: false as const, reason: "Link expirado" };
    return { valid: true as const, teacherName: (row.data.teachers?.name as string) ?? "" };
  });

export const redeemTeacherSignupToken = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; login: string; password: string }) => input)
  .handler(async ({ data }) => {
    const parsed = parseLoginId(data.login);
    if (parsed.kind === "invalid") throw new Error("Informe um e-mail válido ou telefone com DDD.");
    if (!data.password || data.password.length < 8)
      throw new Error("A senha deve ter pelo menos 8 caracteres");
    const email = parsed.kind === "email" ? parsed.value : null;
    const phone = parsed.kind === "phone" ? parsed.value : null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = await (supabaseAdmin as any)
      .from("teacher_signup_tokens")
      .select("id, teacher_id, expires_at, used_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!row.data) throw new Error("Link inválido");
    if (row.data.used_at) throw new Error("Este link já foi utilizado");
    if (new Date(row.data.expires_at) < new Date()) throw new Error("Link expirado");

    const teacherId = row.data.teacher_id as string;

    const teacher = await (supabaseAdmin as any)
      .from("teachers")
      .select("id, user_id")
      .eq("id", teacherId)
      .maybeSingle();
    if (!teacher.data) throw new Error("Professor não encontrado");
    if (teacher.data.user_id) throw new Error("Este professor já possui acesso");

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
      const createArgs: any = { password: data.password, user_metadata: { role: "professor" } };
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

    const link = await (supabaseAdmin as any)
      .from("teachers")
      .update({ user_id: userId })
      .eq("id", teacherId);
    if (link.error) {
      if (createdNew && userId) await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(link.error.message);
    }

    const roleIns = await (supabaseAdmin as any)
      .from("user_roles")
      .insert({ user_id: userId, role: "professor" });
    if (roleIns.error && !String(roleIns.error.message).toLowerCase().includes("duplicate")) {
      // best-effort
    }

    await (supabaseAdmin as any)
      .from("teacher_signup_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", row.data.id);

    return { ok: true, login: parsed.value };
  });

