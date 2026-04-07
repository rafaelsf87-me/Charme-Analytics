import { NextRequest, NextResponse } from 'next/server';

export interface ProdutoImagem {
  handle: string;
  title: string;
  imageUrl: string | null;
  imageAlt: string | null;
}

interface ShopifyProductREST {
  handle: string;
  title: string;
  image?: { src: string; alt?: string } | null;
}

const CONCURRENT = 8; // requisições paralelas simultâneas

async function fetchOne(domain: string, token: string, handle: string): Promise<ProdutoImagem> {
  try {
    const res = await fetch(
      `https://${domain}/admin/api/2024-10/products.json?handle=${encodeURIComponent(handle)}&fields=handle,title,image`,
      {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!res.ok) {
      return { handle, title: handle, imageUrl: null, imageAlt: null };
    }

    const data: { products: ShopifyProductREST[] } = await res.json();
    const p = data.products?.[0];

    if (!p) return { handle, title: handle, imageUrl: null, imageAlt: null };

    return {
      handle: p.handle,
      title: p.title,
      imageUrl: p.image?.src ?? null,
      imageAlt: p.image?.alt ?? null,
    };
  } catch {
    return { handle, title: handle, imageUrl: null, imageAlt: null };
  }
}

export async function POST(request: NextRequest) {
  let body: { handles: string[] };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { handles } = body;

  if (!Array.isArray(handles) || handles.length === 0) {
    return NextResponse.json({ imagens: [] });
  }

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;

  // Sem credenciais → retornar placeholders
  if (!domain || !token) {
    return NextResponse.json({
      imagens: handles.map(h => ({ handle: h, title: h, imageUrl: null, imageAlt: null })),
    });
  }

  const resultados: ProdutoImagem[] = [];

  // Processar em lotes concorrentes
  for (let i = 0; i < handles.length; i += CONCURRENT) {
    const batch = handles.slice(i, i + CONCURRENT);
    const results = await Promise.all(batch.map(h => fetchOne(domain, token, h)));
    resultados.push(...results);
  }

  return NextResponse.json({ imagens: resultados });
}
