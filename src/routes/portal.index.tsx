import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/portal/")({
  ssr: false,
  component: () => <Navigate to="/portal/perfil" replace />,
});
