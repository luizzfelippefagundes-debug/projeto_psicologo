import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type {
  DashboardStats,
  Local,
  Paciente,
  RegraHorario,
  SessaoHistorico,
  SessaoHoje,
  SessaoPeriodo,
} from "@/lib/format";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

async function apiFetch<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const session = cookieStore.get("session");

  const res = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    headers: session ? { Cookie: `session=${session.value}` } : undefined,
  });

  if (res.status === 401) {
    redirect("/login");
  }
  if (!res.ok) {
    throw new Error(`Falha ao buscar ${path}: HTTP ${res.status}`);
  }
  return res.json();
}

export function getPacientes() {
  return apiFetch<Paciente[]>("/pacientes");
}

export function getPaciente(id: number) {
  return apiFetch<Paciente>(`/pacientes/${id}`);
}

export function getSessoesPaciente(id: number) {
  return apiFetch<SessaoHistorico[]>(`/pacientes/${id}/sessoes`);
}

export function getSessoesHoje() {
  return apiFetch<SessaoHoje[]>("/sessoes/hoje");
}

export function getDashboardStats() {
  return apiFetch<DashboardStats>("/dashboard/stats");
}

export type Profissional = {
  id: number;
  nome: string;
  email: string;
};

export function getMe() {
  return apiFetch<Profissional>("/auth/me");
}

export function getLocais() {
  return apiFetch<Local[]>("/locais");
}

export function getSessoesPeriodo(inicio: string, fim: string) {
  return apiFetch<SessaoPeriodo[]>(`/sessoes?inicio=${inicio}&fim=${fim}`);
}

export function getRegrasHorario() {
  return apiFetch<RegraHorario[]>("/regras-horario");
}

export function getGoogleStatus() {
  return apiFetch<{ conectado: boolean }>("/google/status");
}
