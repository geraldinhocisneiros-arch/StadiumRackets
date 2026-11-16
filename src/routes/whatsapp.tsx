import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  SkipForward,
  Trash2,
  Undo2,
} from "lucide-react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useConfirm } from "@/hooks/useConfirm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildWhatsAppUrl, openWhatsApp } from "@/lib/whatsapp";
import { fmtDate, fmtDateTime, toTitleCase } from "@/lib/format";

export const Route = createFileRoute("/whatsapp")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { lista?: string } => ({
    lista: typeof search.lista === "string" ? search.lista : undefined,
  }),
  head: () => ({
    meta: [{ title: "Envio WhatsApp • Stadium Rackets" }],
  }),
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <WhatsAppPage />
    </RequireAuth>
  ),
});

type EnvioStatus = "pendente" | "enviado" | "pulado" | "sem_telefone";

interface CampanhaRow {
  id: string;
  titulo: string;
  mensagem: string;
  arquivada: boolean;
  created_at: string;
  pendentes: number;
  enviados: number;
  pulados: number;
  sem_telefone: number;
}

interface EnvioRow {
  id: string;
  nome: string;
  telefone: string | null;
  ordem: number;
  status: EnvioStatus;
  atualizado_em: string | null;
  client_id: string | null;
  teacher_id: string | null;
}

interface Categoria {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<EnvioStatus, string> = {
  pendente: "Faltam",
  enviado: "Enviados",
  pulado: "Pulados",
  sem_telefone: "Sem telefone",
};

/** Troca {nome} pelo primeiro nome e {nome_completo} pelo nome inteiro. */
function montarMensagem(modelo: string, nome: string): string {
  const completo = toTitleCase(nome.trim());
  const primeiro = completo.split(/\s+/)[0] ?? completo;
  return modelo.replace(/\{nome_completo\}/gi, completo).replace(/\{nome\}/gi, primeiro);
}

const fmtTelefone = (t: string | null) => {
  if (!t) return "—";
  const d = t.startsWith("55") ? t.slice(2) : t;
  return d.length === 11
    ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : d.length === 10
      ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
      : t;
};

function WhatsAppPage() {
  const search = useSearch({ from: "/whatsapp" });
  const navigate = useNavigate();

  const abrirLista = (id: string | undefined) =>
    void navigate({ to: "/whatsapp", search: id ? { lista: id } : {}, replace: true });

  if (search.lista) {
    return <FilaEnvio campanhaId={search.lista} onVoltar={() => abrirLista(undefined)} />;
  }
  return <ListaCampanhas onAbrir={abrirLista} />;
}

// ---------------------------------------------------------------------------
// Lista de envios
// ---------------------------------------------------------------------------

function ListaCampanhas({ onAbrir }: { onAbrir: (id: string) => void }) {
  const { isAdmin, roles } = useAuth();
  const isDiretoria = isAdmin || roles.includes("diretoria");
  const confirm = useConfirm();
  const [rows, setRows] = useState<CampanhaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);
  const [verArquivadas, setVerArquivadas] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("whatsapp_campanhas_lista");
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows(
      ((data ?? []) as CampanhaRow[]).map((r) => ({
        ...r,
        pendentes: Number(r.pendentes),
        enviados: Number(r.enviados),
        pulados: Number(r.pulados),
        sem_telefone: Number(r.sem_telefone),
      })),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const arquivar = async (c: CampanhaRow) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("whatsapp_campanhas")
      .update({ arquivada: !c.arquivada })
      .eq("id", c.id);
    if (error) toast.error(error.message);
    await load();
  };

  const excluir = async (c: CampanhaRow) => {
    const ok = await confirm({
      title: "Excluir esta lista?",
      description:
        "Apaga a lista e o controle de quem já recebeu. As mensagens já enviadas continuam no WhatsApp.",
      confirmText: "Excluir",
      cancelText: "Voltar",
    });
    if (!ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("whatsapp_campanhas").delete().eq("id", c.id);
    if (error) toast.error(error.message);
    await load();
  };

  const visiveis = rows.filter((r) => r.arquivada === verArquivadas);
  const qtdArquivadas = rows.filter((r) => r.arquivada).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <MessageCircle className="h-6 w-6" /> Envio WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground">
            A mesma mensagem para um grupo, com o nome de cada um. Você envia um por um e pode parar
            e continuar depois.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
          </Button>
          <Button size="sm" onClick={() => setCriando(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nova lista de envio
          </Button>
        </div>
      </div>

      {qtdArquivadas > 0 && (
        <Tabs
          value={verArquivadas ? "arq" : "ativas"}
          onValueChange={(v) => setVerArquivadas(v === "arq")}
        >
          <TabsList>
            <TabsTrigger value="ativas">Em andamento</TabsTrigger>
            <TabsTrigger value="arq">Arquivadas ({qtdArquivadas})</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visiveis.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {verArquivadas
              ? "Nenhuma lista arquivada."
              : 'Nenhuma lista de envio. Use "Nova lista de envio" para começar.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visiveis.map((c) => {
            const total = c.pendentes + c.enviados + c.pulados;
            const feitos = c.enviados + c.pulados;
            const pct = total > 0 ? Math.round((feitos / total) * 100) : 0;
            return (
              <Card key={c.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base">{c.titulo}</CardTitle>
                      <CardDescription>Criada em {fmtDate(c.created_at)}</CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {c.pendentes === 0 && total > 0 && <Badge>Concluída</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>
                        <strong>{c.enviados}</strong> enviados · {c.pendentes} faltam
                        {c.pulados > 0 ? ` · ${c.pulados} pulados` : ""}
                        {c.sem_telefone > 0 ? ` · ${c.sem_telefone} sem telefone` : ""}
                      </span>
                      <span className="text-muted-foreground">{pct}%</span>
                    </div>
                    <Progress value={pct} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => onAbrir(c.id)}>
                      <MessageCircle className="h-4 w-4 mr-1" />
                      {c.pendentes > 0
                        ? feitos > 0
                          ? "Continuar envio"
                          : "Começar envio"
                        : "Abrir"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void arquivar(c)}>
                      {c.arquivada ? (
                        <>
                          <ArchiveRestore className="h-4 w-4 mr-1" /> Desarquivar
                        </>
                      ) : (
                        <>
                          <Archive className="h-4 w-4 mr-1" /> Arquivar
                        </>
                      )}
                    </Button>
                    {isDiretoria && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => void excluir(c)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" /> Excluir
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <NovaListaDialog
        open={criando}
        onClose={() => setCriando(false)}
        onCriada={(id) => {
          setCriando(false);
          onAbrir(id);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Criar lista
// ---------------------------------------------------------------------------

function NovaListaDialog({
  open,
  onClose,
  onCriada,
}: {
  open: boolean;
  onClose: () => void;
  onCriada: (id: string) => void;
}) {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [semCategoria, setSemCategoria] = useState(false);
  const [professores, setProfessores] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [previa, setPrevia] = useState<{
    com: number;
    sem: number;
    exemplo: string | null;
  } | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Carrega as categorias e reinicia o formulário.
  useEffect(() => {
    if (!open) return;
    setSelecionadas([]);
    setSemCategoria(false);
    setProfessores(false);
    setPrevia(null);
    setTitulo("");
    setMensagem("Olá {nome}, tudo bem? Aqui é da Stadium Rackets.\n\n");
    void supabase
      .from("client_categories")
      .select("id, name")
      .eq("active", true)
      .eq("is_demo", false)
      .order("name")
      .then(({ data }) => setCategorias((data ?? []) as Categoria[]));
  }, [open]);

  const temFiltro = selecionadas.length > 0 || semCategoria || professores;

  // Prévia de quantos recebem, a cada mudança de filtro.
  useEffect(() => {
    if (!open || !temFiltro) {
      setPrevia(null);
      return;
    }
    let ativo = true;
    setCarregandoPrevia(true);
    const t = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (supabase as any)
        .rpc("whatsapp_campanha_previa", {
          _categoria_ids: selecionadas,
          _sem_categoria: semCategoria,
          _professores: professores,
        })
        .then(
          ({
            data,
            error,
          }: {
            data: { com_telefone: number; sem_telefone: number; exemplo_nome: string | null }[];
            error: { message: string } | null;
          }) => {
            if (!ativo) return;
            setCarregandoPrevia(false);
            if (error) {
              toast.error(error.message);
              return;
            }
            const r = data?.[0];
            setPrevia(
              r
                ? {
                    com: Number(r.com_telefone),
                    sem: Number(r.sem_telefone),
                    exemplo: r.exemplo_nome,
                  }
                : null,
            );
          },
        );
    }, 300);
    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [open, temFiltro, selecionadas, semCategoria, professores]);

  const criar = async () => {
    if (!titulo.trim() || !mensagem.trim() || !temFiltro) return;
    setSalvando(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("whatsapp_campanha_criar", {
        _titulo: titulo.trim(),
        _mensagem: mensagem,
        _categoria_ids: selecionadas,
        _sem_categoria: semCategoria,
        _professores: professores,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      onCriada(data as string);
    } finally {
      setSalvando(false);
    }
  };

  const toggleCat = (id: string, on: boolean) =>
    setSelecionadas((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));

  const todas = categorias.length > 0 && selecionadas.length === categorias.length && semCategoria;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !salvando && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Nova lista de envio</DialogTitle>
          <DialogDescription>Escolha quem recebe e escreva a mensagem.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wa-titulo">Nome da lista (só para controle interno)</Label>
            <Input
              id="wa-titulo"
              value={titulo}
              maxLength={120}
              placeholder="Ex.: Reajuste mensalistas janeiro"
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Quem recebe</Label>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => {
                    if (todas) {
                      setSelecionadas([]);
                      setSemCategoria(false);
                    } else {
                      setSelecionadas(categorias.map((c) => c.id));
                      setSemCategoria(true);
                    }
                  }}
                >
                  {todas ? "Desmarcar todas" : "Marcar todas"}
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3">
                {categorias.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selecionadas.includes(c.id)}
                      onCheckedChange={(v) => toggleCat(c.id, v === true)}
                    />
                    {c.name}
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={semCategoria}
                    onCheckedChange={(v) => setSemCategoria(v === true)}
                  />
                  Clientes sem categoria
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer font-medium">
                  <Checkbox
                    checked={professores}
                    onCheckedChange={(v) => setProfessores(v === true)}
                  />
                  Professores
                </label>
              </div>
            </div>

          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            {!temFiltro ? (
              <span className="text-muted-foreground">Escolha pelo menos um grupo.</span>
            ) : carregandoPrevia || !previa ? (
              <span className="text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Contando…
              </span>
            ) : (
              <span>
                <strong>{previa.com}</strong> vão receber
                {previa.sem > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {previa.sem} sem telefone ficam numa lista à parte para corrigir o cadastro
                  </span>
                )}
                {previa.com > 150 && (
                  <span className="block text-xs text-muted-foreground mt-1">
                    São muitos envios: dá para parar a qualquer momento e continuar depois.
                  </span>
                )}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="wa-msg">Mensagem</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setMensagem((m) => m + "{nome}")}
                >
                  + {"{nome}"}
                </Button>
              </div>
            </div>
            <Textarea
              id="wa-msg"
              rows={8}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {"{nome}"} vira o primeiro nome da pessoa. Para negrito no WhatsApp use *assim*.
            </p>
          </div>

          {previa?.exemplo && mensagem.trim() && (
            <div className="space-y-1.5">
              <Label>Como chega para {toTitleCase(previa.exemplo)}</Label>
              <div className="rounded-lg bg-[#dcf8c6] dark:bg-emerald-900/40 p-3 text-sm whitespace-pre-line max-h-48 overflow-auto">
                {montarMensagem(mensagem, previa.exemplo)}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={() => void criar()}
            disabled={salvando || !titulo.trim() || !mensagem.trim() || !temFiltro || !previa?.com}
          >
            {salvando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Criar lista{previa?.com ? ` (${previa.com})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Fila de envio
// ---------------------------------------------------------------------------

async function carregarEnvios(campanhaId: string): Promise<EnvioRow[]> {
  // O Supabase devolve no máximo 1000 linhas por vez; lista grande vem em partes.
  const out: EnvioRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("whatsapp_campanha_envios")
      .select("id, nome, telefone, ordem, status, atualizado_em, client_id, teacher_id")
      .eq("campanha_id", campanhaId)
      .order("ordem")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as EnvioRow[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function FilaEnvio({ campanhaId, onVoltar }: { campanhaId: string; onVoltar: () => void }) {
  const [campanha, setCampanha] = useState<{ titulo: string; mensagem: string } | null>(null);
  const [envios, setEnvios] = useState<EnvioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState<EnvioStatus>("pendente");
  const [busca, setBusca] = useState("");
  const [ultimo, setUltimo] = useState<EnvioRow | null>(null);
  const [editandoMsg, setEditandoMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("whatsapp_campanhas")
        .select("titulo, mensagem")
        .eq("id", campanhaId)
        .maybeSingle();
      if (error || !data) {
        toast.error(error?.message ?? "Lista não encontrada.");
        return;
      }
      setCampanha(data);
      setEnvios(await carregarEnvios(campanhaId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [campanhaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const contagem = useMemo(() => {
    const c: Record<EnvioStatus, number> = { pendente: 0, enviado: 0, pulado: 0, sem_telefone: 0 };
    for (const e of envios) c[e.status]++;
    return c;
  }, [envios]);

  const proximo = useMemo(() => envios.find((e) => e.status === "pendente") ?? null, [envios]);
  const total = contagem.pendente + contagem.enviado + contagem.pulado;
  const pct = total > 0 ? Math.round(((contagem.enviado + contagem.pulado) / total) * 100) : 0;

  const marcar = async (e: EnvioRow, status: EnvioStatus) => {
    // Otimista: a fila anda na hora; se o banco recusar, volta.
    const anterior = e.status;
    setEnvios((prev) => prev.map((x) => (x.id === e.id ? { ...x, status } : x)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("whatsapp_envio_marcar", {
      _envio_id: e.id,
      _status: status,
    });
    if (error) {
      toast.error(error.message);
      setEnvios((prev) => prev.map((x) => (x.id === e.id ? { ...x, status: anterior } : x)));
    }
  };

  const enviar = (e: EnvioRow) => {
    if (!campanha || !e.telefone) return;
    openWhatsApp(buildWhatsAppUrl(e.telefone, montarMensagem(campanha.mensagem, e.nome)));
    setUltimo(e);
    if (e.status !== "enviado") void marcar(e, "enviado");
  };

  const pular = (e: EnvioRow) => {
    setUltimo(e);
    void marcar(e, "pulado");
  };

  const desfazer = () => {
    if (!ultimo) return;
    void marcar(ultimo, "pendente");
    setUltimo(null);
  };

  const salvarMensagem = async () => {
    if (editandoMsg == null || !editandoMsg.trim()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("whatsapp_campanhas")
      .update({ mensagem: editandoMsg, updated_at: new Date().toISOString() })
      .eq("id", campanhaId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setCampanha((c) => (c ? { ...c, mensagem: editandoMsg } : c));
    setEditandoMsg(null);
    toast.success("Mensagem atualizada para os próximos envios.");
  };

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return envios.filter(
      (e) =>
        e.status === aba &&
        (!q || e.nome.toLowerCase().includes(q) || (e.telefone ?? "").includes(q)),
    );
  }, [envios, aba, busca]);

  if (loading && !campanha) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!campanha) {
    return (
      <Button variant="outline" onClick={onVoltar}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={onVoltar} aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold truncate">{campanha.titulo}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
        </Button>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span>
            <strong>{contagem.enviado}</strong> enviados · {contagem.pendente} faltam
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={pct} />
      </div>

      {/* Próximo da fila */}
      <Card className="border-primary/40">
        <CardContent className="pt-6 space-y-3">
          {proximo ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Próximo</div>
                  <div className="text-lg font-semibold">{toTitleCase(proximo.nome)}</div>
                  <div className="text-sm text-muted-foreground">
                    {fmtTelefone(proximo.telefone)}
                    {proximo.teacher_id ? " · professor" : ""}
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-[#dcf8c6] dark:bg-emerald-900/40 p-3 text-sm whitespace-pre-line max-h-40 overflow-auto">
                {montarMensagem(campanha.mensagem, proximo.nome)}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="lg" className="flex-1 sm:flex-none" onClick={() => enviar(proximo)}>
                  <MessageCircle className="h-5 w-5 mr-2" /> Abrir WhatsApp e marcar enviado
                </Button>
                <Button size="lg" variant="outline" onClick={() => pular(proximo)}>
                  <SkipForward className="h-4 w-4 mr-1" /> Pular
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                O WhatsApp abre com a mensagem pronta: aperte enviar lá e volte aqui para o próximo.
              </p>
            </>
          ) : (
            <div className="text-center py-4">
              <div className="font-semibold">Fila concluída 🎉</div>
              {contagem.pulado > 0 && (
                <div className="text-sm text-muted-foreground">
                  {contagem.pulado} pulados ficam na aba "Pulados", se quiser enviar depois.
                </div>
              )}
            </div>
          )}
          {ultimo && (
            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
              <span>
                Último: <strong>{toTitleCase(ultimo.nome)}</strong>
              </span>
              <Button size="sm" variant="ghost" onClick={desfazer}>
                <Undo2 className="h-4 w-4 mr-1" /> Desfazer (não enviei)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mensagem */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Mensagem</CardTitle>
            {editandoMsg == null ? (
              <Button size="sm" variant="ghost" onClick={() => setEditandoMsg(campanha.mensagem)}>
                Editar
              </Button>
            ) : (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditandoMsg(null)}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={() => void salvarMensagem()}>
                  Salvar
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editandoMsg == null ? (
            <p className="text-sm whitespace-pre-line text-muted-foreground">{campanha.mensagem}</p>
          ) : (
            <Textarea
              rows={7}
              value={editandoMsg}
              onChange={(e) => setEditandoMsg(e.target.value)}
            />
          )}
        </CardContent>
      </Card>

      {/* Lista completa */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={aba} onValueChange={(v) => setAba(v as EnvioStatus)}>
          <TabsList className="flex-wrap h-auto">
            {(Object.keys(STATUS_LABEL) as EnvioStatus[]).map((s) => (
              <TabsTrigger key={s} value={s}>
                {STATUS_LABEL[s]} ({contagem[s]})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          placeholder="Buscar nome ou telefone"
          className="w-56"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      <div className="border rounded-md overflow-auto max-h-[60vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              {(aba === "enviado" || aba === "pulado") && <TableHead>Quando</TableHead>}
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  Ninguém aqui.
                </TableCell>
              </TableRow>
            ) : (
              visiveis.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{toTitleCase(e.nome)}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {fmtTelefone(e.telefone)}
                  </TableCell>
                  {(aba === "enviado" || aba === "pulado") && (
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {fmtDateTime(e.atualizado_em)}
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap text-right">
                    {e.status === "sem_telefone" ? (
                      <span className="text-xs text-muted-foreground">Corrigir no cadastro</span>
                    ) : e.status === "enviado" ? (
                      <Button size="sm" variant="ghost" onClick={() => enviar(e)}>
                        Reenviar
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => enviar(e)}>
                        <MessageCircle className="h-4 w-4 mr-1" /> Enviar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
