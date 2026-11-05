import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// Antiga "Configuração inicial" (criar o primeiro administrador). Desativada:
// o sistema já tem administradores e o banco não deixa mais ninguém se
// promover a admin por aqui (a política de bootstrap foi removida em
// 20260622153932). Mantê-la ativa só criava contas de login vazias — a
// tela de login conferia "existe admin?" sem permissão pra ler os papéis,
// achava que não, e oferecia "Criar conta de administrador" a qualquer
// visitante; um cliente que caía ali ficava com uma conta sem acesso a nada
// e depois não conseguia se cadastrar no portal ("já existe uma conta com
// esse e-mail"). Novos usuários da equipe são criados em Usuários.
export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Setup já concluído</CardTitle>
          <CardDescription>
            Já existe um administrador cadastrado. Novos usuários devem ser criados pelo painel de
            admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/login" className="text-primary font-medium hover:underline">
            Ir para o login →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
