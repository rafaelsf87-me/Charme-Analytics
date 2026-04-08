'use client';

interface Props {
  fase: 1 | 2;
  fase1Done: boolean;
  resumo: { vendidos: number; devolvidos: number; cancelados: number; descartados: number } | null;
  batchAtual: number;
  totalBatches: number;
  pedidosProcessados: number;
  totalPedidos: number;
  onCancelar: () => void;
}

export function DevolucoesProgress({
  fase,
  fase1Done,
  resumo,
  batchAtual,
  totalBatches,
  pedidosProcessados,
  totalPedidos,
  onCancelar,
}: Props) {
  const pct = totalBatches > 0 ? Math.round((batchAtual / totalBatches) * 100) : 0;
  const minRestantes = totalBatches > 0
    ? Math.ceil(((totalBatches - batchAtual) * 17) / 60)
    : null;

  return (
    <div className="w-full max-w-md bg-white border border-charme-border rounded-xl shadow-sm p-8">
      <p className="text-sm font-semibold text-zinc-700 mb-6">Analisando...</p>

      {/* Fase 1 */}
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs text-zinc-600">Fase 1: Listando pedidos...</span>
        {fase1Done && <span className="text-green-500 text-xs">✅</span>}
      </div>

      {fase1Done && resumo && (
        <div className="text-[11px] text-zinc-400 mb-4 leading-relaxed">
          {resumo.vendidos.toLocaleString('pt-BR')} verificados &middot;{' '}
          {resumo.devolvidos.toLocaleString('pt-BR')} devolvidos &middot;{' '}
          {resumo.cancelados.toLocaleString('pt-BR')} cancelados
          {resumo.descartados > 0 && (
            <> &middot; {resumo.descartados} &quot;Em troca&quot; desconsiderados</>
          )}
        </div>
      )}

      {/* Fase 2 */}
      {fase === 2 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-600">Fase 2: Buscando itens...</span>
          </div>

          {/* Barra de progresso */}
          <div className="w-full bg-zinc-100 rounded-full h-2 mb-2">
            <div
              className="h-2 rounded-full transition-all"
              style={{ width: `${pct}%`, backgroundColor: '#553679' }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
            <span>Batch {batchAtual} de {totalBatches}</span>
            <span>{pct}%</span>
          </div>

          <p className="text-[11px] text-zinc-400 mb-1">
            {pedidosProcessados.toLocaleString('pt-BR')} de {totalPedidos.toLocaleString('pt-BR')} pedidos processados
          </p>

          {minRestantes !== null && minRestantes > 0 && (
            <p className="text-[11px] text-zinc-400 mb-5">
              ⏱️ ~{minRestantes} minuto{minRestantes !== 1 ? 's' : ''} restante{minRestantes !== 1 ? 's' : ''}
            </p>
          )}
        </>
      )}

      <button
        onClick={onCancelar}
        className="mt-4 w-full h-9 border border-zinc-200 text-zinc-500 text-sm rounded-lg hover:bg-zinc-50 transition-colors"
      >
        Cancelar
      </button>
    </div>
  );
}
