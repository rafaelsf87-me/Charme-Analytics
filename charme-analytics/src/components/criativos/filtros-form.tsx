'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type Canal = 'google' | 'meta' | 'all';
export type SortBy = 'spend' | 'roas' | 'conversions' | 'impressions' | 'clicks' | 'ctr';

export interface FiltrosState {
  channel: Canal;
  dateFrom: string;
  dateTo: string;
  campaignTypes: string[];
  campaignId?: string;
  campaignName?: string;
  limit: number;
  sortBy: SortBy;
}

interface Campanha {
  id: string;
  name: string;
}

interface FiltrosFormProps {
  onSubmit: (filtros: FiltrosState) => void;
  loading?: boolean;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const GOOGLE_TYPES = [
  { value: 'SEARCH', label: 'Keyword (Search)' },
  { value: 'PERFORMANCE_MAX', label: 'PMax' },
  { value: 'DEMAND_GEN', label: 'Demand Gen' },
  { value: 'DISPLAY', label: 'Display' },
  { value: 'SHOPPING', label: 'Shopping' },
];

const META_TYPES = [
  { value: 'OUTCOME_SALES', label: 'Conversão' },
  { value: 'OUTCOME_TRAFFIC', label: 'Tráfego' },
  { value: 'OUTCOME_AWARENESS', label: 'Awareness' },
  { value: 'OUTCOME_LEADS', label: 'Leads' },
];

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'spend', label: 'Spend' },
  { value: 'roas', label: 'ROAS' },
  { value: 'conversions', label: 'Conversões' },
  { value: 'impressions', label: 'Impressões' },
  { value: 'clicks', label: 'Cliques' },
  { value: 'ctr', label: 'CTR' },
];

// ─── Helper de datas ──────────────────────────────────────────────────────────

// "Ontem" é sempre o fim padrão — dados do dia atual são parciais
function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function subtractDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function subtractMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().split('T')[0];
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function FiltrosForm({ onSubmit, loading = false }: FiltrosFormProps) {
  const [channel, setChannel] = useState<Canal>('meta');
  const [dateFrom, setDateFrom] = useState(subtractDays(7));
  const [dateTo, setDateTo] = useState(yesterday());
  const [campaignTypes, setCampaignTypes] = useState<string[]>([]);
  const [campaignSearch, setCampaignSearch] = useState('');
  const [campaignId, setCampaignId] = useState<string | undefined>();
  const [campaignName, setCampaignName] = useState<string | undefined>();
  const [limit, setLimit] = useState(20);
  const [sortBy, setSortBy] = useState<SortBy>('spend');
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dateError, setDateError] = useState('');
  const [activeAtalho, setActiveAtalho] = useState<string | null>('7d');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Busca campanhas com debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!campaignSearch.trim()) {
      setCampanhas([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const ch = channel === 'all' ? 'google' : channel;
        const res = await fetch(
          `/api/criativos/campanhas?channel=${ch}&search=${encodeURIComponent(campaignSearch)}`
        );
        if (res.ok) {
          const data: Campanha[] = await res.json();
          setCampanhas(data);
          setShowDropdown(data.length > 0);
        }
      } catch {
        // silencioso — endpoint ainda não existe
      }
    }, 500);
  }, [campaignSearch, channel]);

  // Validar datas
  function validateDates(from: string, to: string): string {
    if (!from || !to) return 'Período obrigatório';
    const f = new Date(from);
    const t = new Date(to);
    if (f > t) return 'Data início deve ser anterior à data fim';
    const diffMs = t.getTime() - f.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > 183) return 'Período máximo: 6 meses';
    return '';
  }

  function handleDateFrom(v: string) {
    setDateFrom(v);
    setActiveAtalho(null);
    setDateError(validateDates(v, dateTo));
  }

  function handleDateTo(v: string) {
    setDateTo(v);
    setActiveAtalho(null);
    setDateError(validateDates(dateFrom, v));
  }

  function handleAtalho(days: number | null, months: number | null, label: string) {
    const to = yesterday(); // fim sempre ontem — dados de hoje são parciais
    const from = months ? subtractMonths(months) : subtractDays(days!);
    setDateFrom(from);
    setDateTo(to);
    setActiveAtalho(label);
    setDateError('');
  }

  function toggleCampaignType(value: string) {
    setCampaignTypes(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateDates(dateFrom, dateTo);
    if (err) { setDateError(err); return; }
    onSubmit({ channel, dateFrom, dateTo, campaignTypes, campaignId, campaignName, limit, sortBy });
  }

  const allTypes = channel === 'google' ? GOOGLE_TYPES : channel === 'meta' ? META_TYPES : [...GOOGLE_TYPES, ...META_TYPES];
  const isAllChecked = campaignTypes.length === 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-8">

      {/* Canal */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-2">Canal</label>
        <div className="flex gap-2">
          {(['google', 'meta', 'all'] as Canal[]).map(c => (
            <button
              key={c}
              type="button"
              onClick={() => { setChannel(c); setCampaignTypes([]); setCampaignSearch(''); setCampaignId(undefined); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                channel === c
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'
              }`}
            >
              {c === 'google' ? 'Google Ads' : c === 'meta' ? 'Meta Ads' : 'Todos'}
            </button>
          ))}
        </div>
      </div>

      {/* Período */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-2">Período</label>
        <div className="flex gap-3 mb-3">
          <input
            type="date"
            value={dateFrom}
            max={dateTo}
            onChange={e => handleDateFrom(e.target.value)}
            className="h-8 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-700 focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
          <input
            type="date"
            value={dateTo}
            min={dateFrom}
            max={yesterday()}
            onChange={e => handleDateTo(e.target.value)}
            className="h-8 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-700 focus:outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
        {dateError && <p className="text-xs text-red-500 mb-2">{dateError}</p>}
        <div className="flex flex-wrap gap-2">
          {[
            { label: '7d', days: 7 },
            { label: '15d', days: 15 },
            { label: '30d', days: 30 },
            { label: '60d', days: 60 },
            { label: '90d', days: 90 },
            { label: '6m', months: 6 },
          ].map(a => (
            <button
              key={a.label}
              type="button"
              onClick={() => handleAtalho(a.days ?? null, a.months ?? null, a.label)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                activeAtalho === a.label
                  ? 'bg-zinc-800 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tipo de Campanha */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-2">Tipo de Campanha</label>
        <div className="border border-zinc-200 rounded-lg bg-white divide-y divide-zinc-100">
          {/* Todas */}
          <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-zinc-50">
            <input
              type="checkbox"
              checked={isAllChecked}
              onChange={() => setCampaignTypes([])}
              className="rounded border-zinc-300 accent-zinc-900"
            />
            <span className="text-sm text-zinc-700 font-medium">Todas</span>
          </label>

          {/* Separador Google */}
          {(channel === 'google' || channel === 'all') && (
            <>
              {channel === 'all' && (
                <div className="px-4 py-1.5 bg-zinc-50 flex items-center gap-1.5">
                  {/* Google "G" icon */}
                  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Google</span>
                </div>
              )}
              {GOOGLE_TYPES.map(t => (
                <label key={t.value} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-zinc-50">
                  <input
                    type="checkbox"
                    checked={campaignTypes.includes(t.value)}
                    onChange={() => toggleCampaignType(t.value)}
                    className="rounded border-zinc-300 accent-zinc-900"
                  />
                  <span className="text-sm text-zinc-600">{t.label}</span>
                </label>
              ))}
            </>
          )}

          {/* Separador Meta */}
          {(channel === 'meta' || channel === 'all') && (
            <>
              {channel === 'all' && (
                <div className="px-4 py-1.5 bg-zinc-50 flex items-center gap-1.5">
                  {/* Meta icon */}
                  <svg width="14" height="8" viewBox="0 0 40 20" aria-hidden="true">
                    <path d="M4 10.5C4 7.46 5.37 5 7.08 5c.9 0 1.79.68 2.72 2.1L13 12.5c1.13 1.75 2.36 2.5 3.5 2.5s2.37-.75 3.5-2.5l3.2-5.4C24.13 5.68 25.02 5 25.92 5 27.63 5 29 7.46 29 10.5s-1.37 5.5-3.08 5.5c-.9 0-1.79-.68-2.72-2.1L20 8.5c-1.13-1.75-2.36-2.5-3.5-2.5S14.13 6.75 13 8.5l-3.2 5.4C8.87 15.32 7.98 16 7.08 16 5.37 16 4 13.54 4 10.5z" fill="#0082FB"/>
                    <path d="M29 10.5c0-3.04 1.37-5.5 3.08-5.5C33.79 5 35 7.02 35 10c0 1.97-.61 3.53-1.54 4.29-.45.37-.96.52-1.46.4-.62-.16-1.12-.73-1.44-1.57C30.2 12.1 29 11.1 29 10.5z" fill="#0082FB"/>
                  </svg>
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Meta</span>
                </div>
              )}
              {META_TYPES.map(t => (
                <label key={t.value} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-zinc-50">
                  <input
                    type="checkbox"
                    checked={campaignTypes.includes(t.value)}
                    onChange={() => toggleCampaignType(t.value)}
                    className="rounded border-zinc-300 accent-zinc-900"
                  />
                  <span className="text-sm text-zinc-600">{t.label}</span>
                </label>
              ))}
            </>
          )}
        </div>
        {/* Mostra selecionados */}
        {!isAllChecked && (
          <p className="mt-1.5 text-xs text-zinc-400">
            {campaignTypes.length} tipo(s) selecionado(s):{' '}
            {campaignTypes.map(v => allTypes.find(t => t.value === v)?.label ?? v).join(', ')}
          </p>
        )}
      </div>

      {/* Campanha específica */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-2">
          Campanha específica <span className="text-zinc-400 font-normal">(opcional)</span>
        </label>
        <div ref={dropdownRef} className="relative">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">🔍</span>
            <Input
              type="text"
              value={campaignName ?? campaignSearch}
              placeholder="Buscar campanha por nome..."
              className="pl-8"
              onChange={e => {
                setCampaignSearch(e.target.value);
                setCampaignId(undefined);
                setCampaignName(undefined);
              }}
              onFocus={() => campanhas.length > 0 && setShowDropdown(true)}
            />
            {(campaignId || campaignSearch) && (
              <button
                type="button"
                onClick={() => { setCampaignSearch(''); setCampaignId(undefined); setCampaignName(undefined); setCampanhas([]); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>
          {showDropdown && (
            <div className="absolute z-10 mt-1 w-full bg-white border border-zinc-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {campanhas.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setCampaignId(c.id); setCampaignName(c.name); setCampaignSearch(''); setShowDropdown(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 truncate"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {campaignId && (
          <p className="mt-1 text-xs text-zinc-400">ID: {campaignId}</p>
        )}
      </div>

      {/* Quantidade e Ordenação — linha */}
      <div className="flex flex-wrap gap-6">
        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-2">Quantidade de criativos</label>
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="h-8 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-700 focus:outline-none focus:border-zinc-400"
          >
            {[10, 20, 30, 50].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          {channel === 'all' && (
            <p className="mt-1 text-xs text-zinc-400">Por canal (total até {limit * 2})</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 mb-2">Ordenar por</label>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortBy)}
            className="h-8 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-700 focus:outline-none focus:border-zinc-400"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Submit */}
      <Button
        type="submit"
        disabled={loading || !!dateError || !dateFrom || !dateTo}
        className="w-full h-10 text-sm font-medium"
      >
        {loading ? 'Consultando...' : '🚀 Gerar Relatório'}
      </Button>
    </form>
  );
}
