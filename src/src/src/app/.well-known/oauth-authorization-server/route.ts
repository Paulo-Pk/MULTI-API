import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const issuer = new URL(request.url).origin;
  return Response.json({
    issuer,
    authorization_endpoint: issuer + '/oauth/authorize',
    token_endpoint: issuer + '/oauth/token',
    registration_endpoint: issuer + '/oauth/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: false,
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
