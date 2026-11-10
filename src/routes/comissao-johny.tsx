import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, ChevronDown, ChevronRight } from "lucide-react";
import * as XLSX from "xlsx";
import { fmtBRL, normalizeText } from "@/lib/format";
import { fetchAll } from "@/lib/fetchAll";

// Comissão do professor Johny Lourenço: 10% do crédito UTILIZADO no mês
// pelos clientes vinculados a ele — não do que foi creditado (depositado).
//
// "Utilizado" = débitos lançados na conta corrente do cliente no mês
// (quadra, luz etc.), mesmo que o saldo fique negativo. Ficam de fora:
//  - transferências de saldo para outro cliente (não é consumo);
//  - "Saldo anterior" (dívida trazida de antes, não é consumo do mês).
// Estornos (crédito lançado com a categoria "Estorno") devolvem consumo
// cobrado, então são abatidos da base.
//
// Cliente vinculado = professor principal no cadastro (clients.teacher_id)
// ou vínculo adicional (client_teachers). O vínculo considerado é o ATUAL.

export const COMMISSION_PERCENT = 10;
const TEACHER_NAME_MATCH = "johny";

export const Route = createFileRoute("/comissao-johny")({
  ssr: false,
  head: () => ({ meta: [{ title: "Comissão Johny • Stadium Rackets" }] }),
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria"]}>
      <ComissaoJohnyPage />
    </RequireAuth>
  ),
});

interface Teacher {
  id: string;
  name: string;
}
interface LinkedClient {
  id: string;
  full_name: string;
  active: boolean;
}
interface Entry {
  id: string;
  client_id: string;
  entry_type: "debito" | "credito";
  amount: number;
  description: string;
  entry_date: string;
  created_at: string;
  payments: { client_categories: { name: string } | null } | null;
}

type Kind = "uso" | "estorno" | "credito" | "transferencia" | "saldo_anterior";

const KIND_LABEL: Record<Kind, string> = {
  uso: "Uso (conta)",
  estorno: "Estorno (abate)",
  credito: "Crédito (não conta)",
  transferencia: "Transferência (não conta)",
  saldo_anterior: "Saldo anterior (não conta)",
};

function classify(e: Entry): Kind {
  const cat = normalizeText(e.payments?.client_categories?.name ?? "");
  const desc = normalizeText(e.description);
  const isTransfer = desc.includes("transferido para") || desc.includes("recebido de");
  if (e.entry_type === "debito") {
    if (isTransfer) return "transferencia";
    if (cat === "saldo anterior") return "saldo_anterior";
    return "uso";
  }
  if (cat === "estorno") return "estorno";
  if (isTransfer) return "transferencia";
  return "credito";
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(ym: string): [string, string] {
  const [y, m] = ym.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return [`${ym}-01`, end];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function ComissaoJohnyPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [clients, setClients] = useState<LinkedClient[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("teachers").select("id, name").order("name");
      const list = (data ?? []) as Teacher[];
      setTeachers(list);
      const johny = list.find((t) => normalizeText(t.name).includes(TEACHER_NAME_MATCH));
      if (johny) setTeacherId(johny.id);
    })();
  }, []);

  useEffect(() => {
    if (!teacherId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [start, endExcl] = monthRange(month);
        const [principal, adicional] = await Promise.all([
          supabase.from("clients").select("id, full_name, active").eq("teacher_id", teacherId),
          supabase
            .from("client_teachers")
            .select("clients!client_id(id, full_name, active)")
            .eq("teacher_id", teacherId),
        ]);
        if (principal.error) throw principal.error;
        if (adicional.error) throw adicional.error;
        const byId = new Map<string, LinkedClient>();
        ((principal.data ?? []) as LinkedClient[]).forEach((c) => byId.set(c.id, c));
        ((adicional.data ?? []) as Array<{ clients: LinkedClient | null }>).forEach((r) => {
          if (r.clients) byId.set(r.clients.id, r.clients);
        });
        const linked = Array.from(byId.values());
        const ids = linked.map((c) => c.id);

        let ents: Entry[] = [];
        // Em lotes para não estourar o tamanho da URL do filtro "in".
        for (let i = 0; i < ids.length; i += 150) {
          const chunk = ids.slice(i, i + 150);
          const rows = await fetchAll<Entry>(
            "account_entries",
            "id, client_id, entry_type, amount, description, entry_date, created_at, payments(client_categories!payments_category_id_fkey(name))",
            {
              build: (q) =>
                q
                  .in("client_id", chunk)
                  .gte("entry_date", start)
                  .lt("entry_date", endExcl)
                  .order("entry_date")
                  .order("created_at"),
            },
          );
          ents = ents.concat(rows);
        }
        if (cancelled) return;
        setClients(linked);
        setEntries(ents);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teacherId, month]);

  const rows = useMemo(() => {
    const byClient = new Map<string, Entry[]>();
    entries.forEach((e) => {
      const arr = byClient.get(e.client_id) ?? [];
      arr.push(e);
      byClient.set(e.client_id, arr);
    });
    return clients
      .map((c) => {
        const list = byClient.get(c.id) ?? [];
        let usado = 0;
        let estornos = 0;
        let creditado = 0;
        list.forEach((e) => {
          const k = classify(e);
          const v = Number(e.amount);
          if (k === "uso") usado += v;
          else if (k === "estorno") estornos += v;
          else if (k === "credito") creditado += v;
        });
        const base = round2(usado - estornos);
        return {
          client: c,
          entries: list,
          usado: round2(usado),
          estornos: round2(estornos),
          creditado: round2(creditado),
          base,
          comissao: round2((base * COMMISSION_PERCENT) / 100),
        };
      })
      .filter((r) => r.entries.length > 0)
      .sort((a, b) => b.base - a.base || a.client.full_name.localeCompare(b.client.full_name));
  }, [clients, entries]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({
          creditado: t.creditado + r.creditado,
          usado: t.usado + r.usado,
          estornos: t.estornos + r.estornos,
          base: t.base + r.base,
          comissao: t.comissao + r.comissao,
        }),
        { creditado: 0, usado: 0, estornos: 0, base: 0, comissao: 0 },
      ),
    [rows],
  );

  const teacherName = teachers.find((t) => t.id === teacherId)?.name ?? "Johny";
  const johnyFound = teachers.some((t) => normalizeText(t.name).includes(TEACHER_NAME_MATCH));

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleExport = () => {
    const resumo = rows.map((r) => ({
      Cliente: r.client.full_name,
      "Creditado no mês (R$)": r.creditado,
      "Utilizado (R$)": r.usado,
      "Estornos (R$)": r.estornos,
      "Base da comissão (R$)": r.base,
      [`Comissão ${COMMISSION_PERCENT}% (R$)`]: r.comissao,
    }));
    resumo.push({
      Cliente: "TOTAL",
      "Creditado no mês (R$)": round2(totals.creditado),
      "Utilizado (R$)": round2(totals.usado),
      "Estornos (R$)": round2(totals.estornos),
      "Base da comissão (R$)": round2(totals.base),
      [`Comissão ${COMMISSION_PERCENT}% (R$)`]: round2(totals.comissao),
    });
    const names = new Map(clients.map((c) => [c.id, c.full_name]));
    const lancamentos = entries.map((e) => ({
      Data: e.entry_date,
      Cliente: names.get(e.client_id) ?? "",
      Tipo: e.entry_type === "debito" ? "Débito" : "Crédito",
      Descrição: e.description,
      Categoria: e.payments?.client_categories?.name ?? "",
      "Valor (R$)": Number(e.amount),
      Classificação: KIND_LABEL[classify(e)],
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Resumo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lancamentos), "Lançamentos");
    XLSX.writeFile(wb, `comissao-johny-${month}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Comissão {teacherName}</h1>
          <p className="text-muted-foreground">
            {COMMISSION_PERCENT}% sobre o crédito <strong>utilizado</strong> no mês pelos clientes
            vinculados — não sobre o que foi creditado. Saldo negativo continua contando.
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={!teacherId || loading || rows.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Baixar Excel
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Mês</Label>
            <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </div>
          {!johnyFound && (
            <div className="space-y-2">
              <Label>Professor</Label>
              <Select value={teacherId} onValueChange={setTeacherId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o Johny" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Nenhum professor com "Johny" no nome foi encontrado em{" "}
                <Link to="/professores" className="underline">
                  Professores
                </Link>
                .
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat title="Creditado no mês (referência)" value={fmtBRL(totals.creditado)} />
        <Stat title="Crédito utilizado (base)" value={fmtBRL(totals.base)} />
        <Stat title={`Comissão a pagar (${COMMISSION_PERCENT}%)`} value={fmtBRL(totals.comissao)} accent />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clientes vinculados com movimento no mês</CardTitle>
          <CardDescription>
            Conta: débitos da conta corrente (quadra, luz etc.). Não conta: créditos/depósitos,
            transferências entre clientes e "Saldo anterior". Estornos abatem a base. Clique no
            cliente para conferir cada lançamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="py-6 text-center text-destructive text-sm">Erro ao carregar: {error}</div>
          ) : loading ? (
            <div className="py-6 text-center text-muted-foreground text-sm">Carregando...</div>
          ) : !teacherId ? (
            <div className="py-6 text-center text-muted-foreground text-sm">Selecione o professor.</div>
          ) : rows.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">
              Nenhum movimento dos {clients.length} clientes vinculados neste mês.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Creditado</TableHead>
                    <TableHead className="text-right">Utilizado</TableHead>
                    <TableHead className="text-right">Estornos</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Comissão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isOpen = open.has(r.client.id);
                    return [
                      <TableRow key={r.client.id} className="cursor-pointer" onClick={() => toggle(r.client.id)}>
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-1">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            {r.client.full_name}
                          </span>
                          {!r.client.active && <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtBRL(r.creditado)}</TableCell>
                        <TableCell className="text-right">{fmtBRL(r.usado)}</TableCell>
                        <TableCell className="text-right">{r.estornos ? `− ${fmtBRL(r.estornos)}` : "—"}</TableCell>
                        <TableCell className="text-right">{fmtBRL(r.base)}</TableCell>
                        <TableCell className="text-right font-semibold text-success">{fmtBRL(r.comissao)}</TableCell>
                      </TableRow>,
                      isOpen && (
                        <TableRow key={`${r.client.id}-detail`} className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={6}>
                            <div className="flex justify-end mb-2">
                              <Link
                                to="/clientes/$clientId"
                                params={{ clientId: r.client.id }}
                                className="text-xs underline"
                              >
                                Abrir ficha do cliente
                              </Link>
                            </div>
                            <div className="space-y-1">
                              {r.entries.map((e) => {
                                const k = classify(e);
                                return (
                                  <div key={e.id} className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="w-20 text-muted-foreground">{e.entry_date.split("-").reverse().join("/")}</span>
                                    <span className="flex-1 min-w-40">{e.description}</span>
                                    <Badge
                                      variant="outline"
                                      className={
                                        k === "uso"
                                          ? "text-[10px] bg-green-500/10 text-green-700 border-green-500/40"
                                          : k === "estorno"
                                            ? "text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/40"
                                            : "text-[10px]"
                                      }
                                    >
                                      {KIND_LABEL[k]}
                                    </Badge>
                                    <span
                                      className={`w-24 text-right ${e.entry_type === "debito" ? "text-destructive" : "text-success"}`}
                                    >
                                      {e.entry_type === "debito" ? "−" : "+"} {fmtBRL(Number(e.amount))}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </TableCell>
                        </TableRow>
                      ),
                    ];
                  })}
                  <TableRow className="font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtBRL(totals.creditado)}</TableCell>
                    <TableCell className="text-right">{fmtBRL(totals.usado)}</TableCell>
                    <TableCell className="text-right">
                      {totals.estornos ? `− ${fmtBRL(totals.estornos)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">{fmtBRL(totals.base)}</TableCell>
                    <TableCell className="text-right text-success">{fmtBRL(totals.comissao)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ title, value, accent }: { title: string; value: string; accent?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className={`text-2xl font-bold mt-1 ${accent ? "text-success" : ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
