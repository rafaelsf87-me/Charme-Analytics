'use client';

import { useState } from 'react';

interface Props {
  onSubmit: (dateFrom: string, dateTo: string) => void;
  loading: boolean;
}

export function DevolucoesForm({ onSubmit, loading }: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const today = new Date();
  today.setDate(today.getDate() - 1);
  const maxDate = today.toISOString().split('T')[0];

  const canSubmit = from && to && from <= to && !loading;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (canSubmit) onSubmit(from, to);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-md bg-white border border-charme-border rounded-xl shadow-sm p-8"
    >
      <h2 className="text-base font-semibold text-charme mb-1">
        Análise de Devoluções &amp; Cancelamentos
      </h2>
      <p className="text-xs text-zinc-400 mb-6">Fonte: Bling v3</p>

      <div className="flex gap-3 mb-4">
        <div className="flex-1">
          <label className="block text-xs font-medium text-zinc-600 mb-1">De</label>
          <input
            type="date"
            value={from}
            max={to || maxDate}
            onChange={e => setFrom(e.target.value)}
            className="w-full h-9 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-700 focus:outline-none focus:border-charme/40"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-zinc-600 mb-1">Até</label>
          <input
            type="date"
            value={to}
            min={from || undefined}
            max={maxDate}
            onChange={e => setTo(e.target.value)}
            className="w-full h-9 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-700 focus:outline-none focus:border-charme/40"
          />
        </div>
      </div>

      {/* Aviso lag temporal */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-700 mb-4">
        ⚠️ Pedidos dos últimos 30 dias do período podem não ter tido tempo para devolução/cancelamento.
        Para maior precisão, use períodos encerrados há pelo menos 30 dias.
      </div>

      <p className="text-[11px] text-zinc-400 mb-5">
        Períodos longos podem levar vários minutos. Recomendado: até 90 dias.
      </p>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full h-10 bg-charme text-white text-sm font-medium rounded-lg hover:bg-charme-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Analisar
      </button>
    </form>
  );
}
