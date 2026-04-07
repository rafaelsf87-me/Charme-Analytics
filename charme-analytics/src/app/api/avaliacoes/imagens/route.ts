import { NextRequest, NextResponse } from 'next/server';

export interface ProdutoImagem {
  handle: string;
  title: string;
  imageUrl: string | null;
  imageAlt: string | null;
}

interface ShopifyProduct {
  handle: string;
  title: string;
  featuredImage: { url: string; altText: string | null } | null;
}

interface ShopifyEdge {
  node: ShopifyProduct;
}

interface ShopifyResponse {
  data?: {
    products: {
      edges: ShopifyEdge[];
    };
  };
  errors?: { message: string }[];
}

const BATCH_SIZE = 50;

async function fetchImagesBatch(handles: string[]): Promise<ProdutoImagem[]> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!domain || !token) {
    return handles.map(h => ({ handle: h, title: h, imageUrl: null, imageAlt: null }));
  }

  const queryStr = handles.map(h => `handle:${h}`).join(' OR ');
  const query = `{
    products(first: ${BATCH_SIZE}, query: "${queryStr}") {
      edges {
        node {
          handle
          title
          featuredImage {
            url
            altText
          }
        }
      }
    }
  }`;

  const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    return handles.map(h => ({ handle: h, title: h, imageUrl: null, imageAlt: null }));
  }

  const data: ShopifyResponse = await res.json();
  const edges = data.data?.products?.edges ?? [];

  const found = new Map<string, ProdutoImagem>();
  for (const edge of edges) {
    const p = edge.node;
    found.set(p.handle, {
      handle: p.handle,
      title: p.title,
      imageUrl: p.featuredImage?.url ?? null,
      imageAlt: p.featuredImage?.altText ?? null,
    });
  }

  return handles.map(h =>
    found.get(h) ?? { handle: h, title: h, imageUrl: null, imageAlt: null }
  );
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

  const resultados: ProdutoImagem[] = [];

  for (let i = 0; i < handles.length; i += BATCH_SIZE) {
    const batch = handles.slice(i, i + BATCH_SIZE);
    try {
      const imgs = await fetchImagesBatch(batch);
      resultados.push(...imgs);
    } catch {
      resultados.push(...batch.map(h => ({ handle: h, title: h, imageUrl: null, imageAlt: null })));
    }
  }

  return NextResponse.json({ imagens: resultados });
}
