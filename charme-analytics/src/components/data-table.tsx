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
  // Aceita: números, %, +/-, R$, espaços, vírgulas, pontos
  return /^[+\-]?(?:R\$\s?)?\d[\d.,]*\s*%?$/.test(text) || /^[+\-]\d[\d.,]*%?$/.test(text);
}

export function DataTable({ children }: { children?: React.ReactNode }) {
  return (
    <div className="my-3 w-full overflow-x-auto rounded-md border border-zinc-200">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function DataTableHead({ children }: { children?: React.ReactNode }) {
  return (
    <thead className="bg-zinc-100 text-zinc-700 text-xs uppercase tracking-wide">
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
  const numeric = isNumeric(children);
  return (
    <th
      className={`px-3 py-2 font-semibold whitespace-nowrap ${
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
      className={`px-3 py-2 text-zinc-700 whitespace-nowrap ${
        numeric ? 'text-right tabular-nums' : 'text-left'
      }`}
    >
      {children}
    </td>
  );
}
