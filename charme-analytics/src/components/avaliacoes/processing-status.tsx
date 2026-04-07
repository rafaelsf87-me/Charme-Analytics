'use client';

interface ProcessingStatusProps {
  totalNegativas: number;
}

export function ProcessingStatus({ totalNegativas }: ProcessingStatusProps) {
  const batches = Math.ceil(totalNegativas / 80);
  const minutos = batches <= 3 ? '<1' : batches <= 8 ? '1-2' : '2-4';

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-6 py-16">
      <div className="w-10 h-10 border-2 border-charme-border border-t-charme rounded-full animate-spin" />

      <div className="text-center max-w-sm">
        <p className="text-base font-medium text-charme-text mb-1">Analisando avaliações...</p>
        <p className="text-sm text-zinc-500">
          Processando {totalNegativas.toLocaleString('pt-BR')} avaliações negativas
          em {batches} {batches === 1 ? 'lote' : 'lotes'}.
        </p>
        <p className="text-xs text-zinc-400 mt-1">
          Isso pode levar {minutos} {minutos === '<1' ? 'minuto' : 'minutos'}...
        </p>
      </div>

      <div className="w-64 bg-zinc-100 rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full bg-charme rounded-full animate-pulse"
          style={{ width: '60%' }}
        />
      </div>
    </div>
  );
}
