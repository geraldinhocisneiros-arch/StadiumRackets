import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle } from "lucide-react";
import { fetchAll } from "@/lib/fetchAll";
import { normalizeText } from "@/lib/format";

export const Route = createFileRoute("/professores/vinculos")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Auditoria de vínculos • Stadium Rackets" }],
  }),
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <VinculosAuditoriaPage />
    </RequireAuth>
  ),
});

interface Client {
  id: string;
  full_name: string;
  active: boolean;
  teacher_id: string | null;
}
interface Teacher {
  id: string;
  name: string;
  active: boolean;
}
interface ClientTeacherLink {
  client_id: string;
  teacher_id: string;
}
interface ScheduleTeacher {
  client_id: string;
  teacher_id: string | null;
}

interface Row {
  clientId: string;
  clientName: string;
  clientActive: boolean;
  principal: Teacher | null;
  adicionais: Teacher[];
  soHorarioFixo: Teacher[];
  inconsistente: boolean;
}

function VinculosAuditoriaPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [clients, teachers, links, schedules] = await Promise.all([
        fetchAll<Client>("clients", "id, full_name, active, teacher_id"),
        fetchAll<Teacher>("teachers", "id, name, active"),
        fetchAll<ClientTeacherLink>("client_teachers", "client_id, teacher_id"),
        fetchAll<ScheduleTeacher>("client_schedules", "client_id, teacher_id"),
      ]);

      const teacherById = new Map(teachers.map((t) => [t.id, t]));

      const additionalByClient = new Map<string, Set<string>>();
      links.forEach((l) => {
        const set = additionalByClient.get(l.client_id) ?? new Set<string>();
        set.add(l.teacher_id);
        additionalByClient.set(l.client_id, set);
      });

      const scheduleByClient = new Map<string, Set<string>>();
      schedules.forEach((s) => {
        if (!s.teacher_id) return;
        const set = scheduleByClient.get(s.client_id) ?? new Set<string>();
        set.add(s.teacher_id);
        scheduleByClient.set(s.client_id, set);
      });

      const built: Row[] = [];
      clients.forEach((c) => {
        const principal = c.teacher_id ? (teacherById.get(c.teacher_id) ?? null) : null;
        const additionalIds = additionalByClient.get(c.id) ?? new Set<string>();
        const scheduleIds = scheduleByClient.get(c.id) ?? new Set<string>();

        // Não repete o principal na lista de "adicionais" (o backfill inicial
        // grava o professor principal também em client_teachers).
        const adicionais = [...additionalIds]
          .filter((id) => id !== c.teacher_id)
          .map((id) => teacherById.get(id))
          .filter((t): t is Teacher => !!t);

        const coveredIds = new Set<string>([
          ...(c.teacher_id ? [c.teacher_id] : []),
          ...additionalIds,
        ]);
        const soHorarioFixo = [...scheduleIds]
          .filter((id) => !coveredIds.has(id))
          .map((id) => teacherById.get(id))
          .filter((t): t is Teacher => !!t);

        // Nada vinculado de nenhuma forma — não é relevante pra auditoria.
        if (!principal && adicionais.length === 0 && soHorarioFixo.length === 0) return;

        built.push({
          clientId: c.id,
          clientName: c.full_name,
          clientActive: c.active,
          principal,
          adicionais,
          soHorarioFixo,
          // Sinaliza pra revisão: alguém dá aula fixa pro cliente sem ele
          // estar formalmente vinculado (nem principal, nem adicional) a
          // esse professor.
          inconsistente: soHorarioFixo.length > 0,
        });
      });

      built.sort((a, b) => {
        if (a.inconsistente !== b.inconsistente) return a.inconsistente ? -1 : 1;
        return a.clientName.localeCompare(b.clientName, "pt-BR");
      });

      setRows(built);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const terms = normalizeText(search).split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      if (onlyFlagged && !r.inconsistente) return false;
      if (terms.length === 0) return true;
      const name = normalizeText(r.clientName);
      return terms.every((t) => name.includes(t));
    });
  }, [rows, search, onlyFlagged]);

  const flaggedCount = rows.filter((r) => r.inconsistente).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Auditoria de vínculos</h1>
        <p className="text-muted-foreground">
          Cruza as três formas de vínculo entre cliente e professor — professor principal do
          cadastro, vínculo adicional e horário fixo — para todos os clientes de uma vez, e
          destaca quem tem aula fixa com um professor ao qual não está formalmente vinculado.
          Gerencie vínculos em{" "}
          <Link to="/clientes" className="underline">Clientes</Link> e solicitações pendentes em{" "}
          <Link to="/vinculos-professor" className="underline">Vínculos de professor</Link>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {flaggedCount > 0 ? (
              <span className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                {flaggedCount} cliente(s) para revisar
              </span>
            ) : (
              "Nenhuma inconsistência encontrada"
            )}
          </CardTitle>
          <CardDescription>
            "Para revisar" = o cliente tem aula fixa com um professor que não é nem o principal
            do cadastro, nem um vínculo adicional. Pode ser normal (substituição pontual) ou pode
            ser um cadastro desatualizado — confira caso a caso.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <Input
              placeholder="Buscar por nome do cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <div className="flex items-center gap-2">
              <Switch id="onlyFlagged" checked={onlyFlagged} onCheckedChange={setOnlyFlagged} />
              <Label htmlFor="onlyFlagged" className="cursor-pointer">
                Mostrar só para revisar
              </Label>
            </div>
          </div>

          {loading ? (
            <div className="py-12 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhum cliente encontrado.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Professor principal</TableHead>
                    <TableHead>Vínculo adicional</TableHead>
                    <TableHead>Só via horário fixo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.clientId} className={r.inconsistente ? "bg-amber-500/5" : undefined}>
                      <TableCell>
                        <Link
                          to="/clientes/$clientId"
                          params={{ clientId: r.clientId }}
                          className="font-medium hover:underline"
                        >
                          {r.clientName}
                        </Link>
                        {!r.clientActive && (
                          <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.principal ? (
                          <Badge variant="outline">
                            {r.principal.name}
                            {!r.principal.active ? " (inativo)" : ""}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.adicionais.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            r.adicionais.map((t) => (
                              <Badge
                                key={t.id}
                                variant="outline"
                                className="bg-blue-500/10 text-blue-700 border-blue-500/40"
                              >
                                {t.name}
                                {!t.active ? " (inativo)" : ""}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.soHorarioFixo.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            r.soHorarioFixo.map((t) => (
                              <Badge
                                key={t.id}
                                variant="outline"
                                className="bg-amber-500/10 text-amber-700 border-amber-500/40"
                              >
                                {t.name}
                                {!t.active ? " (inativo)" : ""}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
