import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

type RedisValue = string | null;

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Armazenamento OAuth indisponível: configure o Upstash Redis.');
  return { url: url.replace(/\/$/, ''), token };
}

export async function redisCommand<T = unknown>(command: (string | number)[]): Promise<T> {
  const { url, token } = redisConfig();
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Falha no armazenamento OAuth (' + response.status + ').');
  const payload = await response.json() as { result?: T; error?: string };
  if (payload.error) throw new Error('Falha no armazenamento OAuth.');
  return payload.result as T;
}

export function randomSecret(prefix = ''): string {
  return prefix + randomBytes(32).toString('base64url');
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function storeJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await redisCommand(['SET', key, JSON.stringify(value), 'EX', ttlSeconds]);
}

export async function readJson<T>(key: string): Promise<T | null> {
  const value = await redisCommand<RedisValue>(['GET', key]);
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export async function consumeJson<T>(key: string): Promise<T | null> {
  const value = await redisCommand<RedisValue>(['GETDEL', key]);
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export async function storeOAuthAccessToken(token: string, record: { clientId: string; scope: string; resource: string; issuedAt: number }, ttlSeconds: number) {
  const digest = createHash('sha256').update(token).digest('hex');
  await storeJson('mcp:oauth:access:' + digest, record, ttlSeconds);
}

export async function storeOAuthRefreshToken(token: string, record: { clientId: string; scope: string; resource: string }, ttlSeconds: number): Promise<void> {
  const digest = createHash('sha256').update(token).digest('hex');
  await storeJson('mcp:oauth:refresh:' + digest, record, ttlSeconds);
}

export async function readOAuthRefreshToken(token: string): Promise<{ clientId: string; scope: string; resource: string } | null> {
  const digest = createHash('sha256').update(token).digest('hex');
  return readJson<{ clientId: string; scope: string; resource: string }>('mcp:oauth:refresh:' + digest);
}

export async function consumeOAuthRefreshToken(token: string): Promise<{ clientId: string; scope: string; resource: string } | null> {
  const digest = createHash('sha256').update(token).digest('hex');
  return consumeJson<{ clientId: string; scope: string; resource: string }>('mcp:oauth:refresh:' + digest);
}

export async function isOAuthAccessTokenValid(token: string, resource: string): Promise<boolean> {
  if (!token.startsWith('mcp_oauth_')) return false;
  try {
    const digest = createHash('sha256').update(token).digest('hex');
    const record = await readJson<{ clientId: string; issuedAt: number; resource: string }>('mcp:oauth:access:' + digest);
    return Boolean(record && Number.isFinite(record.issuedAt) && record.resource === resource);
  } catch {
    return false;
  }
}
