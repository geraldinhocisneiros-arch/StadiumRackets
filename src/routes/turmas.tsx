import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/RequireAuth";
import { ClassesPage } from "@/components/ClassesPage";

export const Route = createFileRoute("/turmas")({
  component: () => (
    <RequireAuth rolesAllowed={["admin", "diretoria", "recepcionista"]}>
      <ClassesPage program="pickleball" />
    </RequireAuth>
  ),
});
