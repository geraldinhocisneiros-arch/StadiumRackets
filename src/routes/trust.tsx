import { createFileRoute, Link } from "@tanstack/react-router";
import { Shield, Lock, Database, Users, FileText, Mail } from "lucide-react";

export const Route = createFileRoute("/trust")({
  component: TrustPage,
  head: () => ({
    meta: [
      { title: "Segurança e Privacidade — Stadium Rackets" },
      {
        name: "description",
        content:
          "Como o Stadium Rackets protege os dados da academia: autenticação, controle de acesso por papel, hospedagem e práticas de privacidade.",
      },
      { property: "og:title", content: "Segurança e Privacidade — Stadium Rackets" },
      {
        property: "og:description",
        content:
          "Visão geral dos controles de segurança, privacidade e acesso do Stadium Rackets.",
      },
    ],
  }),
});

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Shield;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function TrustPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Segurança e Privacidade</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta página é mantida pela administração do Stadium Rackets para responder dúvidas
            comuns sobre como o sistema protege os dados da academia. O conteúdo é editável e
            não representa certificação independente.
          </p>
        </header>

        <div className="grid gap-4">
          <Section icon={Lock} title="Autenticação e acesso">
            <p>
              O acesso exige e-mail e senha. Cada usuário recebe um papel (admin, diretoria ou
              recepcionista) que determina o que pode ver e alterar dentro do sistema.
            </p>
            <p>
              Operações sensíveis (gestão de usuários, edições de fechamento de caixa, ajustes
              de estoque) são restritas a papéis específicos e validadas no servidor.
            </p>
          </Section>

          <Section icon={Shield} title="Controle por papel">
            <ul className="list-disc space-y-1 pl-5">
              <li>Fechamentos de caixa: visíveis apenas para admin e diretoria.</li>
              <li>Atualização de estoque: restrita a admin e recepcionista.</li>
              <li>Gestão de papéis: exclusiva de administradores.</li>
            </ul>
          </Section>

          <Section icon={Database} title="Hospedagem e infraestrutura">
            <p>
              A aplicação roda na plataforma Lovable, com banco de dados gerenciado e backups
              automáticos do provedor. As regras de acesso são aplicadas no banco (Row Level
              Security), de modo que nenhum dado é retornado sem autorização.
            </p>
            <p>
              O tráfego entre o navegador e o servidor é protegido por HTTPS/TLS.
            </p>
          </Section>

          <Section icon={Users} title="Dados coletados">
            <p>
              O sistema armazena apenas as informações necessárias à operação da academia:
              cadastros de alunos, pagamentos, fechamentos de caixa, tarefas internas e
              movimentações de estoque. Não há rastreamento publicitário nem venda de dados.
            </p>
          </Section>

          <Section icon={FileText} title="Retenção e exclusão">
            <p>
              Os dados ficam disponíveis enquanto a conta da academia estiver ativa. Pedidos de
              exclusão ou exportação podem ser feitos pelo administrador da academia através do
              canal de contato abaixo.
            </p>
          </Section>

          <Section icon={Mail} title="Contato de segurança">
            <p>
              Para relatar uma suspeita de vulnerabilidade ou pedir esclarecimentos sobre
              privacidade, fale com o administrador da academia, que é responsável pela
              configuração e gestão das contas.
            </p>
          </Section>
        </div>

        <footer className="mt-10 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            ← Voltar ao painel
          </Link>
        </footer>
      </div>
    </div>
  );
}
