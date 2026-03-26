import { NextResponse } from 'next/server'

const SHOP = 'charmedodetalhe.myshopify.com'
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID!
const SCOPES = 'read_orders,read_customers,read_products'
const REDIRECT_URI = 'http://localhost:3000/api/shopify-callback'

export async function GET() {
  const authUrl =
    `https://${SHOP}/admin/oauth/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`

  return NextResponse.redirect(authUrl)
}
