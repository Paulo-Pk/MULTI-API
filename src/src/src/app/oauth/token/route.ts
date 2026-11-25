import { NextRequest } from 'next/server';
import {
  consumeJson,
  consumeOAuthRefreshToken,
  randomSecret,
  storeOAuthAccessToken,
  storeOAuthRefreshToken,
} from '@/lib/oauth-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CodeRecord = {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope: string;
  resource: string;
  issuedAt: number;
};

const ACCESS_TOKEN_TTL = 3600;
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30;

async function issueTokens(clientId: string, scope: string, resource: string) {
  const accessToken = randomSecret('mcp_oauth_');
  const refreshToken = randomSecret('mcp_refresh_');
  await storeOAuthAccessToken(accessToken, {
    clientId, scope, resource, issuedAt: Date.now(),
  }, ACCESS_TOKEN_TTL);
  await storeOAuthRefreshToken(refreshToken, {
    clientId, scope, resource,
  }, REFRESH_TOKEN_TTL);
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: refreshToken,
    scope,
  };
}

function oauthError(error: string, status = 400) {
  return Response.json({ error }, {
    status,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  });
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const grantType = String(form.get('grant_type') ?? '');
    const clientId = String(form.get('client_id') ?? '');
    if (!clientId) return oauthError('invalid_request');

    if (grantType === 'refresh_token') {
      const supplied = String(form.get('refresh_token') ?? '');
      if (!supplied.startsWith('mcp_refresh_')) return oauthError('invalid_grant');
      const record = await consumeOAuthRefreshToken(supplied);
      if (!record || record.clientId !== clientId) return oauthError('invalid_grant');
      const resource = String(form.get('resource') ?? '');
      if (resource && resource !== record.resource) return oauthError('invalid_target');
      const scope = String(form.get('scope') ?? '');
      if (scope && scope !== record.scope) return oauthError('invalid_scope');
      const tokens = await issueTokens(record.clientId, record.scope, record.resource);
      return Response.json(tokens, {
        headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
      });
    }

    if (grantType !== 'authorization_code') return oauthError('unsupported_grant_type');

    const code = String(form.get('code') ?? '');
    const redirectUri = String(form.get('redirect_uri') ?? '');
    const verifier = String(form.get('code_verifier') ?? '');
    const resource = String(form.get('resource') ?? '');
    if (!code || !redirectUri || !resource ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      return oauthError('invalid_request');
    }
    const record = await consumeJson<CodeRecord>('mcp:oauth:code:' + code);
    if (!record || record.clientId !== clientId || record.redirectUri !== redirectUri ||
        record.resource !== resource || Date.now() - record.issuedAt > 300000) {
      return oauthError('invalid_grant');
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = Buffer.from(digest).toString('base64url');
    if (challenge !== record.challenge) return oauthError('invalid_grant');

    const tokens = await issueTokens(clientId, record.scope, record.resource);
    return Response.json(tokens, {
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    });
  } catch {
    return Response.json({
      error: 'server_error',
      error_description: 'Serviço de tokens indisponível.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  }
}
