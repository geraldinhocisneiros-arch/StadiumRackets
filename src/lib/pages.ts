import type { PageKey } from "@/hooks/useAuth";

export interface ManageablePage {
  key: PageKey;
  label: string;
  description: string;
}

// Páginas que podem ser habilitadas/desabilitadas por usuário (não-admin).
// "relatorios" NÃO entra aqui — é exclusivo de administradores.
export const MANAGEABLE_PAGES: ManageablePage[] = [
  { key: "mapa", label: "Mapa de quadras", description: "Visualização e reserva de quadras. Diretoria, recepcionistas e professores têm acesso automático — libere aqui para outros usuários." },
  { key: "painel", label: "Painel", description: "Visão geral do dia" },
  { key: "caixa", label: "Caixa", description: "Registro de pagamentos e caixa do dia" },
  { key: "financas", label: "Finanças", description: "Compilado por forma de pagamento e usuário" },
  { key: "clientes", label: "Clientes", description: "Cadastro e contas de clientes" },
  { key: "categorias", label: "Categorias", description: "Gestão de categorias de cliente" },
  { key: "usuarios", label: "Usuários", description: "Gestão de usuários e permissões" },
  { key: "obras", label: "Obras", description: "Acompanhamento de obras" },
  { key: "estoque", label: "Estoque", description: "Controle de Terno de bola e Grip" },
  {
    key: "inadimplencia",
    label: "Inadimplência",
    description:
      "Aba Inadimplentes, cobrança, totais de inadimplência no Painel/Relatórios, selo 💰 no mapa e pop-up de débitos. Vale também para administradores.",
  },
];
