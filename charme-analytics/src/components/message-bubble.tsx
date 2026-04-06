'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import {
  DataTable,
  DataTableHead,
  DataTableBody,
  DataTableRow,
  DataTableHeaderCell,
  DataTableCell,
} from '@/components/data-table';
import type { Message } from '@/lib/types';

interface MessageBubbleProps {
  message: Message;
  onRequestDetails?: () => void;
}

export function MessageBubble({ message, onRequestDetails }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [downloaded, setDownloaded] = useState(false);

  function handleDownload() {
    const now = new Date();
    const timestamp = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const filename = `charme-analytics-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.html`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Charme Analytics — ${timestamp}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 860px; margin: 40px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.6; }
    header { border-bottom: 2px solid #5b3f8c; padding-bottom: 12px; margin-bottom: 28px; display: flex; justify-content: space-between; align-items: center; }
    header h1 { font-size: 16px; color: #5b3f8c; margin: 0; font-weight: 600; }
    header span { font-size: 12px; color: #888; }
    h1, h2, h3 { color: #1a1a1a; margin-top: 24px; }
    h2 { font-size: 16px; border-bottom: 1px solid #e5e5e5; padding-bottom: 4px; }
    h3 { font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    th { background: #5b3f8c; color: white; padding: 8px 12px; text-align: left; font-weight: 600; }
    td { padding: 7px 12px; border-bottom: 1px solid #e5e5e5; }
    tr:nth-child(even) td { background: #f9f7fc; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; font-size: 12px; font-family: monospace; }
    pre { background: #f4f4f4; padding: 12px 16px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
    strong { font-weight: 600; }
    ul, ol { padding-left: 20px; }
    li { margin: 4px 0; }
    p { margin: 8px 0; }
    hr { border: none; border-top: 1px solid #e5e5e5; margin: 20px 0; }
  </style>
</head>
<body>
  <header>
    <h1>Charme Analytics</h1>
    <span>${timestamp}</span>
  </header>
  <div id="content"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    document.getElementById('content').innerHTML = marked.parse(${JSON.stringify(message.content)});
  </script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2000);
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-charme text-white px-4 py-2.5">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 max-w-full">
      <div className="prose prose-lg max-w-none text-zinc-800">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            table: ({ children }) => <DataTable>{children}</DataTable>,
            thead: ({ children }) => <DataTableHead>{children}</DataTableHead>,
            tbody: ({ children }) => <DataTableBody>{children}</DataTableBody>,
            tr: ({ children }) => {
              return <DataTableRow>{children}</DataTableRow>;
            },
            th: ({ children }) => <DataTableHeaderCell>{children}</DataTableHeaderCell>,
            td: ({ children }) => <DataTableCell>{children}</DataTableCell>,
            // Títulos com estilo adequado
            h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2 text-zinc-900">{children}</h1>,
            h2: ({ children }) => <h2 className="text-base font-semibold mt-3 mb-1.5 text-zinc-800">{children}</h2>,
            h3: ({ children }) => <h3 className="text-base font-semibold mt-2 mb-1 text-zinc-800">{children}</h3>,
            // Código inline
            code: ({ children }) => (
              <code className="bg-zinc-100 text-zinc-800 rounded px-1 py-0.5 text-sm font-mono">
                {children}
              </code>
            ),
            // Bloco de código
            pre: ({ children }) => (
              <pre className="bg-zinc-100 rounded-md p-3 overflow-x-auto text-sm font-mono my-2">
                {children}
              </pre>
            ),
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
      <div className="flex items-center justify-between mt-1">
        <button
          onClick={handleDownload}
          className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          {downloaded ? '✓ Baixado' : 'Download Resposta'}
        </button>
        {onRequestDetails && (
          <button
            onClick={onRequestDetails}
            className="text-xs text-zinc-300 hover:text-zinc-500 transition-colors"
          >
            Detalhes Técnicos
          </button>
        )}
      </div>
    </div>
  );
}
