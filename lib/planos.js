// =====================================================================
// PLANOS COMERCIAIS — edite aqui os preços, nomes e limites.
// A cobrança é por quantidade de empresas (CNPJs) que o assinante pode
// cadastrar; usuários são ilimitados em todos os planos.
// =====================================================================

export const PLANOS = [
  {
    id: 'essencial',
    nome: 'Essencial',
    limite_empresas: 10,
    preco_mensal: 149.90,
    destaque: false,
    descricao: 'Para escritórios começando na automação',
    itens: ['Até 10 empresas (CNPJs)', 'Usuários ilimitados', 'Classificação por regras + IA', 'Importação OFX e planilhas', 'Relatórios financeiros e conciliação'],
  },
  {
    id: 'profissional',
    nome: 'Profissional',
    limite_empresas: 30,
    preco_mensal: 299.90,
    destaque: true,
    descricao: 'O mais escolhido pelos escritórios',
    itens: ['Até 30 empresas (CNPJs)', 'Usuários ilimitados', 'Tudo do Essencial', 'Permissões por empresa', 'Suporte prioritário'],
  },
  {
    id: 'escritorio',
    nome: 'Escritório+',
    limite_empresas: 100,
    preco_mensal: 599.90,
    destaque: false,
    descricao: 'Para operações de grande volume',
    itens: ['Até 100 empresas (CNPJs)', 'Usuários ilimitados', 'Tudo do Profissional', 'Atendimento dedicado'],
  },
];

export function getPlano(id) {
  return PLANOS.find(p => p.id === id) || null;
}

export function formatarPreco(v) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
