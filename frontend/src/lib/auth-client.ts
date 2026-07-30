const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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
