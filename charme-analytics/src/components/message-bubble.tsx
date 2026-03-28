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
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      <button
        onClick={handleCopy}
        className="self-start text-sm text-zinc-400 hover:text-zinc-600 transition-colors mt-1"
      >
        {copied ? '✓ Copiado' : 'Copiar'}
      </button>
    </div>
  );
}
