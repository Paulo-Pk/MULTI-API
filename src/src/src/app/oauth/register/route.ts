import { NextRequest } from 'next/server';
import { randomSecret, storeJson } from '@/lib/oauth-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  } catch { return false; }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const redirects = body.redirect_uris;
    if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > 10 || !redirects.every(validRedirectUri)) {
      return Response.json({ error: 'invalid_client_metadata', error_description: 'redirect_uris inválidas.' }, { status: 400 });
    }
    if ((body.token_endpoint_auth_method ?? 'none') !== 'none') {
      return Response.json({ error: 'invalid_client_metadata', error_description: 'Somente clientes públicos com PKCE são aceitos.' }, { status: 400 });
    }
    const grants = body.grant_types ?? ['authorization_code', 'refresh_token'];
    const responses = body.response_types ?? ['code'];
    if (!Array.isArray(grants) || !grants.includes('authorization_code') ||
        grants.some((grant) => !['authorization_code', 'refresh_token'].includes(String(grant)) ) ||
        !Array.isArray(responses) || !responses.includes('code')) {
      return Response.json({ error: 'invalid_client_metadata' }, { status: 400 });
    }
    const clientId = randomSecret('mcp_client_');
    const client = {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: typeof body.client_name === 'string' ? body.client_name.slice(0, 120) : 'Cliente MCP',
      redirect_uris: redirects,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
    await storeJson('mcp:oauth:client:' + clientId, client, 31536000);
    return Response.json(client, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'server_error', error_description: 'Registro OAuth indisponível.' }, { status: 503 });
  }
}
