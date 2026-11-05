import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePortalClientId } from "@/hooks/usePortalClientId";
import { AvulsaWaitlistJoinDialog } from "@/components/AvulsaWaitlistJoinDialog";
import { AvulsaWaitlistMyEntries } from "@/components/AvulsaWaitlistMyEntries";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/portal/lista-espera")({
  component: PortalListaEsperaPage,
});

function PortalListaEsperaPage() {
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
          <CardTitle className="text-base">Lista de espera</CardTitle>
          <AvulsaWaitlistJoinDialog variant="client" clientId={clientId} buttonLabel="Lista de espera" />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Entre na fila de espera por um dia e horário específico (avulso, não recorrente).
            Escolha quadra de saibro, rápida ou qualquer uma — as inscrições são atendidas por
            ordem de chegada.
          </p>
          <AvulsaWaitlistMyEntries key={clientId} />
        </CardContent>
      </Card>
    </div>
  );
}
