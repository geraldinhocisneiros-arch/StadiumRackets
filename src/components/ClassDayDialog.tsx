// Turma de pickleball clicada no mapa de quadras. Turma não tem presença
// nem cobrança por aula (o aluno paga a mensalidade do mês) — aqui só se vê
// quem é da turma, com atalho para a tela de Turmas.
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { courtShort, fmtDateBR, type FixedSchedule } from "@/lib/court-map";

export interface ClassDayData {
  fixed: FixedSchedule;
  siblings: FixedSchedule[];
}

export function ClassDayDialog({
  data,
  date,
  onOpenChange,
}: {
  data: ClassDayData | null;
  date: string;
  onOpenChange: (v: boolean) => void;
}) {
  const f = data?.fixed;
  const students = data ? [data.fixed, ...data.siblings] : [];
  return (
    <Dialog open={!!data} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {f && (
          <>
            <DialogHeader>
              <DialogTitle>Turma {f.pickleball_classes?.name ?? ""}</DialogTitle>
              <DialogDescription>
                {fmtDateBR(date)} · {f.start_time.slice(0, 5)}–{f.end_time.slice(0, 5)} ·{" "}
                {f.court ? courtShort(f.court) : ""}
                {f.teachers?.name ? ` · Prof. ${f.teachers.name}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <div className="text-sm font-medium">Alunos ({students.length})</div>
              <ul className="text-sm space-y-1">
                {students.map((s) => (
                  <li key={s.id}>{s.clients?.full_name ?? "Aluno"}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Turma fixa: o aluno paga a mensalidade do mês, então aqui não se marca presença nem
                se lança aula no caixa. Matrícula, saída e valores ficam na tela de Turmas.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
              <Button asChild>
                <Link to="/turmas">Abrir Turmas</Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
