import { createFileRoute } from "@tanstack/react-router";
import { PortalLoginScreen } from "@/components/PortalLoginScreen";

export const Route = createFileRoute("/gestao")({
  ssr: false,
  component: () => (
    <PortalLoginScreen origin="/gestao" portalTitle="Portal de Gestão" />
  ),
});
