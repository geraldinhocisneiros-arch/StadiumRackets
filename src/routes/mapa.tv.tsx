import { createFileRoute } from "@tanstack/react-router";
import { MapaTVStandalone } from "@/components/MapaTVStandalone";

export const Route = createFileRoute("/mapa/tv")({
  component: MapaTVStandalone,
});
