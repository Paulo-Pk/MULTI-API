import { NextRequest } from 'next/server';
import { consumeJson, randomSecret, storeOAuthAccessToken } from '@/lib/oauth-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CodeRecord = { clientId: string; redirectUri: string; challenge: string; scope: string; resource: string; issuedAt: number };

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const grantType = String(form.get('grant_type') ?? '');
    const code = String(form.get('code') ?? '');
    const clientId = String(form.get('client_id') ?? '');
    const redirectUri = String(form.get('redirect_uri') ?? '');
    const verifier = String(form.get('code_verifier') ?? '');
    const resource = String(form.get('resource') ?? '');
    if (grantType !== 'authorization_code' || !code || !clientId || !redirectUri ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      return Response.json({ error: 'invalid_request' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const record = await consumeJson<CodeRecord>('mcp:oauth:code:' + code);
    if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri ||
        record.resource !== resource || Date.now() - record.issuedAt > 300000) {
      return Response.json({ error: 'invalid_grant' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = Buffer.from(digest).toString('base64url');
    if (challenge !== record.challenge) {
      return Response.json({ error: 'invalid_grant' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const accessToken = randomSecret('mcp_oauth_');
    const expiresIn = 3600;
    await storeOAuthAccessToken(accessToken, {
      clientId, scope: record.scope, resource: record.resource, issuedAt: Date.now(),
    }, expiresIn);
    return Response.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: record.scope,
    }, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  } catch {
    return Response.json({ error: 'server_error', error_description: 'Serviço de tokens indisponível.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
