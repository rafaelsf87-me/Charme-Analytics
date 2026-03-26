// Formata valor decimal em R$ → "R$1.234,56"
export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Formata micros (Google Ads) em R$ → "R$1.234,56"
export function formatBRLFromMicros(micros: number): string {
  return formatBRL(micros / 1_000_000);
}

// Formata decimal para percentual → "12,3%"
export function formatPercent(decimal: number): string {
  return (
    (decimal * 100).toLocaleString('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + '%'
  );
}

// Formata ISO date para DD/MM/AAAA
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

// Gera tabela pipe-separated compacta para envio ao Claude
export function compactTable(headers: string[], rows: string[][]): string {
  const header = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [header, separator, body].join('\n');
}
