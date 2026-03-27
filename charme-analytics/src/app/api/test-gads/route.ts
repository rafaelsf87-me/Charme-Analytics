import { NextResponse } from 'next/server';

export async function GET() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET ?? '';
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN ?? '';
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '';
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '');
  const loginId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/-/g, '');

  // Troca manual do refresh token — sem google-auth-library
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json({
      etapa: 'token_exchange',
      status: tokenRes.status,
      erro: tokenData,
      dica: 'Refresh token inválido ou client_id/secret incorretos',
    });
  }

  const accessToken: string = tokenData.access_token;

  // Testa chamada real à API
  const url = `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:searchStream`;
  const gaql = `SELECT campaign.name, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '2026-03-01' AND '2026-03-26' LIMIT 1`;

  const apiRes = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': devToken,
      'login-customer-id': loginId || customerId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: gaql }),
  });

  const apiText = await apiRes.text();

  return NextResponse.json({
    etapa: 'api_call',
    tokenOk: true,
    apiStatus: apiRes.status,
    apiResponse: apiText.slice(0, 800),
    customerId,
    loginId,
  });
}
