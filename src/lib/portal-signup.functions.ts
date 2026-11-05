import { createServerFn } from "@tanstack/react-start";
import { normalizeBRPhone } from "@/lib/loginId";

/**
 * Auto-cadastro público a partir de uma URL de portal.
 *
 * Segurança:
 * - Público (sem middleware). O `portal` é a ÚNICA fonte do papel — nunca
 *   confie em qualquer outro parâmetro do cliente.
 * - Apenas 3 papéis podem ser atribuídos por autocadastro:
 *   `cliente` (sem role interna) e `professor`.
 * - Nunca cria admin / diretoria / recepcionista.
 * - Professor entra como pendente (tabela `pending_signups`)
 *   até que a recepção/diretoria aprove.
 */
export type PortalKind = "cliente" | "professor";

const ALLOWED: readonly PortalKind[] = ["cliente", "professor"] as const;

export const signUpFromPortal = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      portal: PortalKind;
      email: string;
      password: string;
      fullName: string;
      phone?: string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const portal = data.portal;
    if (!ALLOWED.includes(portal)) {
      throw new Error("Portal inválido");
    }
    const email = (data.email ?? "").trim().toLowerCase();
    const fullName = (data.fullName ?? "").trim();
    const phone = (data.phone ?? "").trim();
    if (!email || !email.includes("@")) throw new Error("Informe um e-mail válido");
    if (!data.password || data.password.length < 6)
      throw new Error("A senha deve ter pelo menos 6 caracteres");
    if (!fullName) throw new Error("Informe seu nome completo");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verifica se já existe usuário auth com esse e-mail
    let existingId: string | null = null;
    {
      let page = 1;
      while (true) {
        const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage: 200,
        });
        if (error || !list) break;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const found = list.users.find((u: any) => (u.email ?? "").toLowerCase() === email);
        if (found) {
          existingId = found.id;
          break;
        }
        if (list.users.length < 200) break;
        page += 1;
        if (page > 10) break;
      }
    }
    if (existingId) {
      throw new Error("Já existe uma conta com esse e-mail. Faça login normalmente.");
    }

    // Login por telefone (signInWithPassword({ phone })) só funciona se o
    // telefone estiver de fato salvo no usuário do Auth — antes disso não
    // acontecia (só e-mail era gravado), então clientes que se cadastravam
    // com e-mail + telefone nunca conseguiam entrar pelo telefone.
    const normalizedPhone = phone ? normalizeBRPhone(phone) : null;

    let created = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      ...(normalizedPhone ? { phone: normalizedPhone, phone_confirm: true } : {}),
      user_metadata: { portal_signup: portal, full_name: fullName },
    });
    // Se falhar com o telefone anexado (ex.: já usado por outra conta),
    // não bloqueia o cadastro — tenta de novo só com e-mail, como sempre foi.
    if (created.error && normalizedPhone) {
      created = await supabaseAdmin.auth.admin.createUser({
        email,
        password: data.password,
        email_confirm: true,
        user_metadata: { portal_signup: portal, full_name: fullName },
      });
    }
    if (created.error || !created.data.user) {
      throw new Error(created.error?.message ?? "Falha ao criar usuário");
    }
    const userId = created.data.user.id;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const admin = supabaseAdmin as any;

      let pending = false;

      if (portal === "cliente") {
        // Tenta encontrar cliente existente por e-mail ou telefone (sem duplicar).
        let clientId: string | null = null;
        {
          const byEmail = await admin
            .from("clients")
            .select("id")
            .ilike("email", email)
            .limit(1)
            .maybeSingle();
          if (byEmail.data?.id) clientId = byEmail.data.id as string;
        }
        if (!clientId && phone) {
          const byPhone = await admin
            .from("clients")
            .select("id")
            .eq("phone", phone)
            .limit(1)
            .maybeSingle();
          if (byPhone.data?.id) clientId = byPhone.data.id as string;
        }

        if (clientId) {
          // Vincula ao portal (upsert manual)
          const existLink = await admin
            .from("client_portal_users")
            .select("id")
            .eq("user_id", userId)
            .limit(1)
            .maybeSingle();
          if (!existLink.data) {
            const link = await admin
              .from("client_portal_users")
              .insert({ user_id: userId, client_id: clientId, email });
            if (link.error) throw new Error(link.error.message);
          }
        } else {
          // Não achou por e-mail/telefone (ex.: cadastro antigo sem
          // contato salvo) — em vez de duplicar o cliente, entra numa
          // fila pra recepção/diretoria vincular manualmente ao cadastro
          // certo (ou confirmar que é gente nova mesmo).
          const pend = await admin
            .from("pending_client_signups")
            .insert({ user_id: userId, full_name: fullName, email, phone: phone || null });
          if (pend.error) throw new Error(pend.error.message);
          pending = true;
        }
      }

      if (portal === "professor") {
        // Cria registro de professor (nome vindo do formulário)
        const tIns = await admin
          .from("teachers")
          .insert({ name: fullName, active: true, user_id: userId })
          .select("id")
          .single();
        if (tIns.error) throw new Error(tIns.error.message);
      }

      // Concede o papel — SEMPRE derivado do portal, nunca do cliente.
      if (portal === "professor") {
        const r = await admin.from("user_roles").insert({ user_id: userId, role: "professor" });
        if (r.error) throw new Error(r.error.message);
      }
      // Para 'cliente' não criamos linha em user_roles — o portal identifica pelo vínculo.

      // Professor entra como pendente de aprovação
      if (portal === "professor") {
        const p = await admin
          .from("pending_signups")
          .insert({
            user_id: userId,
            kind: portal,
            full_name: fullName,
            email,
            phone: phone || null,
          });
        if (p.error) throw new Error(p.error.message);
      }

      return { ok: true as const, portal, email, pending };
    } catch (err) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      throw err;
    }
  });
