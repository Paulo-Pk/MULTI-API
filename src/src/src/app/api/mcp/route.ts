import { createMcpHandler } from 'mcp-handler';
import { timingSafeEqual } from 'node:crypto';
import { isOAuthAccessTokenValid } from '@/lib/oauth-store';
import { z } from 'zod';

const providers = {
  nvidia: { env: 'NVIDIA_API_KEY', url: 'https://integrate.api.nvidia.com/v1/chat/completions' },
  gemini: { env: 'GEMINI_API_KEY', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' },
  openrouter: { env: 'OPENROUTER_API_KEY', url: 'https://openrouter.ai/api/v1/chat/completions' },
  groq: { env: 'GROQ_API_KEY', url: 'https://api.groq.com/openai/v1/chat/completions' },
  deepseek: { env: 'DEEPSEEK_API_KEY', url: 'https://api.deepseek.com/chat/completions' },
  mistral: { env: 'MISTRAL_API_KEY', url: 'https://api.mistral.ai/v1/chat/completions' },
  openai: { env: 'OPENAI_API_KEY', url: 'https://api.openai.com/v1/chat/completions' },
  together: { env: 'TOGETHER_API_KEY', url: 'https://api.together.xyz/v1/chat/completions' },
  cerebras: { env: 'CEREBRAS_API_KEY', url: 'https://api.cerebras.ai/v1/chat/completions' },
  sambanova: { env: 'SAMBANOVA_API_KEY', url: 'https://api.sambanova.ai/v1/chat/completions' },
  xai: { env: 'XAI_API_KEY', url: 'https://api.x.ai/v1/chat/completions' },
  cohere: { env: 'COHERE_API_KEY', url: 'https://api.cohere.com/compatibility/v1/chat/completions' },
  router: { env: 'NINEROUTER_API_KEY', url: '' },
} as const;

type Provider = keyof typeof providers;
const providerNames = Object.keys(providers) as Provider[];
const fallbackPriority: Provider[] = [
  'nvidia', 'gemini', 'openrouter', 'groq', 'deepseek', 'mistral',
  'openai', 'together', 'cerebras', 'sambanova', 'xai', 'cohere', 'router',
];

function allowedProviders(): Set<Provider> {
  const configured = (process.env.AI_ALLOWED_PROVIDERS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set(configured.filter((value): value is Provider =>
    providerNames.includes(value as Provider)
  ));
}

function isProviderAllowed(provider: Provider): boolean {
  return allowedProviders().has(provider);
}

async function callProvider(
  provider: Provider,
  model: string,
  prompt: string,
  system?: string,
  temperature?: number,
): Promise<string> {
  if (!isProviderAllowed(provider)) {
    throw new Error(provider + ': uso bloqueado; provedor não está em AI_ALLOWED_PROVIDERS');
  }

  const cfg = providers[provider];
  const key = process.env[cfg.env];
  if (!key) throw new Error(provider + ': chave não configurada');

  const base = provider === 'router' ? process.env.NINEROUTER_BASE_URL : cfg.url;
  if (!base) {
    throw new Error('NINEROUTER_BASE_URL não configurada; o 9Router precisa estar hospedado e acessível pela internet.');
  }

  let url: URL;
  try {
    const normalized = base.replace(/\/$/, '');
    url = new URL(normalized.endsWith('/chat/completions') ? normalized : normalized + '/chat/completions');
  } catch {
    throw new Error(provider + ': URL base inválida');
  }

  if (provider === 'router' && url.protocol !== 'https:') {
    throw new Error('9Router exige uma URL HTTPS pública; endereços localhost não são aceitos.');
  }

  const messages = [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    { role: 'user' as const, content: prompt },
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature }),
    signal: AbortSignal.timeout(45000),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(provider + ' HTTP ' + response.status + ': ' + raw.slice(0, 500));
  }

  let data: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(provider + ': resposta não é um JSON válido');
  }

  const answer = data.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer) {
    throw new Error(provider + ': resposta vazia ou formato inesperado');
  }
  return answer;
}

const providerSchema = z.enum(providerNames as [Provider, ...Provider[]]);
const handler = createMcpHandler((server) => {
  server.registerTool(
    'list_available_providers',
    {
      title: 'Listar provedores configurados',
      description: 'Mostra os provedores com chave configurada e informa quais estão explicitamente autorizados. Não revela segredos e não chama APIs.',
      inputSchema: z.object({}),
    },
    async () => {
      const allowed = allowedProviders();
      const configured = providerNames.filter((name) => Boolean(process.env[providers[name].env]));
      const active = configured.filter((name) => allowed.has(name));
      const blocked = configured.filter((name) => !allowed.has(name));
      const lines = [
        'Configurados e autorizados: ' + (active.length ? active.join(', ') : 'nenhum'),
        'Configurados, mas bloqueados: ' + (blocked.length ? blocked.join(', ') : 'nenhum'),
        'Provedores sem chave: ' + (providerNames.filter((name) => !configured.includes(name)).join(', ') || 'nenhum'),
      ];
      if (!allowed.size) lines.push('Proteção ativa: nenhuma chamada será feita até AI_ALLOWED_PROVIDERS ser configurada explicitamente.');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'ask_ai',
    {
      title: 'Consultar um modelo de IA',
      description: 'Consulta um provedor específico somente se ele estiver explicitamente autorizado em AI_ALLOWED_PROVIDERS. O uso pode consumir créditos no provedor.',
      inputSchema: z.object({
        provider: providerSchema,
        model: z.string().min(1).max(160),
        prompt: z.string().min(1).max(30000),
        system: z.string().max(8000).optional(),
        temperature: z.number().min(0).max(2).optional(),
      }),
    },
    async ({ provider, model, prompt, system, temperature }) => {
      try {
        const answer = await callProvider(provider, model, prompt, system, temperature);
        return { content: [{ type: 'text', text: answer }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : 'Falha desconhecida' }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'auto_fallback_ai',
    {
      title: 'Consultar IA com fallback automático',
      description: 'Tenta somente provedores explicitamente autorizados. A prioridade é NVIDIA, Gemini, OpenRouter, Groq, DeepSeek, Mistral e depois os demais. Não determina se um modelo é gratuito; autorize apenas provedores cujo uso você aceita.',
      inputSchema: z.object({
        candidates: z.array(z.object({
          provider: providerSchema,
          model: z.string().min(1).max(160),
        })).min(1).max(12),
        prompt: z.string().min(1).max(30000),
        system: z.string().max(8000).optional(),
        temperature: z.number().min(0).max(2).optional(),
      }),
    },
    async ({ candidates, prompt, system, temperature }) => {
      const priority = new Map(fallbackPriority.map((name, index) => [name, index]));
      const ordered = candidates
        .map((candidate, index) => ({ ...candidate, index }))
        .sort((a, b) => (priority.get(a.provider)! - priority.get(b.provider)!) || a.index - b.index);

      const failures: string[] = [];
      for (const candidate of ordered) {
        if (!isProviderAllowed(candidate.provider)) {
          failures.push(candidate.provider + '/' + candidate.model + ' — ignorado: provedor não autorizado');
          continue;
        }
        try {
          const answer = await callProvider(candidate.provider, candidate.model, prompt, system, temperature);
          return {
            content: [{
              type: 'text',
              text: 'Modelo utilizado: ' + candidate.provider + '/' + candidate.model + '\n\n' + answer,
            }],
          };
        } catch (error) {
          failures.push(candidate.provider + '/' + candidate.model + ' — ' +
            (error instanceof Error ? error.message : 'erro desconhecido'));
        }
      }

      return {
        content: [{
          type: 'text',
          text: 'Nenhum modelo autorizado conseguiu responder. Nenhuma chamada foi feita aos provedores não autorizados.\n' + failures.join('\n'),
        }],
        isError: true,
      };
    },
  );
});

function unauthorizedResponse(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Bearer' },
  });
}

async function authorize(req: Request): Promise<Response | null> {
  const expected = process.env.MCP_ACCESS_TOKEN;
  if (!expected) return new Response('MCP_ACCESS_TOKEN não configurado', { status: 503 });

  const origin = new URL(req.url).origin;
  const resourceMetadata = origin + '/.well-known/oauth-protected-resource/api/mcp';
  const received = req.headers.get('authorization') ?? '';
  const expectedHeader = 'Bearer ' + expected;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expectedHeader);
  if (receivedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(receivedBuffer, expectedBuffer)) return null;

  const token = received.startsWith('Bearer ') ? received.slice(7) : '';
  if (token && await isOAuthAccessTokenValid(token, origin + '/api/mcp')) return null;

  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Bearer resource_metadata="' + resourceMetadata + '"',
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(req: Request) {
  const denied = await authorize(req);
  return denied ?? handler(req);
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  return denied ?? handler(req);
}

export async function DELETE(req: Request) {
  const denied = await authorize(req);
  return denied ?? handler(req);
}
