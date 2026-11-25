export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: '64px auto', padding: 24, fontFamily: 'Arial, sans-serif', lineHeight: 1.6 }}>
      <h1>Claude Multi-AI MCP</h1>
      <p>Servidor MCP para conectar o Claude a provedores externos de IA.</p>
      <p><strong>Endpoint MCP:</strong> <code>/api/mcp</code></p>
      <p><strong>Ferramentas:</strong> <code>list_available_providers</code>, <code>ask_ai</code> e <code>auto_fallback_ai</code>.</p>
      <p>As chaves permanecem nas variáveis de ambiente da Vercel. Nenhum provedor é chamado sem autorização explícita em <code>AI_ALLOWED_PROVIDERS</code>.</p>
      <p>Esta página não executa testes nem chamadas aos provedores.</p>
    </main>
  );
}
