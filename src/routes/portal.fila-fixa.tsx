import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePortalClientId } from "@/hooks/usePortalClientId";
import { FixedWaitlistJoinDialog } from "@/components/FixedWaitlistJoinDialog";
import { FixedWaitlistMyEntries } from "@/components/FixedWaitlistMyEntries";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/portal/fila-fixa")({
  component: PortalFilaFixaPage,
});

function PortalFilaFixaPage() {
  const { clientId, loading } = usePortalClientId();

  if (loading) {
    return (
      <div className="py-12 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
      </div>
    );
  }

  if (!clientId) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Não foi possível identificar sua conta.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Fila de horário fixo</CardTitle>
          <FixedWaitlistJoinDialog variant="client" clientId={clientId} />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Entre na fila de espera por um horário fixo semanal. As inscrições são atendidas por
            ordem de chegada, na data e horário exatos do registro.
          </p>
          <FixedWaitlistMyEntries key={clientId} />
        </CardContent>
      </Card>
    </div>
  );
}
