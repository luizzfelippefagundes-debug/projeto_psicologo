// caminho relativo — passa pelo rewrite do Next.js (next.config.ts), fazendo o cookie
// de sessão nascer no mesmo domínio do site (necessário quando front e back estão em
// domínios diferentes, senão o navegador recusa o cookie em páginas renderizadas no servidor)
const API_URL = "/api";

async function authFetch(path: string, body: Record<string, string>) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Algo deu errado. Tente novamente.");
  }

  return res.json();
}
  
export function signup(nome: string, email: string, senha: string) {
  return authFetch("/auth/signup", { nome, email, senha });
}

export function login(email: string, senha: string) {
  return authFetch("/auth/login", { email, senha });
}

export async function logout() {
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
}
