const API_URL = "/api"; // passa pelo rewrite do Next.js

export type ProfissionalPublico = {
  nome: string;
  locais: { id: number; nome: string }[];
};

export type SessaoPublica = {
  id: number;
  data_hora: string;
  duracao_minutos: number;
  modalidade: "presencial" | "teleconsulta";
  status: string;
  local_nome: string;
};

export type PerfilPublico = {
  nome: string | null;
  telefone: string | null;
  email: string | null;
};

async function fetchPublico<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail ?? "Algo deu errado.");
  }
  return res.json();
}

export function getHorariosPublico(
  slug: string, localId: number, data: string, token: string
): Promise<{ horarios: string[] }> {
  return fetchPublico(`/publico/horarios?slug=${slug}&local_id=${localId}&data=${data}`, token);
}

export function agendarPublico(
  token: string,
  body: {
    slug: string;
    local_id: number;
    data_hora: string;
    duracao_minutos?: number;
    modalidade?: string;
    nome?: string;
    telefone?: string;
    email?: string;
    data_nascimento?: string;
    consentimento_lgpd?: boolean;
    procedimento_estimulacao?: boolean;
  }
) {
  return fetchPublico<{ sessao_id: number; data_hora: string }>("/publico/agendar", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getMeuPerfil(slug: string, token: string): Promise<PerfilPublico> {
  return fetchPublico(`/publico/meu-perfil?slug=${slug}`, token);
}

export function getMinhasSessoes(slug: string, token: string): Promise<SessaoPublica[]> {
  return fetchPublico(`/publico/minhas-sessoes?slug=${slug}`, token);
}

export function cancelarSessaoPublica(sessaoId: number, slug: string, token: string) {
  return fetchPublico(`/publico/sessoes/${sessaoId}/cancelar?slug=${slug}`, token, {
    method: "PATCH",
  });
}
