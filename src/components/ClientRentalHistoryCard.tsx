import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { todayISO } from "@/lib/format";
import { addDaysISO, fmtDateBR, SOURCE_LABEL, courtShort } from "@/lib/court-map";

interface Props {
  clientId: string;
}

interface Rental {
  id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  court: number;
  source: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

const fmtTime = (t: string) => t.slice(0, 5);

export function ClientRentalHistoryCard({ clientId }: Props) {
  const [loading, setLoading] = useState(true);
  const [rentals, setRentals] = useState<Rental[]>([]);

  useEffect(() => {
    let alive = true;
    const today = todayISO();
    const fromISO = addDaysISO(today, -30);
    setLoading(true);
    supabase
      .from("court_bookings")
      .select("id, booking_date, start_time, end_time, court, source, cancelled_at, cancel_reason")
      .eq("client_id", clientId)
      .gte("booking_date", fromISO)
      .lte("booking_date", today)
      .order("booking_date", { ascending: false })
      .order("start_time", { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          console.error("Erro ao carregar histórico de locações", error);
          setRentals([]);
        } else {
          setRentals((data ?? []) as Rental[]);
        }
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [clientId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Histórico de locações (últimos 30 dias)</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : rentals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma locação nos últimos 30 dias.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Horário</TableHead>
                  <TableHead>Quadra</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rentals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDateBR(r.booking_date)}</TableCell>
                    <TableCell>
                      {fmtTime(r.start_time)}–{fmtTime(r.end_time)}
                    </TableCell>
                    <TableCell>{courtShort(r.court)}</TableCell>
                    <TableCell>{SOURCE_LABEL[r.source] ?? r.source}</TableCell>
                    <TableCell>
                      {r.cancelled_at ? (
                        <Badge variant="destructive">
                          Cancelou{r.cancel_reason ? ` — ${r.cancel_reason}` : ""}
                        </Badge>
                      ) : (
                        <Badge className="bg-success text-success-foreground">Compareceu</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
