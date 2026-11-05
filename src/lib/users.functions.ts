import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const revokeUserAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("userId obrigatório");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) throw new Error("Apenas administradores podem revogar acessos");
    if (data.userId === context.userId) throw new Error("Você não pode revogar o próprio acesso");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Confirma manualmente o e-mail de um usuário que ficou preso em "e-mail
// não confirmado" ao tentar logar — normalmente uma conta criada antes da
// migração pra Admin API (ver createStaffUser acima), cujo e-mail de
// confirmação nunca chegou a ser enviado (ex.: engolido pelo rate limit de
// e-mail do projeto) ou não foi clicado a tempo. Idempotente: chamar de
// novo numa conta já confirmada não faz nada de errado.
export const confirmUserEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!input?.userId) throw new Error("userId obrigatório");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) throw new Error("Apenas administradores podem confirmar e-mails");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Vincula uma conta de login (sem vínculo, ou ligada ao cadastro errado)
 * a um cliente já existente: troca o vínculo de client_portal_users pro
 * cliente certo e desativa (sem apagar, preserva histórico) o cliente
 * duplicado criado automaticamente no autocadastro.
 */
export const linkAccountToClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; clientId: string }) => {
    if (!input?.userId || !input?.clientId) throw new Error("Dados obrigatórios ausentes");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!set.has("admin") && !set.has("diretoria")) {
      throw new Error(
        "Apenas administradores ou diretoria podem vincular uma conta a um cliente",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target, error: targetErr } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (targetErr) throw new Error(targetErr.message);
    if (!target) throw new Error("Cliente de destino não encontrado");

    // client_portal_users só é único no par (user_id, client_id): tanto o
    // cliente quanto a conta podem ter mais de um vínculo. .maybeSingle()
    // aqui quebrava (erro silencioso -> null) justamente nesses casos.
    const { data: targetLinks, error: targetLinksErr } = await supabaseAdmin
      .from("client_portal_users")
      .select("user_id")
      .eq("client_id", data.clientId);
    if (targetLinksErr) throw new Error(targetLinksErr.message);
    if ((targetLinks ?? []).some((l) => l.user_id !== data.userId)) {
      throw new Error("Esse cliente já tem um login vinculado a outra conta.");
    }

    const { data: currentLinks, error: currentLinksErr } = await supabaseAdmin
      .from("client_portal_users")
      .select("client_id")
      .eq("user_id", data.userId);
    if (currentLinksErr) throw new Error(currentLinksErr.message);
    const alreadyLinked = (currentLinks ?? []).some((l) => l.client_id === data.clientId);
    const otherClientIds = (currentLinks ?? [])
      .map((l) => l.client_id as string)
      .filter((id) => id !== data.clientId);

    // Conta já ligada ao cliente certo e sem nada a corrigir.
    if (alreadyLinked && otherClientIds.length === 0) {
      throw new Error("Essa conta já está vinculada a esse cliente.");
    }

    if (!alreadyLinked) {
      const { error: insErr } = await supabaseAdmin
        .from("client_portal_users")
        .insert({ user_id: data.userId, client_id: data.clientId });
      if (insErr) throw new Error(insErr.message);
    }

    // Vínculos com os clientes duplicados criados no autocadastro saem; o
    // cliente em si só é desativado se nenhuma outra conta usa ele.
    for (const oldClientId of otherClientIds) {
      const { error: unlinkErr } = await supabaseAdmin
        .from("client_portal_users")
        .delete()
        .eq("user_id", data.userId)
        .eq("client_id", oldClientId);
      if (unlinkErr) throw new Error(unlinkErr.message);
      const { count } = await supabaseAdmin
        .from("client_portal_users")
        .select("user_id", { count: "exact", head: true })
        .eq("client_id", oldClientId);
      if (!count) {
        await supabaseAdmin.from("clients").update({ active: false }).eq("id", oldClientId);
      }
    }

    await supabaseAdmin.from("pending_signups").delete().eq("user_id", data.userId);

    // O cliente certo costuma estar inativo (por isso o autocadastro não
    // achou o vínculo por e-mail/telefone) — reativa agora que tem login.
    await supabaseAdmin.from("clients").update({ active: true }).eq("id", data.clientId);

    return { ok: true };
  });

/**
 * Exclui um cliente e, se ele tiver login de portal vinculado
 * (client_portal_users), remove também a conta em auth.users.
 *
 * Excluir só a linha de `clients` (o que a UI fazia direto pelo client-side
 * antes) cascade-apaga o vínculo em client_portal_users, mas deixa a conta
 * de auth.users órfã. Como o autocadastro do portal barra e-mail já
 * existente olhando pra auth.users (não pra clients), essa conta órfã
 * impede a pessoa de se cadastrar de novo com o mesmo e-mail — mesmo o
 * cadastro dela tendo sido "excluído" do ponto de vista da recepção.
 */
export const deleteClientAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clientId: string }) => {
    if (!input?.clientId) throw new Error("clientId obrigatório");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const set = new Set((roles ?? []).map((r: { role: string }) => r.role));
    if (!set.has("admin") && !set.has("diretoria") && !set.has("recepcionista")) {
      throw new Error("Sem permissão para excluir clientes");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Um cliente pode ter mais de um login de portal vinculado (ex.:
    // dependente financeiro com conta própria, ou duas tentativas de
    // autocadastro que casaram com o mesmo cliente) — client_portal_users
    // só é único no par (user_id, client_id), não em client_id sozinho.
    // Usar .maybeSingle() aqui apagava só o cliente e deixava TODAS as
    // contas de Auth vinculadas órfãs sem avisar (erro de "mais de uma
    // linha" era silenciosamente ignorado).
    const { data: links } = await supabaseAdmin
      .from("client_portal_users")
      .select("user_id")
      .eq("client_id", data.clientId);

    const { data: deleted, error: delErr } = await supabaseAdmin
      .from("clients")
      .delete()
      .eq("id", data.clientId)
      .select("id");
    if (delErr) {
      // 23503 = algum registro ainda referencia o cliente sem ON DELETE.
      if (delErr.code === "23503") {
        throw new Error(
          `Não foi possível excluir: o cliente ainda tem registros vinculados (${delErr.message}).`,
        );
      }
      throw new Error(delErr.message);
    }
    if (!deleted || deleted.length === 0) throw new Error("Cliente não encontrado");

    for (const link of links ?? []) {
      if (link.user_id) {
        await supabaseAdmin.auth.admin.deleteUser(link.user_id).catch(() => {});
      }
    }

    return { ok: true };
  });

// Lista todo id de auth.users cujo e-mail bate (normalmente 0 ou 1, mas
// tentativas de autocadastro que falharam no meio do caminho — antes da
// conta de Auth ser vinculada a um cliente/papel — podem ter deixado mais
// de uma conta órfã com o mesmo e-mail).
async function findAuthIdsByEmail(
  supabaseAdmin: (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"],
  email: string,
): Promise<{ id: string; created_at: string }[]> {
  const found: { id: string; created_at: string }[] = [];
  let page = 1;
  while (true) {
    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !list) break;
    for (const u of list.users) {
      if ((u.email ?? "").toLowerCase() === email) {
        found.push({ id: u.id, created_at: u.created_at });
      }
    }
    if (list.users.length < 200) break;
    page += 1;
    if (page > 25) break; // até 5000 contas — bem acima do que o clube tem
  }
  return found;
}

/**
 * Varredura: procura, por e-mail, todo resquício que possa travar um
 * recadastro (contas de Auth, clientes, vínculos de portal e filas de
 * aprovação) — pensado pro caso de alguém ter sido "excluído" mas ainda
 * assim não conseguir se cadastrar de novo com o mesmo e-mail.
 */
export const sweepSignupBlockers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string }) => {
    const email = (input?.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error("Informe um e-mail válido");
    return { email };
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) throw new Error("Apenas administradores podem fazer essa varredura");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email;

    const authAccounts = await findAuthIdsByEmail(supabaseAdmin, email);
    const userIds = authAccounts.map((u) => u.id);

    const { data: clients } = await supabaseAdmin
      .from("clients")
      .select("id, full_name, email, phone, active")
      .ilike("email", email);
    const clientIds = (clients ?? []).map((c) => c.id as string);

    const [portalByUser, portalByClient, pendingSignups, pendingClientSignups] = await Promise.all([
      userIds.length
        ? supabaseAdmin
            .from("client_portal_users")
            .select("id, user_id, client_id, email")
            .in("user_id", userIds)
        : Promise.resolve({ data: [] }),
      clientIds.length
        ? supabaseAdmin
            .from("client_portal_users")
            .select("id, user_id, client_id, email")
            .in("client_id", clientIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabaseAdmin
            .from("pending_signups")
            .select("user_id, kind, full_name, email")
            .in("user_id", userIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabaseAdmin
            .from("pending_client_signups")
            .select("id, user_id, full_name, email, status")
            .in("user_id", userIds)
        : Promise.resolve({ data: [] }),
    ]);

    const portalLinksById = new Map<
      string,
      { id: string; user_id: string; client_id: string; email: string | null }
    >();
    for (const row of [...(portalByUser.data ?? []), ...(portalByClient.data ?? [])]) {
      portalLinksById.set(row.id as string, row as never);
    }

    return {
      email,
      authAccounts,
      clients: clients ?? [],
      portalLinks: [...portalLinksById.values()],
      pendingSignups: pendingSignups.data ?? [],
      pendingClientSignups: pendingClientSignups.data ?? [],
    };
  });

/**
 * Expurgo: some com tudo que a varredura acima encontrou pra aquele
 * e-mail — todas as contas de Auth (cascade cuida de profiles, user_roles,
 * pending_signups e pending_client_signups; teachers.user_id vira null),
 * os clientes correspondentes e os vínculos de portal (que não têm FK pra
 * auth.users, então não somem sozinhos quando a conta é apagada).
 *
 * Depois disso a pessoa consegue se cadastrar de novo do zero com esse
 * e-mail — se ela ainda tiver histórico financeiro que precise ser
 * preservado, prefira vincular manualmente em vez de usar isto.
 */
export const purgeSignupBlockers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string }) => {
    const email = (input?.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) throw new Error("Informe um e-mail válido");
    return { email };
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin)
      throw new Error("Apenas administradores podem excluir esses cadastros");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email;

    const authAccounts = await findAuthIdsByEmail(supabaseAdmin, email);
    const userIds = authAccounts.map((u) => u.id);

    const { data: clients } = await supabaseAdmin
      .from("clients")
      .select("id")
      .ilike("email", email);
    const clientIds = (clients ?? []).map((c) => c.id as string);

    if (userIds.length) {
      await supabaseAdmin.from("client_portal_users").delete().in("user_id", userIds);
    }
    if (clientIds.length) {
      await supabaseAdmin.from("client_portal_users").delete().in("client_id", clientIds);
      await supabaseAdmin.from("clients").delete().in("id", clientIds);
    }

    let deletedAuthAccounts = 0;
    for (const uid of userIds) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
      if (!error) deletedAuthAccounts += 1;
    }

    return {
      ok: true as const,
      deletedAuthAccounts,
      deletedClients: clientIds.length,
    };
  });

const CREATABLE_STAFF_ROLES = [
  "admin",
  "recepcionista",
  "diretoria",
  "limpeza",
  "visualizador",
] as const;
type CreatableStaffRole = (typeof CREATABLE_STAFF_ROLES)[number];

// Cria login de staff via Admin API (supabaseAdmin.auth.admin.createUser),
// em vez do supabase.auth.signUp() client-side usado antes: aquele exigia
// salvar/restaurar a sessão do admin em volta da chamada (signUp loga como
// o usuário recém-criado) e disparava e-mail de confirmação a cada conta —
// o que estourava o rate limit de e-mail do projeto (poucas criações
// seguidas já bastavam pra dar "email rate limit exceeded"). A Admin API
// cria a conta já confirmada (email_confirm: true), sem enviar e-mail
// nenhum e sem afetar a sessão de quem está criando.
export const createStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fullName: string; email: string; password: string; role: string }) => {
    if (!input?.fullName?.trim()) throw new Error("Nome obrigatório");
    if (!input?.email?.includes("@")) throw new Error("Email inválido");
    if (!input?.password || input.password.length < 6)
      throw new Error("A senha deve ter ao menos 6 caracteres");
    if (!CREATABLE_STAFF_ROLES.includes(input?.role as CreatableStaffRole))
      throw new Error("Papel inválido");
    return input as { fullName: string; email: string; password: string; role: CreatableStaffRole };
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) throw new Error("Apenas administradores podem criar usuários");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (createErr || !created.user) {
      throw new Error(createErr?.message ?? "Falha ao criar usuário");
    }
    const userId = created.user.id;

    const { error: roleInsertErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: data.role } as never);
    if (roleInsertErr) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(roleInsertErr.message);
    }

    return { ok: true, userId };
  });

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; password: string }) => {
    if (!input?.userId) throw new Error("userId obrigatório");
    if (!input?.password || input.password.length < 6)
      throw new Error("A senha deve ter ao menos 6 caracteres");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) throw new Error("Apenas administradores podem redefinir senhas");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
