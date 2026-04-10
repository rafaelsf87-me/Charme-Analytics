'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { DevolucoesForm } from '@/components/avaliacoes/devolucoes-form';
import { DevolucoesProgress } from '@/components/avaliacoes/devolucoes-progress';
import { DevolucoesResults, type RawItem } from '@/components/avaliacoes/devolucoes-results';

interface ListarResponse {
  allIds: number[];
  totalIds: number;
}

interface ItensResponse {
  items: RawItem[];
  pedidoLojas: Record<string, string>;
  lojas: string[];
  counts: { vendidos: number; devolvidos: number; cancelados: number; ignorados: number };
  erros: number;
}

const BATCH_SIZE = 50;

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

type Mode = 'form' | 'processing' | 'results';

export default function DevolucoesPage() {
  const [mode, setMode] = useState<Mode>('form');
  const [loading, setLoading] = useState(false);
  const [periodo, setPeriodo] = useState({ from: '', to: '' });

  // Progresso
  const [fase, setFase] = useState<1 | 2>(1);
  const [fase1Done, setFase1Done] = useState(false);
  const [totalEncontrados, setTotalEncontrados] = useState(0);
  const [batchAtual, setBatchAtual] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [pedidosProcessados, setPedidosProcessados] = useState(0);
  const [countVendidos, setCountVendidos] = useState(0);
  const [countDevolvidos, setCountDevolvidos] = useState(0);
  const [countCancelados, setCountCancelados] = useState(0);

  // Resultados
  const [allItems, setAllItems] = useState<RawItem[]>([]);
  const [pedidoLojas, setPedidoLojas] = useState<Record<string, string>>({});
  const [lojas, setLojas] = useState<string[]>([]);
  const [resumoGeral, setResumoGeral] = useState<{
    totalPedidos: number; verificados: number; devolvidos: number;
    cancelados: number; ignorados: number;
  } | null>(null);

  const cancelRef = useRef(false);

  const resetState = useCallback(() => {
    setFase(1); setFase1Done(false); setTotalEncontrados(0);
    setBatchAtual(0); setTotalBatches(0); setPedidosProcessados(0);
    setCountVendidos(0); setCountDevolvidos(0); setCountCancelados(0);
    setAllItems([]); setPedidoLojas({}); setLojas([]); setResumoGeral(null);
    cancelRef.current = false;
  }, []);

  async function handleSubmit(dateFrom: string, dateTo: string) {
    resetState();
    setPeriodo({ from: dateFrom, to: dateTo });
    setLoading(true);
    setMode('processing');

    try {
      // ── Fase 1: listar todos os IDs ─────────────────────────────────────────
      setFase(1);
      const fase1Res = await fetch('/api/avaliacoes/devolucoes/listar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      if (!fase1Res.ok) {
        const err = await fase1Res.json().catch(() => ({ error: `HTTP ${fase1Res.status}` }));
        throw new Error(err.error ?? 'Erro na Fase 1');
      }
      const fase1: ListarResponse = await fase1Res.json();
      setFase1Done(true);
      setTotalEncontrados(fase1.totalIds);

      if (cancelRef.current || fase1.totalIds === 0) {
        if (fase1.totalIds === 0) {
          setResumoGeral({ totalPedidos: 0, verificados: 0, devolvidos: 0, cancelados: 0, ignorados: 0 });
          setMode('results');
        }
        return;
      }

      // ── Fase 2: buscar detalhe + classificar em batches ─────────────────────
      setFase(2);
      const batches = chunks(fase1.allIds, BATCH_SIZE);
      setTotalBatches(batches.length);

      const accumulated: {
        items: RawItem[];
        pedidoLojas: Record<string, string>;
        lojasSet: Set<string>;
        counts: { vendidos: number; devolvidos: number; cancelados: number; ignorados: number };
      } = {
        items: [], pedidoLojas: {}, lojasSet: new Set(),
        counts: { vendidos: 0, devolvidos: 0, cancelados: 0, ignorados: 0 },
      };

      let processados = 0;

      for (let i = 0; i < batches.length; i++) {
        if (cancelRef.current) return;

        const res = await fetch('/api/avaliacoes/devolucoes/itens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderIds: batches[i] }),
        });

        if (res.ok) {
          const data: ItensResponse = await res.json();
          accumulated.items.push(...data.items);
          Object.assign(accumulated.pedidoLojas, data.pedidoLojas);
          for (const l of data.lojas) accumulated.lojasSet.add(l);
          accumulated.counts.vendidos   += data.counts.vendidos;
          accumulated.counts.devolvidos += data.counts.devolvidos;
          accumulated.counts.cancelados += data.counts.cancelados;
          accumulated.counts.ignorados  += data.counts.ignorados;

          // Atualizar contadores de progresso
          setCountVendidos(accumulated.counts.vendidos);
          setCountDevolvidos(accumulated.counts.devolvidos);
          setCountCancelados(accumulated.counts.cancelados);
        }

        processados += batches[i].length;
        setBatchAtual(i + 1);
        setPedidosProcessados(processados);
      }

      if (cancelRef.current) return;

      const { counts } = accumulated;
      const totalPedidos = counts.vendidos + counts.devolvidos + counts.cancelados + counts.ignorados;

      setAllItems(accumulated.items);
      setPedidoLojas(accumulated.pedidoLojas);
      setLojas([...accumulated.lojasSet].sort());
      setResumoGeral({
        totalPedidos,
        verificados:  counts.vendidos,
        devolvidos:   counts.devolvidos,
        cancelados:   counts.cancelados,
        ignorados:    counts.ignorados,
      });
      setMode('results');
    } catch (err) {
      alert((err as Error).message);
      setMode('form');
    } finally {
      setLoading(false);
    }
  }

  function handleCancelar() {
    cancelRef.current = true;
    setLoading(false);
    setMode('form');
    resetState();
  }

  function handleNovaAnalise() {
    resetState();
    setMode('form');
    setLoading(false);
  }

  function Header() {
    return (
      <header className="flex items-center justify-between px-6 py-3 bg-charme border-b border-charme/20 shrink-0">
        <div className="flex items-center gap-3">
          {mode === 'results' ? (
            <button onClick={handleNovaAnalise} className="text-sm text-white/60 hover:text-white transition-colors">
              ← Nova Análise
            </button>
          ) : (
            <Link href="/avaliacoes" className="text-sm text-white/60 hover:text-white transition-colors">
              ← Voltar
            </Link>
          )}
          <span className="text-white/30">|</span>
          <Link href="/home">
            <Image src="/logo.png" alt="Charme Analytics" width={24} height={24} className="rounded-md" />
          </Link>
          <div className="flex items-center gap-2">
            <Image src="/bling_logo.png" alt="Bling" width={18} height={18} className="rounded" />
            <span className="font-semibold text-white text-sm">Devoluções &amp; Cancelamentos</span>
          </div>
        </div>
      </header>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-charme-bg">
      <Header />
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        {mode === 'form' && <DevolucoesForm onSubmit={handleSubmit} loading={loading} />}
        {mode === 'processing' && (
          <DevolucoesProgress
            fase={fase} fase1Done={fase1Done} totalEncontrados={totalEncontrados}
            batchAtual={batchAtual} totalBatches={totalBatches}
            pedidosProcessados={pedidosProcessados}
            countVendidos={countVendidos} countDevolvidos={countDevolvidos} countCancelados={countCancelados}
            onCancelar={handleCancelar}
          />
        )}
        {mode === 'results' && resumoGeral && (
          <DevolucoesResults
            items={allItems} pedidoLojas={pedidoLojas} lojas={lojas}
            resumo={resumoGeral} periodo={periodo}
            dateFrom={periodo.from} dateTo={periodo.to}
          />
        )}
      </main>
    </div>
  );
}
