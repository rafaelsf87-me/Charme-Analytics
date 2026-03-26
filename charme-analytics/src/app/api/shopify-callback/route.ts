import { NextRequest, NextResponse } from 'next/server'

const SHOP = 'charmedodetalhe.myshopify.com'
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID!
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET!

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.json({ erro: 'Parâmetro code ausente' }, { status: 400 })
  }

  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
  })

  const data = await res.json()

  // Exibe o token na tela para copiar — remover após uso
  return new NextResponse(
    `<html><body style="font-family:monospace;padding:40px">
      <h2>Token gerado — copie e salve no .env.local</h2>
      <pre style="background:#111;color:#0f0;padding:20px;font-size:18px">${JSON.stringify(data, null, 2)}</pre>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
