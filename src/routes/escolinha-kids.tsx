import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { ClassesPage } from "@/components/ClassesPage";

export const Route = createFileRoute("/escolinha-kids")({
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <ClassesPage program="kids" />
    </RequireAuth>
  ),
});
