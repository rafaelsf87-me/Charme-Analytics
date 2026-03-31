import type { CreativeRow } from '@/app/api/criativos/route';

interface CreativeCellProps {
  row: CreativeRow;
}

function adUrl(row: CreativeRow): string | null {
  if (row.platform === 'meta' && row.adId && row.accountId) {
    const accountNum = row.accountId.replace('act_', '');
    return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountNum}&selected_ad_ids=${row.adId}`;
  }
  return null;
}

function CopyIdButton({ adId }: { adId: string }) {
  return (
    <button
      type="button"
      onClick={e => { e.preventDefault(); navigator.clipboard.writeText(adId); }}
      className="ml-1 text-[9px] text-zinc-300 hover:text-zinc-500 transition-colors px-0.5 rounded"
      title="Copiar ID"
    >
      ⎘
    </button>
  );
}

export function CreativeCell({ row }: CreativeCellProps) {
  const url = adUrl(row);

  const adIdLine = (
    <div className="flex items-center mt-0.5">
      <span className="text-[10px] text-zinc-400 font-mono truncate">
        {row.platform === 'google' ? 'G' : 'M'}:{row.adId}
      </span>
      {row.platform === 'google' && <CopyIdButton adId={row.adId} />}
    </div>
  );

  const creativeTypeLine = row.creativeType ? (
    <span className="block text-[10px] text-zinc-400 leading-tight mt-0.5">
      {row.creativeType}
    </span>
  ) : null;

  const metaLine = (
    <div className="min-w-0">
      {adIdLine}
      {creativeTypeLine}
    </div>
  );

  const linkProps = url
    ? { href: url, target: '_blank', rel: 'noopener noreferrer' }
    : {};
  const Wrap = url ? 'a' : 'div';

  // Com thumbnail (Meta imagem / PMax imagem)
  if (row.thumbnailUrl && row.thumbnailUrl !== '__video__') {
    return (
      <div className="flex items-start gap-2 min-w-0">
        <Wrap {...linkProps} className="relative shrink-0 group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={row.thumbnailUrl}
            alt={row.headline ?? row.adName}
            width={64}
            height={64}
            className="w-16 h-16 rounded-md object-cover border border-zinc-100 group-hover:opacity-80 transition-opacity"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          {url && (
            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="bg-black/60 text-white text-[9px] rounded px-1 py-0.5">ver anúncio</span>
            </span>
          )}
        </Wrap>
        <div className="min-w-0 flex-1">
          {row.headline && (
            <span className="block text-xs font-medium text-zinc-800 truncate leading-tight" title={row.headline}>
              {row.headline}
            </span>
          )}
          {row.description && (
            <span className="block text-xs text-zinc-500 truncate leading-tight mt-0.5" title={row.description}>
              {row.description}
            </span>
          )}
          {metaLine}
        </div>
      </div>
    );
  }

  // Vídeo (Meta vídeo / PMax YouTube)
  if (row.thumbnailUrl === '__video__') {
    return (
      <div className="flex items-start gap-2 min-w-0">
        <Wrap {...linkProps} className="shrink-0 w-16 h-16 rounded-md bg-zinc-100 border border-zinc-200 flex items-center justify-center hover:bg-zinc-200 transition-colors">
          <span className="text-2xl">▶</span>
        </Wrap>
        <div className="min-w-0 flex-1">
          {row.headline && (
            <span className="block text-xs font-medium text-zinc-800 truncate" title={row.headline}>
              {row.headline}
            </span>
          )}
          {metaLine}
        </div>
      </div>
    );
  }

  // Google texto / Shopping / sem preview visual
  if (row.adText || row.headline) {
    const lines = (row.adText ?? row.headline ?? '').split('\n');
    return (
      <div className="min-w-0">
        <span className="block text-xs font-medium text-zinc-800 truncate leading-tight" title={lines[0]}>
          {lines[0]}
        </span>
        {lines[1] && (
          <span className="block text-xs text-zinc-500 truncate leading-tight mt-0.5" title={lines[1]}>
            {lines[1]}
          </span>
        )}
        {metaLine}
      </div>
    );
  }

  // Fallback (Shopping sem texto, etc.)
  return (
    <div className="min-w-0">
      <div className="w-16 h-16 rounded-md bg-zinc-100 border border-zinc-200 flex items-center justify-center mb-1">
        <span className="text-zinc-400 text-xs">Sem preview</span>
      </div>
      {metaLine}
    </div>
  );
}
