'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { DevolucoesForm } from '@/components/avaliacoes/devolucoes-form';
import { DevolucoesProgress } from '@/components/avaliacoes/devolucoes-progress';
import { DevolucoesResults, type SKUResult } from '@/components/avaliacoes/devolucoes-results';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface ListarResponse {
  vendidos: number[];
  devolvidos: number[];
  cancelados: number[];
  descartados: number;
  totalVendidos: number;
  totalDevolvidos: number;
  totalCancelados: number;
}

interface ItemBatch {
  codigo: string;
  descricao: string;
  quantidade: number;
}

// ─── Agregação por SKU (frontend) ─────────────────────────────────────────────

const BATCH_SIZE = 50;
const MIN_VENDAS = 5;

function aggregateBySKU(
  vendidosItems: ItemBatch[],
  devolvidosItems: ItemBatch[],
  canceladosItems: ItemBatch[]
): SKUResult[] {
  const map = new Map<string, SKUResult>();

  function get(item: ItemBatch): SKUResult {
    if (!map.has(item.codigo)) {
      map.set(item.codigo, {
        sku: item.codigo,
        name: item.descricao,
        qtdVerificado: 0,
        qtdDevolvido: 0,
        qtdCancelado: 0,
        qtdTotalVendido: 0,
        taxaDevolucao: 0,
        taxaCancelamento: 0,
      });
    }
    return map.get(item.codigo)!;
  }

  for (const i of vendidosItems)   get(i).qtdVerificado += i.quantidade;
  for (const i of devolvidosItems) { const r = get(i); r.qtdDevolvido += i.quantidade; }
  for (const i of canceladosItems) { const r = get(i); r.qtdCancelado += i.quantidade; }

  return Array.from(map.values())
    .map(r => {
      r.qtdTotalVendido = r.qtdVerificado + r.qtdDevolvido + r.qtdCancelado;
      r.taxaDevolucao   = r.qtdTotalVendido > 0 ? (r.qtdDevolvido / r.qtdTotalVendido) * 100 : 0;
      r.taxaCancelamento = r.qtdTotalVendido > 0 ? (r.qtdCancelado / r.qtdTotalVendido) * 100 : 0;
      return r;
    })
    .filter(r => r.qtdTotalVendido >= MIN_VENDAS)
    .sort((a, b) => b.taxaDevolucao - a.taxaDevolucao);
}

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ─── Página ───────────────────────────────────────────────────────────────────

type Mode = 'form' | 'processing' | 'results';

export default function DevolucoesPage() {
  const [mode, setMode] = useState<Mode>('form');
  const [loading, setLoading] = useState(false);
  const [periodo, setPeriodo] = useState({ from: '', to: '' });

  // Progresso
  const [fase, setFase] = useState<1 | 2>(1);
  const [fase1Done, setFase1Done] = useState(false);
  const [resumoFase1, setResumoFase1] = useState<{
    vendidos: number; devolvidos: number; cancelados: number; descartados: number;
  } | null>(null);
  const [batchAtual, setBatchAtual] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [pedidosProcessados, setPedidosProcessados] = useState(0);
  const [totalPedidos, setTotalPedidos] = useState(0);

  // Resultados
  const [resultados, setResultados] = useState<SKUResult[]>([]);
  const [resumoGeral, setResumoGeral] = useState<{
    totalPedidos: number; verificados: number; devolvidos: number;
    cancelados: number; descartados: number;
  } | null>(null);

  const cancelRef = useRef(false);

  const resetState = useCallback(() => {
    setFase(1);
    setFase1Done(false);
    setResumoFase1(null);
    setBatchAtual(0);
    setTotalBatches(0);
    setPedidosProcessados(0);
    setTotalPedidos(0);
    setResultados([]);
    setResumoGeral(null);
    cancelRef.current = false;
  }, []);

  async function handleSubmit(dateFrom: string, dateTo: string) {
    resetState();
    setPeriodo({ from: dateFrom, to: dateTo });
    setLoading(true);
    setMode('processing');

    try {
      // ── Fase 1: listar e classificar pedidos ──────────────────────────────
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
      setResumoFase1({
        vendidos:    fase1.totalVendidos,
        devolvidos:  fase1.totalDevolvidos,
        cancelados:  fase1.totalCancelados,
        descartados: fase1.descartados,
      });

      if (cancelRef.current) return;

      // ── Fase 2: buscar itens em batches ───────────────────────────────────
      setFase(2);

      // Processar os 3 grupos em sequência: vendidos → devolvidos → cancelados
      const groups = [
        { ids: fase1.vendidos,    items: [] as ItemBatch[], key: 'vendidos' },
        { ids: fase1.devolvidos,  items: [] as ItemBatch[], key: 'devolvidos' },
        { ids: fase1.cancelados,  items: [] as ItemBatch[], key: 'cancelados' },
      ];

      const allBatches = groups.flatMap(g =>
        chunks(g.ids, BATCH_SIZE).map(batch => ({ batch, group: g }))
      );

      setTotalBatches(allBatches.length);
      setTotalPedidos(fase1.totalVendidos + fase1.totalDevolvidos + fase1.totalCancelados);

      let processados = 0;

      for (let i = 0; i < allBatches.length; i++) {
        if (cancelRef.current) return;

        const { batch, group } = allBatches[i];

        const res = await fetch('/api/avaliacoes/devolucoes/itens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderIds: batch }),
        });

        if (res.ok) {
          const data = await res.json() as { items: ItemBatch[] };
          group.items.push(...data.items);
        }
        // Se falhar, continuar — não bloquear análise por erro de batch

        processados += batch.length;
        setBatchAtual(i + 1);
        setPedidosProcessados(processados);
      }

      if (cancelRef.current) return;

      // ── Fase 3: agregação (frontend) ──────────────────────────────────────
      const skus = aggregateBySKU(groups[0].items, groups[1].items, groups[2].items);

      const totalGeral = fase1.totalVendidos + fase1.totalDevolvidos + fase1.totalCancelados;

      setResultados(skus);
      setResumoGeral({
        totalPedidos: totalGeral,
        verificados:  fase1.totalVendidos,
        devolvidos:   fase1.totalDevolvidos,
        cancelados:   fase1.totalCancelados,
        descartados:  fase1.descartados,
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

  // ── Header ──────────────────────────────────────────────────────────────────

  function Header() {
    return (
      <header className="flex items-center justify-between px-6 py-3 bg-charme border-b border-charme/20 shrink-0">
        <div className="flex items-center gap-3">
          {mode === 'results' ? (
            <button
              onClick={handleNovaAnalise}
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-screen bg-charme-bg">
      <Header />
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-10">
        {mode === 'form' && (
          <DevolucoesForm onSubmit={handleSubmit} loading={loading} />
        )}
        {mode === 'processing' && (
          <DevolucoesProgress
            fase={fase}
            fase1Done={fase1Done}
            resumo={resumoFase1}
            batchAtual={batchAtual}
            totalBatches={totalBatches}
            pedidosProcessados={pedidosProcessados}
            totalPedidos={totalPedidos}
            onCancelar={handleCancelar}
          />
        )}
        {mode === 'results' && resumoGeral && (
          <DevolucoesResults
            resultados={resultados}
            resumo={resumoGeral}
            periodo={periodo}
          />
        )}
      </main>
    </div>
  );
}
