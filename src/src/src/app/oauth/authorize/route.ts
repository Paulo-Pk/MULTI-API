import { NextRequest } from 'next/server';
import { consumeJson, randomSecret, safeEqual, storeJson, readJson } from '@/lib/oauth-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Client = { client_id: string; client_name: string; redirect_uris: string[] };
type Pending = { clientId: string; redirectUri: string; state: string; challenge: string; scope: string; resource: string; csrf: string };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
function page(content: string, status = 200, headers: Record<string, string> = {}) {
  return new Response('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autorizar MCP</title><body style="font:16px system-ui;max-width:560px;margin:8vh auto;padding:24px;color:#18202b"><h1>Autorizar conexão MCP</h1>' + content + '</body></html>', {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') ?? '';
  const redirectUri = url.searchParams.get('redirect_uri') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const challenge = url.searchParams.get('code_challenge') ?? '';
  const method = url.searchParams.get('code_challenge_method') ?? '';
  const scope = url.searchParams.get('scope') ?? '';
  const resource = url.searchParams.get('resource') ?? '';
  if (url.searchParams.get('response_type') !== 'code' || !state || state.length > 512 ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || method !== 'S256' ||
      resource !== url.origin + '/api/mcp') {
    return page('<p>Solicitação OAuth inválida. É necessário authorization code, PKCE S256 e o recurso MCP correto.</p>', 400);
  }
  try {
    const client = await readJson<Client>('mcp:oauth:client:' + clientId);
    if (!client || !client.redirect_uris.includes(redirectUri)) return page('<p>Cliente ou endereço de retorno não registrado.</p>', 400);
    const csrf = randomSecret('csrf_');
    await storeJson('mcp:oauth:pending:' + csrf, { clientId, redirectUri, state, challenge, scope, resource, csrf } satisfies Pending, 600);
    const content = '<p>O aplicativo <strong>' + escapeHtml(client.client_name || 'Cliente MCP') + '</strong> solicita acesso às ferramentas deste servidor.</p><p>Provedores que não estiverem explicitamente liberados continuarão bloqueados.</p><form method="post"><input type="hidden" name="csrf" value="' + escapeHtml(csrf) + '"><label for="owner_token">Token administrativo do servidor</label><br><input id="owner_token" name="owner_token" type="password" autocomplete="current-password" required style="box-sizing:border-box;width:100%;padding:12px;margin:8px 0 18px"><button name="decision" value="approve" style="padding:12px 18px">Autorizar</button> <button name="decision" value="deny" formnovalidate style="padding:12px 18px">Cancelar</button></form><p style="color:#596579;font-size:13px">Use o valor de MCP_ACCESS_TOKEN configurado na Vercel. Não o compartilhe no chat.</p>';
    return page(content, 200, { 'Set-Cookie': 'mcp_oauth_csrf=' + csrf + '; HttpOnly; Secure; SameSite=Lax; Path=/oauth/authorize; Max-Age=600' });
  } catch (error) {
    console.error('[oauth] authorization request failed:', error instanceof Error ? error.message.slice(0, 240) : 'unknown error');
    return page('<p>O serviço de autorização está temporariamente indisponível.</p>', 503);
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const csrf = String(form.get('csrf') ?? '');
    const cookie = request.cookies.get('mcp_oauth_csrf')?.value ?? '';
    if (!csrf || !safeEqual(csrf, cookie)) return page('<p>Sessão inválida. Reinicie a conexão no cliente MCP.</p>', 400);
    const pending = await consumeJson<Pending>('mcp:oauth:pending:' + csrf);
    if (!pending || pending.csrf !== csrf) return page('<p>Solicitação expirada ou já utilizada.</p>', 400);
    const redirect = new URL(pending.redirectUri);
    if (String(form.get('decision') ?? '') !== 'approve') {
      redirect.searchParams.set('error', 'access_denied');
      redirect.searchParams.set('state', pending.state);
      return Response.redirect(redirect, 302);
    }
    const supplied = String(form.get('owner_token') ?? '');
    const expected = process.env.MCP_ACCESS_TOKEN ?? '';
    if (!expected || !safeEqual(supplied, expected)) return page('<p>Token administrativo incorreto. Reinicie a conexão.</p>', 401);
    const code = randomSecret('mcp_code_');
    await storeJson('mcp:oauth:code:' + code, {
      clientId: pending.clientId, redirectUri: pending.redirectUri, challenge: pending.challenge,
      scope: pending.scope, resource: pending.resource, issuedAt: Date.now(),
    }, 300);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', pending.state);
    return Response.redirect(redirect, 302);
  } catch {
    return page('<p>Não foi possível concluir a autorização.</p>', 503);
  }
}
