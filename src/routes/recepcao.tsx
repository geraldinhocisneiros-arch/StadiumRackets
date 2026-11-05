import { createFileRoute } from "@tanstack/react-router";
import { PortalLoginScreen } from "@/components/PortalLoginScreen";

export const Route = createFileRoute("/recepcao")({
  ssr: false,
  component: () => (
    <PortalLoginScreen origin="/recepcao" portalTitle="Portal da Recepção" />
  ),
});
