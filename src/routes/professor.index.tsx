import { createFileRoute } from "@tanstack/react-router";
import { PortalLoginScreen } from "@/components/PortalLoginScreen";

export const Route = createFileRoute("/professor/")({
  ssr: false,
  component: () => (
    <PortalLoginScreen origin="/professor" portalTitle="Portal do Professor" />
  ),
});
