'use client';

interface Props {
  fase: 1 | 2;
  fase1Done: boolean;
  totalEncontrados: number;
  batchAtual: number;
  totalBatches: number;
  pedidosProcessados: number;
  countVendidos: number;
  countDevolvidos: number;
  countCancelados: number;
  onCancelar: () => void;
}

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg className={`animate-spin h-${size} w-${size} text-charme shrink-0`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function DevolucoesProgress({
  fase, fase1Done, totalEncontrados,
  batchAtual, totalBatches, pedidosProcessados,
  countVendidos, countDevolvidos, countCancelados,
  onCancelar,
}: Props) {
  const pct = totalBatches > 0 ? Math.round((batchAtual / totalBatches) * 100) : 0;
  const minRestantes = totalBatches > 0 ? Math.ceil(((totalBatches - batchAtual) * 17) / 60) : null;

  return (
    <div className="w-full max-w-md bg-white border border-charme-border rounded-xl shadow-sm p-8">

      <div className="flex items-center gap-3 mb-6">
        <Spinner size={5} />
        <p className="text-sm font-semibold text-zinc-700">Analisando...</p>
      </div>

      {/* Fase 1 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-zinc-600">Fase 1: Listando pedidos...</span>
        {fase1Done
          ? <span className="text-green-500 text-xs">✅</span>
          : <Spinner size={3} />}
      </div>

      {fase1Done && (
        <p className="text-[11px] text-zinc-400 mb-4">
          {totalEncontrados.toLocaleString('pt-BR')} pedidos encontrados
        </p>
      )}

      {/* Fase 2 */}
      {fase === 2 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-600">Fase 2: Buscando e classificando...</span>
            {batchAtual < totalBatches && <Spinner size={3} />}
          </div>

          <div className="w-full bg-zinc-100 rounded-full h-2 mb-2">
            <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: '#553679' }} />
          </div>

          <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
            <span>Batch {batchAtual} de {totalBatches}</span>
            <span>{pct}%</span>
          </div>

          <p className="text-[11px] text-zinc-400 mb-1">
            {pedidosProcessados.toLocaleString('pt-BR')} de {totalEncontrados.toLocaleString('pt-BR')} pedidos
          </p>

          {(countVendidos + countDevolvidos + countCancelados) > 0 && (
            <p className="text-[11px] text-zinc-400 mb-1">
              {countVendidos.toLocaleString('pt-BR')} verificados &middot;{' '}
              {countDevolvidos.toLocaleString('pt-BR')} devolvidos &middot;{' '}
              {countCancelados.toLocaleString('pt-BR')} cancelados
            </p>
          )}

          {minRestantes !== null && minRestantes > 0 && (
            <p className="text-[11px] text-zinc-400 mb-1">
              ⏱️ ~{minRestantes} min restante{minRestantes !== 1 ? 's' : ''}
            </p>
          )}
        </>
      )}

      <button onClick={onCancelar}
        className="mt-5 w-full h-9 border border-zinc-200 text-zinc-500 text-sm rounded-lg hover:bg-zinc-50 transition-colors">
        Cancelar
      </button>
    </div>
  );
}
