// Override do componente table do react-markdown
// Zebra striping, bordas sutis, responsivo, header destacado, números à direita

function isNumeric(value: string): boolean {
  return /^-?[\d.,]+%?$/.test(value.trim());
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
  const text = String(children ?? '');
  return (
    <th
      className={`px-3 py-2 font-semibold whitespace-nowrap ${
        isNumeric(text) ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

export function DataTableCell({ children }: { children?: React.ReactNode }) {
  const text = String(children ?? '');
  return (
    <td
      className={`px-3 py-2 text-zinc-700 whitespace-nowrap ${
        isNumeric(text) ? 'text-right tabular-nums' : 'text-left'
      }`}
    >
      {children}
    </td>
  );
}
