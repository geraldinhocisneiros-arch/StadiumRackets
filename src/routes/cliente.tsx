import { createFileRoute } from "@tanstack/react-router";
import { PortalLoginScreen } from "@/components/PortalLoginScreen";

export const Route = createFileRoute("/cliente")({
  ssr: false,
  component: () => (
    <PortalLoginScreen origin="/cliente" portalTitle="Portal do Cliente" />
  ),
});
