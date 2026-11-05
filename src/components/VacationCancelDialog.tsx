import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Loader2, PlaneTakeoff } from "lucide-react";
import { WEEKDAY_LABELS, fmtHours } from "@/lib/pricing";
import {
  buildWhatsAppUrl,
  logWhatsAppSent,
  normalizePhoneForWhatsApp,
  openWhatsApp,
} from "@/lib/whatsapp";
import { courtShort } from "@/lib/court-map";

interface Schedule {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  court: number | null;
}

const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const timeShort = (t: string) => t.slice(0, 5);

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function fmtBRDate(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR").format(d);
}

export function VacationCancelDialog({
  clientId,
  schedules,
  open,
  onOpenChange,
  onSaved,
}: {
  clientId: string;
  schedules: Schedule[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [dates, setDates] = useState<Date[]>([]);
  const [selectedScheduleIds, setSelectedScheduleIds] = useState<Set<string>>(
    new Set(schedules.map((s) => s.id)),
  );
  const [reason, setReason] = useState("Férias / viagem");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDates([]);
      setSelectedScheduleIds(new Set(schedules.map((s) => s.id)));
      setReason("Férias / viagem");
    }
  }, [open, schedules]);

  const toggleSchedule = (id: string) => {
    setSelectedScheduleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Preview: para cada data selecionada, mostra quais horários serão cancelados
  const preview = useMemo(() => {
    const rows: { date: Date; items: Schedule[] }[] = [];
    const selectedSchedules = schedules.filter((s) => selectedScheduleIds.has(s.id));
    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
    for (const d of sorted) {
      const wd = d.getDay();
      const items = selectedSchedules.filter((s) => s.weekday === wd);
      if (items.length) rows.push({ date: d, items });
    }
    return rows;
  }, [dates, schedules, selectedScheduleIds]);

  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

  const totalMinutes = preview.reduce((acc, r) => {
    for (const s of r.items) {
      acc += Math.max(0, toMin(s.end_time) - toMin(s.start_time));
    }
    return acc;
  }, 0);

  const submit = async () => {
    if (!preview.length) {
      toast.error("Selecione ao menos uma data que corresponda aos horários.");
      return;
    }
    setBusy(true);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;

    // Uma exceção "dia inteiro" por horário fixo/data — libera o horário
    // fixo por completo (mesmo padrão do cancelamento normal de um dia),
    // sem depender de minutos fechados em horas cheias.
    const rows: {
      client_schedule_id: string;
      exception_date: string;
      start_time: null;
      end_time: null;
      reason: string;
      created_by: string | null;
    }[] = [];
    for (const p of preview) {
      const iso = toIsoDate(p.date);
      for (const s of p.items) {
        rows.push({
          client_schedule_id: s.id,
          exception_date: iso,
          start_time: null,
          end_time: null,
          reason: reason.trim() || "Férias / viagem",
          created_by: userId,
        });
      }
    }

    const { error } = await supabase.from("client_schedule_exceptions").insert(rows);
    if (error) {
      setBusy(false);
      toast.error(`Falha ao cancelar: ${error.message}`);
      return;
    }

    setBusy(false);
    toast.success(
      `${preview.length} data(s) cancelada(s) — ${fmtHours(totalMinutes)} liberada(s).`,
    );

    // Busca dados do cliente para montar mensagem de WhatsApp
    const { data: client } = await supabase
      .from("clients")
      .select("full_name, phone, financial_responsible")
      .eq("id", clientId)
      .maybeSingle();

    if (client) {
      let recipientPhone = client.phone;
      let recipientFirstName = client.full_name.split(" ")[0];
      let dependentFirstName: string | null = null;

      if (client.financial_responsible && client.financial_responsible.trim()) {
        const { data: respRows } = await supabase
          .from("clients")
          .select("full_name, phone")
          .ilike("full_name", client.financial_responsible.trim())
          .limit(1);
        const resp = respRows?.[0];
        if (resp && normalizePhoneForWhatsApp(resp.phone)) {
          recipientPhone = resp.phone;
          recipientFirstName = resp.full_name.split(" ")[0];
          dependentFirstName = client.full_name.split(" ")[0];
        }
      }

      const phone = normalizePhoneForWhatsApp(recipientPhone);
      if (!phone) {
        toast.info("Cliente sem telefone — cancelamento concluído sem WhatsApp.");
        onSaved();
        onOpenChange(false);
        return;
      }

      const linhas = preview.map((p) => {
        const dia = fmtBRDate(p.date);
        const wd = WEEKDAY_SHORT[p.date.getDay()];
        const horas = p.items
          .map((s) => `${timeShort(s.start_time)}–${timeShort(s.end_time)}`)
          .join(", ");
        return `• ${dia} (${wd}) — ${horas}`;
      });

      const intro = dependentFirstName
        ? `Olá ${recipientFirstName}! Stadium Rackets.\n\n*Esta mensagem é referente ao seu dependente ${dependentFirstName}.*`
        : `Olá ${recipientFirstName}! Stadium Rackets.`;

      const message =
        `${intro}\n\n` +
        `Conforme solicitado, cancelamos os horários fixos nas seguintes datas:\n\n` +
        `${linhas.join("\n")}\n\n` +
        `As quadras foram liberadas para novas locações. Aguardamos seu retorno!\n\n` +
        `Qualquer dúvida estamos à disposição. Obrigado!`;

      const url = buildWhatsAppUrl(phone, message);

      toast.success(`Avisar ${recipientFirstName} no WhatsApp?`, {
        id: `wa-vac-${clientId}-${Date.now()}`,
        description: `${preview.length} data(s) canceladas — mensagem pronta.`,
        duration: 15000,
        action: {
          label: "Enviar WhatsApp",
          onClick: () => {
            openWhatsApp(url);
            void logWhatsAppSent(clientId, "vacation_cancel");
          },
        },
      });
    }

    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlaneTakeoff className="h-5 w-5" />
            Cancelar férias / viagem
          </DialogTitle>
          <DialogDescription>
            Selecione as datas que o cliente pediu para cancelar. As quadras ficam
            automaticamente liberadas para outras locações e você pode enviar um
            WhatsApp confirmando o cancelamento.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="mb-2 block">Datas a cancelar</Label>
            <div className="rounded-md border p-2">
              <Calendar
                mode="multiple"
                selected={dates}
                onSelect={(d) => setDates(d ?? [])}
                disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
                numberOfMonths={1}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {dates.length} data(s) selecionada(s).
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Horários fixos a cancelar</Label>
              <div className="space-y-2 rounded-md border p-3">
                {schedules.map((s) => {
                  const checked = selectedScheduleIds.has(s.id);
                  return (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleSchedule(s.id)}
                      />
                      <span>
                        {WEEKDAY_LABELS[s.weekday]} · {timeShort(s.start_time)}–
                        {timeShort(s.end_time)}
                        {s.court ? ` · ${courtShort(s.court)}` : ""}
                      </span>
                    </label>
                  );
                })}
                {schedules.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    Nenhum horário fixo cadastrado.
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="vac-reason" className="mb-2 block">
                Motivo (opcional)
              </Label>
              <Input
                id="vac-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Férias / viagem"
              />
            </div>

            <div>
              <Label className="mb-2 block">Prévia</Label>
              <ScrollArea className="h-40 rounded-md border p-2 text-sm">
                {preview.length === 0 ? (
                  <div className="text-muted-foreground">
                    Selecione datas que coincidam com os dias da semana dos horários.
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {preview.map((p) => (
                      <li key={p.date.toISOString()}>
                        <span className="font-medium">{fmtBRDate(p.date)}</span>{" "}
                        <span className="text-muted-foreground">
                          ({WEEKDAY_SHORT[p.date.getDay()]}) —{" "}
                          {p.items
                            .map(
                              (s) =>
                                `${timeShort(s.start_time)}–${timeShort(s.end_time)}`,
                            )
                            .join(", ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
              <p className="mt-1 text-xs text-muted-foreground">
                {fmtHours(totalMinutes)} serão liberadas.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={busy || preview.length === 0 || selectedScheduleIds.size === 0}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar cancelamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
