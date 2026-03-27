'use client';

import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import type { CreativeRow } from '@/app/api/criativos/route';

interface ExportButtonProps {
  rows: CreativeRow[];
  canal: string;
  dateFrom: string;
  dateTo: string;
}

function fmtBRL(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

export function ExportButton({ rows, canal, dateFrom, dateTo }: ExportButtonProps) {
  function handleExport() {
    const data = rows.map((r, i) => ({
      '#': i + 1,
      Plataforma: r.platform === 'google' ? 'Google Ads' : 'Meta Ads',
      'Ad ID': r.adId,
      'Nome do Ad': r.adName,
      Campanha: r.campaignName,
      Tipo: r.campaignType,
      'URL Criativo': r.thumbnailUrl && r.thumbnailUrl !== '__video__' ? r.thumbnailUrl : '',
      Headline: r.headline ?? '',
      Descrição: r.description ?? '',
      Spend: fmtBRL(r.spend),
      Impressões: r.impressions,
      Cliques: r.clicks,
      CTR: fmtPct(r.ctr),
      Conversões: r.conversions,
      Receita: fmtBRL(r.revenue),
      ROAS: r.roas > 0 ? `${r.roas.toFixed(2)}x` : '0.00x',
      CPA: r.cpa > 0 ? fmtBRL(r.cpa) : 'N/D',
      'Conv. Visualização': r.viewConversions ?? '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Criativos');

    const filename = `criativos_${canal}_${dateFrom}_${dateTo}.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={rows.length === 0}>
      📥 Exportar Excel
    </Button>
  );
}
