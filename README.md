# Claude Multi-AI MCP

Servidor MCP hospedado na Vercel para consultar provedores de IA por meio das ferramentas MCP.

## Endpoint

`/api/mcp`

## Ferramentas

- `list_available_providers`: informa quais chaves estão configuradas e quais provedores estão autorizados. Não faz chamadas externas.
- `ask_ai`: consulta um provedor específico, somente quando autorizado.
- `auto_fallback_ai`: tenta os candidatos autorizados na prioridade definida no servidor.

## Proteção contra custos acidentais

O servidor é **fail-closed**. Se `AI_ALLOWED_PROVIDERS` não existir ou estiver vazia, nenhuma chamada a provedores é permitida, mesmo que existam chaves configuradas.

A variável aceita uma lista separada por vírgulas, por exemplo, somente depois de uma decisão consciente do proprietário:

`AI_ALLOWED_PROVIDERS=nvidia,gemini`

Não configure essa variável até decidir quais provedores podem ser usados e confirmar os limites/preços aplicáveis. Ter uma chave configurada não significa autorização para usá-la.

## Variáveis de ambiente

- `MCP_ACCESS_TOKEN`: token Bearer para proteger o endpoint MCP.
- `AI_ALLOWED_PROVIDERS`: allowlist explícita; vazia por padrão.
- Chaves opcionais: `NVIDIA_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `OPENAI_API_KEY`, `TOGETHER_API_KEY`, `CEREBRAS_API_KEY`, `SAMBANOVA_API_KEY`, `XAI_API_KEY`, `COHERE_API_KEY`, `NINEROUTER_API_KEY`.
- Para 9Router: `NINEROUTER_BASE_URL`.

Nenhuma chave deve ser colocada no código-fonte ou no repositório.

## Ordem do fallback

NVIDIA → Gemini → OpenRouter → Groq → DeepSeek → Mistral → OpenAI → Together → Cerebras → SambaNova → xAI → Cohere → 9Router.

## Autenticação

O endpoint mantém a autenticação Bearer existente com `MCP_ACCESS_TOKEN`. Este projeto não implementa OAuth 2.1 nesta versão.

## Custos e testes

O build não chama APIs de IA. Não há testes de provedores executados automaticamente. Chamadas só ocorrem quando o cliente invoca uma ferramenta e o provedor está explicitamente autorizado.
