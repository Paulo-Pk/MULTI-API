import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  return Response.json({
    resource: origin + '/api/mcp',
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:tools'],
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
