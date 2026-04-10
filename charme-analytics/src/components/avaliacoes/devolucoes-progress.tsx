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
  fase, fase1Done, resumo,
  batchAtual, totalBatches, pedidosProcessados, totalPedidos,
  onCancelar,
}: Props) {
  const pct = totalBatches > 0 ? Math.round((batchAtual / totalBatches) * 100) : 0;
  const minRestantes = totalBatches > 0 ? Math.ceil(((totalBatches - batchAtual) * 17) / 60) : null;

  return (
    <div className="w-full max-w-md bg-white border border-charme-border rounded-xl shadow-sm p-8">

      {/* Título com spinner */}
      <div className="flex items-center gap-3 mb-6">
        <svg className="animate-spin h-5 w-5 text-charme shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <p className="text-sm font-semibold text-zinc-700">Analisando...</p>
      </div>

      {/* Fase 1 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-zinc-600">Fase 1: Listando pedidos...</span>
        {fase1Done
          ? <span className="text-green-500 text-xs">✅</span>
          : <svg className="animate-spin h-3 w-3 text-zinc-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
            </svg>
        }
      </div>

      {fase1Done && resumo && (
        <div className="text-[11px] text-zinc-400 mb-4 leading-relaxed">
          {resumo.vendidos.toLocaleString('pt-BR')} verificados &middot;{' '}
          {resumo.devolvidos.toLocaleString('pt-BR')} devolvidos &middot;{' '}
          {resumo.cancelados.toLocaleString('pt-BR')} cancelados
          {resumo.descartados > 0 && <> &middot; {resumo.descartados} &quot;Em troca&quot; ignorados</>}
        </div>
      )}

      {/* Fase 2 */}
      {fase === 2 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-600">Fase 2: Buscando itens...</span>
            {batchAtual < totalBatches && (
              <svg className="animate-spin h-3 w-3 text-zinc-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
            )}
          </div>

          <div className="w-full bg-zinc-100 rounded-full h-2 mb-2">
            <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: '#553679' }} />
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
            <span>Batch {batchAtual} de {totalBatches}</span>
            <span>{pct}%</span>
          </div>

          <p className="text-[11px] text-zinc-400 mb-1">
            {pedidosProcessados.toLocaleString('pt-BR')} de {totalPedidos.toLocaleString('pt-BR')} pedidos
          </p>

          {minRestantes !== null && minRestantes > 0 && (
            <p className="text-[11px] text-zinc-400 mb-3">
              ⏱️ ~{minRestantes} min restante{minRestantes !== 1 ? 's' : ''}
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
