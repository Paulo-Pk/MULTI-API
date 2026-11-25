export const metadata = {
  title: 'Claude Multi-AI MCP',
  description: 'Servidor MCP para conectar o Claude a provedores externos de IA.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
