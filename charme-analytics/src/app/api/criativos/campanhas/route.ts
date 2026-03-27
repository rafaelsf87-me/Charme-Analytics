import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';

interface Campanha {
  id: string;
  name: string;
}

// ─── Auth Google ───────────────────────────────────────────────────────────────

let gadsOAuthClient: OAuth2Client | null = null;

async function getGadsToken(): Promise<string> {
  if (!gadsOAuthClient) {
    gadsOAuthClient = new OAuth2Client(
      process.env.GOOGLE_ADS_CLIENT_ID,
      process.env.GOOGLE_ADS_CLIENT_SECRET
    );
    gadsOAuthClient.setCredentials({ refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN });
  }
  const { token } = await gadsOAuthClient.getAccessToken();
  if (!token) throw new Error('Token Google Ads indisponível');
  return token;
}

const GADS_ENDPOINT = () =>
  `https://googleads.googleapis.com/v20/customers/${
    (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '')
  }/googleAds:searchStream`;

const GRAPH = 'https://graph.facebook.com/v21.0';

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channel = searchParams.get('channel') as 'google' | 'meta' | null;
  const search = (searchParams.get('search') ?? '').trim();

  if (!channel || !search) {
    return NextResponse.json([], { status: 200 });
  }

  try {
    if (channel === 'google') {
      const token = await getGadsToken();
      const gaql = `
        SELECT campaign.id, campaign.name
        FROM campaign
        WHERE campaign.status = 'ENABLED'
          AND campaign.name LIKE '%${search.replace(/'/g, "\\'")}%'
        ORDER BY campaign.name
        LIMIT 20
      `.trim();

      const res = await fetch(GADS_ENDPOINT(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
          'login-customer-id': (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/-/g, ''),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: gaql }),
      });

      if (!res.ok) return NextResponse.json([]);

      const text = await res.text();
      const campanhas: Campanha[] = [];

      try {
        const parsed = JSON.parse(text);
        const chunks = Array.isArray(parsed) ? parsed : [parsed];
        for (const chunk of chunks) {
          for (const row of chunk.results ?? []) {
            campanhas.push({ id: row.campaign?.id ?? '', name: row.campaign?.name ?? '' });
          }
        }
      } catch {
        for (const line of text.split('\n').filter(Boolean)) {
          try {
            const chunk = JSON.parse(line);
            for (const row of chunk.results ?? []) {
              campanhas.push({ id: row.campaign?.id ?? '', name: row.campaign?.name ?? '' });
            }
          } catch { /* ignora */ }
        }
      }

      return NextResponse.json(campanhas.filter(c => c.id && c.name));
    }

    if (channel === 'meta') {
      const token = process.env.META_ACCESS_TOKEN ?? '';
      const rawId = process.env.META_AD_ACCOUNT_ID ?? '';
      const accountId = rawId.startsWith('act_') ? rawId : `act_${rawId}`;
      const filtering = JSON.stringify([
        { field: 'name', operator: 'CONTAIN', value: search },
      ]);

      const url =
        `${GRAPH}/${accountId}/campaigns` +
        `?fields=id,name` +
        `&filtering=${encodeURIComponent(filtering)}` +
        `&limit=20` +
        `&access_token=${token}`;

      const res = await fetch(url);
      if (!res.ok) return NextResponse.json([]);

      const json = await res.json() as { data?: Array<{ id: string; name: string }> };
      return NextResponse.json(json.data ?? []);
    }

    return NextResponse.json([]);
  } catch {
    return NextResponse.json([]);
  }
}
