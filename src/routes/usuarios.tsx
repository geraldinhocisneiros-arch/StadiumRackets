import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import {
  Plus,
  Loader2,
  Shield,
  Users,
  GraduationCap,
  Briefcase,
  MessageCircle,
  Trash2,
  Link2,
  Check,
  UserPlus as UserPlusIcon,
  KeyRound,
  MailCheck,
  Search,
} from "lucide-react";
import { MANAGEABLE_PAGES } from "@/lib/pages";
import { useAuth } from "@/hooks/useAuth";
import { useServerFn } from "@tanstack/react-start";
import {
  revokeUserAccess,
  resetUserPassword,
  linkAccountToClient,
  createStaffUser,
  confirmUserEmail,
  sweepSignupBlockers,
  purgeSignupBlockers,
} from "@/lib/users.functions";
import {
  listPendingSignups,
  approvePendingSignup,
  linkPendingSignupToTeacher,
  linkPendingSignupToClient,
  rejectPendingSignup,
  type PendingSignupRow,
} from "@/lib/pending-signups.functions";
import { ClientCombobox, type ClientOption } from "@/components/ClientCombobox";

export const Route = createFileRoute("/usuarios")({
  component: () => (
    <RequireAuth pageKey="usuarios">
      <UsuariosPage />
    </RequireAuth>
  ),
});

type Bucket = "clientes" | "professores" | "colaboradores" | "sem_vinculo";

interface UserRow {
  id: string;
  full_name: string;
  email: string | null;
  roles: string[];
  bucket: Bucket;
  portalClientName?: string | null;
  teacherName?: string | null;
  pendingClientSignup?: boolean;
}

function classifyBucket(
  roles: string[],
  isPortal: boolean,
  isTeacher: boolean,
  isPendingClientSignup: boolean,
): Bucket {
  if (isTeacher || roles.includes("professor")) return "professores";
  if (
    roles.some(
      (r) =>
        r === "admin" ||
        r === "recepcionista" ||
        r === "diretoria" ||
        r === "limpeza" ||
        r === "visualizador",
    )
  )
    return "colaboradores";
  if (isPortal) return "clientes";
  // Cadastro feito em /cliente que ainda não foi casado/vinculado a um
  // cliente existente (ver pending_client_signups) — é cliente aguardando
  // vínculo.
  if (isPendingClientSignup) return "clientes";
  // Login sem papel e sem vínculo nenhum. Fica separado pra revisão manual.
  return "sem_vinculo";
}

const BUCKET_META: Record<Bucket, { label: string; icon: typeof Users; description: string }> = {
  clientes: {
    label: "Clientes",
    icon: Users,
    description: "Contas do portal do cliente (alunos, jogadores e responsáveis).",
  },
  professores: {
    label: "Professores",
    icon: GraduationCap,
    description: "Professores vinculados ao sistema.",
  },
  colaboradores: {
    label: "Colaboradores",
    icon: Briefcase,
    description: "Recepcionistas, administrativo e diretoria.",
  },
  sem_vinculo: {
    label: "Sem vínculo",
    icon: Link2,
    description:
      "Logins sem papel e sem vínculo com cliente ou professor — geralmente clientes que criaram conta e nunca foram vinculados ao cadastro. Use o botão de vínculo para ligar ao cliente certo, dê um papel, ou revogue o acesso.",
  },
};

function UsuariosPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Bucket>("clientes");

  const load = async () => {
    setLoading(true);
    const [profilesRes, rolesRes, portalRes, teachersRes, pendingClientRes] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email").order("full_name"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("client_portal_users").select("user_id, clients(full_name)"),
      supabase.from("teachers").select("user_id, name"),
      supabase.from("pending_client_signups").select("user_id").eq("status", "pending"),
    ]);
    const rolesMap = new Map<string, string[]>();
    (rolesRes.data ?? []).forEach((r) => {
      const arr = rolesMap.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesMap.set(r.user_id, arr);
    });
    const portalMap = new Map<string, string | null>();
    (portalRes.data ?? []).forEach((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const name = (r as any).clients?.full_name ?? null;
      portalMap.set(r.user_id, name);
    });
    const teacherMap = new Map<string, string>();
    (teachersRes.data ?? []).forEach((r) => {
      if (r.user_id) teacherMap.set(r.user_id, r.name);
    });
    const pendingClientSet = new Set((pendingClientRes.data ?? []).map((r) => r.user_id as string));
    setUsers(
      (profilesRes.data ?? []).map((p) => {
        const roles = rolesMap.get(p.id) ?? [];
        const isPortal = portalMap.has(p.id);
        const isTeacher = teacherMap.has(p.id);
        const isPendingClientSignup = pendingClientSet.has(p.id);
        return {
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          roles,
          bucket: classifyBucket(roles, isPortal, isTeacher, isPendingClientSignup),
          portalClientName: portalMap.get(p.id) ?? null,
          teacherName: teacherMap.get(p.id) ?? null,
          pendingClientSignup: isPendingClientSignup,
        };
      }),
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = {
      clientes: 0,
      professores: 0,
      colaboradores: 0,
      sem_vinculo: 0,
    };
    users.forEach((u) => c[u.bucket]++);
    return c;
  }, [users]);

  const filtered = useMemo(() => users.filter((u) => u.bucket === tab), [users, tab]);

  const { isAdmin, user: currentUser } = useAuth();
  const revokeFn = useServerFn(revokeUserAccess);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const confirm = useConfirm();

  const handleRevoke = async (u: UserRow) => {
    if (u.id === currentUser?.id) {
      toast.error("Você não pode revogar o próprio acesso.");
      return;
    }
    const label = u.full_name || u.email || "este usuário";
    if (
      !(await confirm(
        `Revogar o acesso de ${label}?\n\nO login será removido, mas o cadastro da pessoa (cliente/professor) é mantido no sistema.`,
      ))
    )
      return;
    setRevokingId(u.id);
    try {
      await revokeFn({ data: { userId: u.id } });
      toast.success("Acesso revogado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao revogar acesso");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Usuários</h1>
          <p className="text-muted-foreground">
            Todas as contas de acesso ao sistema, organizadas por tipo.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && <SignupBlockersSweepButton />}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Novo usuário
              </Button>
            </DialogTrigger>
            <CreateUserDialog onClose={() => setOpen(false)} onCreated={load} />
          </Dialog>
        </div>
      </div>

      <WhatsAppReservationsSettings />

      <PendingSignupsCard onApproved={load} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Bucket)}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5 h-auto">
          {(Object.keys(BUCKET_META) as Bucket[]).map((k) => {
            const meta = BUCKET_META[k];
            const Icon = meta.icon;
            return (
              <TabsTrigger key={k} value={k} className="flex items-center gap-2 py-2">
                <Icon className="h-4 w-4" />
                <span>{meta.label}</span>
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-[10px]">
                  {counts[k]}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {(Object.keys(BUCKET_META) as Bucket[]).map((k) => (
          <TabsContent key={k} value={k} className="mt-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <p className="text-sm text-muted-foreground">{BUCKET_META[k].description}</p>
                {loading ? (
                  <div className="py-8 text-center text-muted-foreground">Carregando...</div>
                ) : filtered.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Nenhum usuário nesta categoria.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Vínculo</TableHead>
                        <TableHead>Papéis</TableHead>
                        <TableHead>Permissões de abas</TableHead>
                        {isAdmin && <TableHead className="text-right">Ações</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                          <TableCell className="text-sm">{u.email}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {u.teacherName ? (
                              `Prof. ${u.teacherName}`
                            ) : u.portalClientName ? (
                              u.portalClientName
                            ) : u.pendingClientSignup ? (
                              <Link
                                to="/pendencias-cadastro"
                                className="text-amber-600 dark:text-amber-400 hover:underline"
                              >
                                Aguardando vínculo →
                              </Link>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell>
                            {u.roles.map((r) => (
                              <Badge
                                key={r}
                                className={
                                  r === "admin" ? "bg-primary text-primary-foreground mr-1" : "mr-1"
                                }
                                variant={r === "admin" ? "default" : "secondary"}
                              >
                                {r}
                              </Badge>
                            ))}
                            {u.roles.length === 0 && u.pendingClientSignup && (
                              <Badge
                                variant="outline"
                                className="border-amber-500 text-amber-600 dark:text-amber-400"
                              >
                                Pendente
                              </Badge>
                            )}
                            {u.roles.length === 0 && !u.pendingClientSignup && (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <RoleControl user={u} onChanged={load} />
                          </TableCell>
                          <TableCell>
                            <PermissionsControl user={u} />
                          </TableCell>
                          {isAdmin && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {u.bucket === "sem_vinculo" && (
                                  <LinkAccountControl user={u} onChanged={load} />
                                )}
                                <ResetPasswordControl user={u} />
                                <ConfirmEmailControl user={u} />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Revogar acesso"
                                  disabled={revokingId === u.id || u.id === currentUser?.id}
                                  onClick={() => handleRevoke(u)}
                                >
                                  {revokingId === u.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// Reporta o que a varredura de e-mail encontrou (server fn sweepSignupBlockers).
type SweepReport = Awaited<ReturnType<ReturnType<typeof useServerFn<typeof sweepSignupBlockers>>>>;

/**
 * Quando alguém "excluído" ainda não consegue se cadastrar de novo com o
 * mesmo e-mail, o motivo quase sempre é um resquício que a exclusão normal
 * não alcança: mais de uma conta de login (tentativas de cadastro que
 * falharam no meio do caminho), um cliente com o mesmo e-mail que nunca foi
 * apagado, ou um vínculo de portal órfão. Esta ferramenta procura tudo isso
 * de uma vez e deixa apagar em um clique.
 */
function SignupBlockersSweepButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [report, setReport] = useState<SweepReport | null>(null);
  const sweepFn = useServerFn(sweepSignupBlockers);
  const purgeFn = useServerFn(purgeSignupBlockers);
  const confirm = useConfirm();

  const reset = () => {
    setReport(null);
    setEmail("");
  };

  const handleSearch = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setReport(null);
    try {
      const res = await sweepFn({ data: { email } });
      setReport(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na varredura");
    } finally {
      setLoading(false);
    }
  };

  const totalFound = report
    ? report.authAccounts.length +
      report.clients.length +
      report.portalLinks.length +
      report.pendingSignups.length +
      report.pendingClientSignups.length
    : 0;

  const handlePurge = async () => {
    if (!report) return;
    if (
      !(await confirm(
        `Apagar tudo que foi encontrado para ${report.email}?\n\n${report.authAccounts.length} conta(s) de login e ${report.clients.length} cadastro(s) de cliente serão excluídos — sem volta. Depois disso o e-mail fica livre pra um cadastro novo do zero.`,
      ))
    )
      return;
    setPurging(true);
    try {
      const res = await purgeFn({ data: { email: report.email } });
      toast.success(
        `Pronto: ${res.deletedAuthAccounts} conta(s) e ${res.deletedClients} cliente(s) apagados. O e-mail está livre pra recadastro.`,
      );
      reset();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setPurging(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Search className="h-4 w-4 mr-2" /> Cadastro travado?
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Varredura de cadastro travado</DialogTitle>
          <DialogDescription>
            Procura por e-mail tudo que pode estar impedindo alguém de se cadastrar de novo (contas
            de login, clientes, vínculos de portal e filas de aprovação) e deixa apagar tudo de uma
            vez.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="email@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={loading || !email.trim()}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>
          {report && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              {totalFound === 0 ? (
                <p className="text-muted-foreground">
                  Nada encontrado pra esse e-mail — o cadastro já deveria funcionar. Se ainda
                  travar, confirme se é exatamente esse o e-mail que a pessoa está digitando.
                </p>
              ) : (
                <>
                  <p>
                    <strong>{report.authAccounts.length}</strong> conta(s) de login encontrada(s)
                    {report.authAccounts.length > 1 && (
                      <span className="text-amber-600">
                        {" "}
                        — mais de uma é sinal de cadastros que falharam no meio do caminho.
                      </span>
                    )}
                  </p>
                  <p>
                    <strong>{report.clients.length}</strong> cadastro(s) de cliente com esse e-mail
                  </p>
                  <p>
                    <strong>{report.portalLinks.length}</strong> vínculo(s) de portal
                  </p>
                  <p>
                    <strong>{report.pendingSignups.length}</strong> pendência(s) de
                    professor
                  </p>
                  <p>
                    <strong>{report.pendingClientSignups.length}</strong> pendência(s) de cliente
                  </p>
                  <Button
                    variant="destructive"
                    className="w-full mt-2"
                    onClick={handlePurge}
                    disabled={purging}
                  >
                    {purging && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Apagar tudo e liberar o e-mail pra recadastro
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<
    "admin" | "recepcionista" | "diretoria" | "limpeza" | "visualizador"
  >("recepcionista");
  const [submitting, setSubmitting] = useState(false);

  const createStaffUserFn = useServerFn(createStaffUser);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createStaffUserFn({ data: { fullName: name, email, password, role } });
      toast.success("Usuário criado!");
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar usuário.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Novo usuário</DialogTitle>
        <DialogDescription>Crie acesso para um recepcionista ou administrador.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="n">Nome completo</Label>
          <Input id="n" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="e">Email</Label>
          <Input
            id="e"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="p">Senha (mín. 6 caracteres)</Label>
          <Input
            id="p"
            type="password"
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Papel</Label>
          <Select
            value={role}
            onValueChange={(v) =>
              setRole(v as "admin" | "recepcionista" | "diretoria" | "limpeza" | "visualizador")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recepcionista">Recepcionista</SelectItem>
              <SelectItem value="diretoria">Diretoria</SelectItem>
              <SelectItem value="admin">Administrador</SelectItem>
              <SelectItem value="limpeza">Limpeza</SelectItem>
              <SelectItem value="visualizador">Visualizador (só vê o mapa)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Criar usuário
        </Button>
      </form>
    </DialogContent>
  );
}

function RoleControl({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const toggleRole = async (
    role: "admin" | "recepcionista" | "diretoria" | "limpeza" | "visualizador",
  ) => {
    if (user.roles.includes(role)) {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", user.id)
        .eq("role", role as never);
      if (error) toast.error(error.message);
      else {
        toast.success("Papel removido.");
        onChanged();
      }
    } else {
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: user.id, role } as never);
      if (error) toast.error(error.message);
      else {
        toast.success("Papel atribuído.");
        onChanged();
      }
    }
  };

  return (
    <div className="flex gap-1 flex-wrap">
      <Button
        size="sm"
        variant={user.roles.includes("admin") ? "default" : "outline"}
        onClick={() => toggleRole("admin")}
      >
        Admin
      </Button>
      <Button
        size="sm"
        variant={user.roles.includes("recepcionista") ? "default" : "outline"}
        onClick={() => toggleRole("recepcionista")}
      >
        Recep.
      </Button>
      <Button
        size="sm"
        variant={user.roles.includes("diretoria") ? "default" : "outline"}
        onClick={() => toggleRole("diretoria")}
      >
        Diretoria
      </Button>
      <Button
        size="sm"
        variant={user.roles.includes("limpeza") ? "default" : "outline"}
        onClick={() => toggleRole("limpeza")}
      >
        Limpeza
      </Button>
      <Button
        size="sm"
        variant={user.roles.includes("visualizador") ? "default" : "outline"}
        onClick={() => toggleRole("visualizador")}
      >
        Visualizador
      </Button>
    </div>
  );
}

function PermissionsControl({ user }: { user: UserRow }) {
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const isAdminUser = user.roles.includes("admin");
  const isStaff =
    isAdminUser || user.roles.includes("diretoria") || user.roles.includes("recepcionista");
  const isProfessorUser = user.roles.includes("professor");

  // Perfil do usuário para o modal
  const profileLabel = isAdminUser
    ? "Administrador"
    : user.roles.includes("diretoria")
      ? "Diretoria"
      : user.roles.includes("recepcionista")
        ? "Recepcionista"
        : isProfessorUser
          ? "Professor"
          : "Cliente";

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("user_permissions")
      .select("page_key, granted")
      .eq("user_id", user.id);
    const explicit: Record<string, boolean> = {};
    (data ?? []).forEach((row) => {
      explicit[row.page_key] = row.granted;
    });
    const map: Record<string, boolean> = {};
    MANAGEABLE_PAGES.forEach((p) => {
      if (p.key === "inadimplencia") {
        // Vale para qualquer equipe, inclusive admin: liberado salvo bloqueio.
        map[p.key] = isStaff ? (explicit[p.key] ?? true) : false;
      } else if (isAdminUser) {
        map[p.key] = true;
      } else if (isStaff) {
        // Diretoria/Recepcionista: default true salvo bloqueio explícito
        map[p.key] = explicit[p.key] ?? true;
      } else if (p.key === "mapa") {
        // Professor tem 'mapa' automático; demais não-staff dependem de liberação
        map[p.key] = isProfessorUser ? true : explicit[p.key] === true;
      } else {
        // Módulos administrativos: sempre bloqueados para não-staff
        map[p.key] = false;
      }
    });
    setPerms(map);
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = async (pageKey: string, value: boolean) => {
    setPerms((prev) => ({ ...prev, [pageKey]: value }));
    const { error } = await supabase
      .from("user_permissions")
      .upsert(
        { user_id: user.id, page_key: pageKey, granted: value },
        { onConflict: "user_id,page_key" },
      );
    if (error) {
      toast.error("Falha ao salvar: " + error.message);
      setPerms((prev) => ({ ...prev, [pageKey]: !value }));
    } else {
      toast.success(value ? "Acesso liberado." : "Acesso bloqueado.");
    }
  };

  // Um switch é editável quando:
  // - Não é admin (admin trava tudo em ON).
  // - Se é staff: qualquer módulo (exceto 'mapa' que é automático).
  // - Se é não-staff: apenas 'mapa' pode ser liberado manualmente.
  const isEditable = (pageKey: string) => {
    if (pageKey === "inadimplencia") return isStaff;
    if (isAdminUser) return false;
    if (isStaff) return pageKey !== "mapa";
    return pageKey === "mapa" && !isProfessorUser;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Shield className="h-4 w-4 mr-1" /> Gerenciar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Permissões de {user.full_name || user.email}</DialogTitle>
          <DialogDescription>
            Perfil: <strong>{profileLabel}</strong>. As permissões abaixo refletem exatamente o que
            está gravado no banco de dados.
          </DialogDescription>
        </DialogHeader>

        {isAdminUser && (
          <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
            Este usuário é <strong>administrador</strong> e tem acesso total a todas as abas (exceto
            Inadimplência, que pode ser bloqueada abaixo).
          </div>
        )}
        {!isStaff && !isAdminUser && (
          <div className="rounded-md border border-muted-foreground/20 bg-muted/40 px-3 py-2 text-sm">
            {isProfessorUser
              ? "Professor: acesso restrito ao Mapa de Quadras e ao Portal do Professor. Módulos administrativos ficam sempre desativados."
              : "Cliente: acesso restrito ao Portal do Cliente. Módulos administrativos ficam sempre desativados."}
          </div>
        )}

        {loading ? (
          <div className="py-6 text-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando...
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            {MANAGEABLE_PAGES.map((p) => {
              const editable = isEditable(p.key);
              return (
                <div
                  key={p.key}
                  className="flex items-start justify-between gap-4 rounded-md border p-3"
                >
                  <div className="space-y-0.5">
                    <div className="font-medium text-sm">{p.label}</div>
                    <div className="text-xs text-muted-foreground">{p.description}</div>
                  </div>
                  <Switch
                    checked={perms[p.key] ?? false}
                    onCheckedChange={(v) => toggle(p.key, v)}
                    disabled={!editable}
                  />
                </div>
              );
            })}
            <div className="flex items-start justify-between gap-4 rounded-md border border-dashed p-3 opacity-70">
              <div className="space-y-0.5">
                <div className="font-medium text-sm">Relatórios gerenciais</div>
                <div className="text-xs text-muted-foreground">
                  Acesso exclusivo de administradores.
                </div>
              </div>
              <Badge variant="secondary">Somente admin</Badge>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Vincula um login sem vínculo a um cliente já existente.
 * Ver linkAccountToClient em src/lib/users.functions.ts.
 */
function LinkAccountControl({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [clientId, setClientId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const reassignFn = useServerFn(linkAccountToClient);

  useEffect(() => {
    if (!open) return;
    setLoadingClients(true);
    // Sem filtro de "active": o cadastro certo do cliente costuma estar
    // justamente inativo (foi o motivo do autocadastro não achar o vínculo
    // por e-mail/telefone e criar um cliente novo duplicado).
    void fetchAll<{
      id: string;
      full_name: string;
      category_id: string | null;
      active: boolean;
    }>("clients", "id, full_name, category_id, active").then((data) => {
      setClients(
        data
          .sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1;
            return a.full_name.localeCompare(b.full_name, "pt-BR");
          })
          .map((c) => ({
            id: c.id,
            full_name: c.active ? c.full_name : `${c.full_name} (inativo)`,
            category_id: c.category_id,
          })),
      );
      setLoadingClients(false);
    });
  }, [open]);

  const handleSubmit = async () => {
    if (!clientId) {
      toast.error("Selecione o cliente correto");
      return;
    }
    setSubmitting(true);
    try {
      await reassignFn({ data: { userId: user.id, clientId } });
      toast.success("Conta vinculada ao cliente.");
      setOpen(false);
      setClientId("");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao reatribuir");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Vincular a cliente existente">
          <Link2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Vincular a cliente existente
          </DialogTitle>
          <DialogDescription>
            <>
              O login de <strong>{user.full_name || user.email}</strong> não está ligado a nenhum
              cadastro. Escolha o cliente correto: o login passa a acessar o portal do cliente
              como ele (e o cadastro é reativado, se estiver inativo).
            </>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {loadingClients ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando clientes...
            </div>
          ) : (
            <ClientCombobox
              clients={clients}
              value={clientId}
              onChange={setClientId}
              placeholder="Buscar cliente..."
              allowClear={false}
            />
          )}
          <Button className="w-full" disabled={submitting || !clientId} onClick={handleSubmit}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Vincular ao cliente
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordControl({ user }: { user: UserRow }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const resetFn = useServerFn(resetUserPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setSubmitting(true);
    try {
      await resetFn({ data: { userId: user.id, password } });
      toast.success("Senha redefinida!");
      setOpen(false);
      setPassword("");
      setConfirmPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao redefinir senha");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setPassword("");
          setConfirmPassword("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Redefinir senha">
          <KeyRound className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redefinir senha</DialogTitle>
          <DialogDescription>
            Defina uma nova senha para <strong>{user.full_name || user.email}</strong>. A senha
            atual deixa de funcionar imediatamente.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-pw">Nova senha (mín. 6 caracteres)</Label>
            <Input
              id="new-pw"
              type="password"
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-pw">Confirmar nova senha</Label>
            <Input
              id="confirm-pw"
              type="password"
              minLength={6}
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Redefinir senha
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Desbloqueia login preso em "e-mail não confirmado" — típico de contas
// criadas antes da migração pra Admin API (ver createStaffUser), cujo
// e-mail de confirmação nunca chegou a sair. Ação direta (sem diálogo):
// confirmar de novo uma conta já confirmada não tem efeito nenhum.
function ConfirmEmailControl({ user }: { user: UserRow }) {
  const [submitting, setSubmitting] = useState(false);
  const confirmFn = useServerFn(confirmUserEmail);

  const handleClick = async () => {
    setSubmitting(true);
    try {
      await confirmFn({ data: { userId: user.id } });
      toast.success("E-mail confirmado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao confirmar e-mail");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      title='Confirmar e-mail (resolve login preso em "e-mail não confirmado")'
      disabled={submitting}
      onClick={handleClick}
    >
      {submitting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <MailCheck className="h-4 w-4" />
      )}
    </Button>
  );
}

function WhatsAppReservationsSettings() {
  const { roles } = useAuth();
  const canEdit = roles.includes("admin") || roles.includes("diretoria");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "whatsapp_reservations_number")
      .maybeSingle()
      .then(({ data }) => {
        setPhone((data?.value as string) ?? "");
        setLoading(false);
      });
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "whatsapp_reservations_number", value: phone.trim() });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("WhatsApp oficial atualizado");
  };

  if (!canEdit) return null;
  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-emerald-600" />
          <h2 className="font-semibold">WhatsApp oficial para solicitações de reserva</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Número usado pelos clientes e professores ao clicar em um horário disponível no mapa.
          Inclua DDI e DDD (ex: 5588999999999).
        </p>
        <div className="flex gap-2 max-w-md">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="5588999999999"
            disabled={loading || saving}
          />
          <Button onClick={save} disabled={loading || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Professores que se cadastraram sozinhos pelo portal público
 * (/professor) e aguardam revisão da recepção/diretoria — ver
 * src/lib/pending-signups.functions.ts. A conta e o papel já existem;
 * aprovar/vincular só decide se o registro criado automaticamente no
 * autocadastro fica como está ou é substituído por um vínculo a um
 * professor/cliente já existente (evitando duplicar cadastro).
 */
function PendingSignupsCard({ onApproved }: { onApproved: () => void }) {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<PendingSignupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkDialog, setLinkDialog] = useState<PendingSignupRow | null>(null);
  const confirm = useConfirm();

  const listFn = useServerFn(listPendingSignups);
  const approveFn = useServerFn(approvePendingSignup);
  const rejectFn = useServerFn(rejectPendingSignup);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listFn();
      setRows(data as PendingSignupRow[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar cadastros pendentes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApprove = async (row: PendingSignupRow) => {
    setBusyId(row.user_id);
    try {
      await approveFn({ data: { userId: row.user_id } });
      toast.success("Cadastro aprovado.");
      await load();
      onApproved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aprovar");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (row: PendingSignupRow) => {
    const label = row.full_name || row.email || "este cadastro";
    if (
      !(await confirm(
        `Rejeitar e apagar o cadastro de ${label}?\n\nA conta de login criada será removida. Essa ação não pode ser desfeita.`,
      ))
    )
      return;
    setBusyId(row.user_id);
    try {
      await rejectFn({ data: { userId: row.user_id, kind: row.kind } });
      toast.success("Cadastro rejeitado e removido.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao rejeitar");
    } finally {
      setBusyId(null);
    }
  };

  if (!loading && rows.length === 0) return null;

  return (
    <Card className="border-amber-500/40">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <UserPlusIcon className="h-4 w-4 text-amber-600" />
          <h2 className="font-semibold">Cadastros pendentes de aprovação</h2>
          {rows.length > 0 && <Badge variant="secondary">{rows.length}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          Professores que se cadastraram sozinhos pelo portal público e aguardam revisão.
        </p>
        {loading ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando...
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.user_id}
                className="rounded-md border p-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {row.full_name || "—"}
                    <Badge variant="outline">
                      Professor
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.email}
                    {row.phone ? ` · ${row.phone}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {row.kind === "professor"
                      ? `Registro novo de professor criado: ${row.autoLinkedName ?? "—"}`
                      : `Casado automaticamente com o cliente: ${row.autoLinkedName ?? "—"}`}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setLinkDialog(row)}
                    disabled={busyId === row.user_id}
                  >
                    <Link2 className="h-4 w-4 mr-1" /> Vincular a existente
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleApprove(row)}
                    disabled={busyId === row.user_id}
                  >
                    {busyId === row.user_id ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Check className="h-4 w-4 mr-1" />
                    )}
                    Aprovar como novo
                  </Button>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleReject(row)}
                      disabled={busyId === row.user_id}
                    >
                      <Trash2 className="h-4 w-4 mr-1" /> Rejeitar
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {linkDialog && (
        <LinkPendingSignupDialog
          row={linkDialog}
          onClose={() => setLinkDialog(null)}
          onLinked={async () => {
            setLinkDialog(null);
            await load();
            onApproved();
          }}
        />
      )}
    </Card>
  );
}

function LinkPendingSignupDialog({
  row,
  onClose,
  onLinked,
}: {
  row: PendingSignupRow;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("");

  const linkTeacherFn = useServerFn(linkPendingSignupToTeacher);
  const linkClientFn = useServerFn(linkPendingSignupToClient);

  useEffect(() => {
    (async () => {
      setLoadingOptions(true);
      if (row.kind === "professor") {
        const { data } = await supabase.from("teachers").select("id, name").order("name");
        setTeachers((data ?? []) as { id: string; name: string }[]);
      } else {
        const data = await fetchAll<ClientOption & { active: boolean }>(
          "clients",
          "id, full_name, category_id, active",
        );
        setClients(
          data
            .filter((c) => c.active)
            .sort((a, b) => a.full_name.localeCompare(b.full_name, "pt-BR")),
        );
      }
      setLoadingOptions(false);
    })();
  }, [row.kind]);

  const confirmLink = async () => {
    setSaving(true);
    try {
      if (row.kind === "professor") {
        if (!teacherId) {
          toast.error("Escolha um professor");
          setSaving(false);
          return;
        }
        await linkTeacherFn({ data: { userId: row.user_id, teacherId } });
      } else {
        if (!clientId) {
          toast.error("Escolha um cliente");
          setSaving(false);
          return;
        }
        await linkClientFn({ data: { userId: row.user_id, clientId } });
      }
      toast.success("Cadastro vinculado e aprovado.");
      onLinked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao vincular");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular cadastro de {row.full_name}</DialogTitle>
          <DialogDescription>
            {row.kind === "professor"
              ? "Escolha o professor já cadastrado ao qual esse login deve ser vinculado. O registro novo criado automaticamente no autocadastro será removido."
              : "Escolha o cliente já cadastrado ao qual esse login deve ser vinculado."}
          </DialogDescription>
        </DialogHeader>
        {loadingOptions ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando...
          </div>
        ) : row.kind === "professor" ? (
          <Select value={teacherId} onValueChange={setTeacherId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o professor" />
            </SelectTrigger>
            <SelectContent>
              {teachers.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <ClientCombobox
            clients={clients}
            value={clientId}
            onChange={setClientId}
            allowClear={false}
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirmLink} disabled={saving || loadingOptions}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Vincular e aprovar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
