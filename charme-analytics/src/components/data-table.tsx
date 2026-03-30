// Override do componente table do react-markdown
// Zebra striping, bordas sutis, responsivo, header destacado, números à direita

import { isValidElement } from 'react';

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node) && node.props && (node.props as { children?: React.ReactNode }).children !== undefined) {
    return extractText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}

function isNumeric(node: React.ReactNode): boolean {
  const text = extractText(node).trim();
  // Traço = ausência de dado em coluna numérica → tratar como numérico para manter alinhamento
  if (text === '—' || text === '-' || text === 'N/A') return true;
  // Aceita: números, %, +/-, R$, espaços, vírgulas, pontos
  return /^[+\-]?(?:R\$\s?)?\d[\d.,]*\s*%?$/.test(text) || /^[+\-]\d[\d.,]*%?$/.test(text);
}

// Headers de colunas numéricas — para alinhar à direita igual às células de dados
const NUMERIC_HEADER_RE = /^(#|\d|views|taxa|compras|receita|invest|impressõ|impresso|cliques?|ctr|cpa|roas|custo|valor|qtd|quantidade|pedidos?|média|media|δ|variação|variacao|conv)/i;

export function DataTable({ children }: { children?: React.ReactNode }) {
  return (
    <div className="my-3 w-full overflow-x-auto rounded-md border border-zinc-200">
      <table className="w-auto min-w-[50%] max-w-full text-sm">{children}</table>
    </div>
  );
}

export function DataTableHead({ children }: { children?: React.ReactNode }) {
  return (
    <thead className="bg-zinc-100 text-zinc-700 text-[10px] uppercase tracking-wide">
      {children}
    </thead>
  );
}

export function DataTableBody({ children }: { children?: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function DataTableRow({ children }: { children?: React.ReactNode }) {
  return (
    <tr className="border-t border-zinc-100 odd:bg-white even:bg-zinc-50 hover:bg-zinc-100 transition-colors">
      {children}
    </tr>
  );
}

export function DataTableHeaderCell({ children }: { children?: React.ReactNode }) {
  const text = extractText(children).trim();
  const numeric = isNumeric(children) || NUMERIC_HEADER_RE.test(text);
  return (
    <th
      className={`px-2 py-1.5 font-semibold leading-tight ${
        numeric ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

export function DataTableCell({ children }: { children?: React.ReactNode }) {
  const numeric = isNumeric(children);
  return (
    <td
      className={`px-2 py-1.5 text-[11px] text-zinc-700 whitespace-nowrap ${
        numeric ? 'text-right tabular-nums' : 'text-left'
      }`}
    >
      {children}
    </td>
  );
}
