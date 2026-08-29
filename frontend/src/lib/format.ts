export type Paciente = {
  id: number;
  nome: string;
  telefone: string;
  email: string | null;
  data_nascimento: string | null;
  tipo_atendimento: "individual" | "casal";
  tipo_procedimento: string | null;
  status: "ativo" | "inativo";
  criado_em: string;
  proxima_sessao: string | null;
  consentimento_lgpd: boolean;
  consentimento_lgpd_data: string | null;
};

export const PROCEDIMENTOS = [
  { value: "avaliacao_neuropsicologica", label: "Avaliação neuropsicológica" },
  { value: "terapia", label: "Terapia" },
  { value: "reabilitacao_com_estimulacao", label: "Reabilitação com estimulação transcraniana" },
  { value: "reabilitacao_sem_estimulacao", label: "Reabilitação sem estimulação transcraniana" },
  { value: "neuromodulacao", label: "Neuromodulação" },
] as const;

export function labelProcedimento(value: string | null): string {
  return PROCEDIMENTOS.find((p) => p.value === value)?.label ?? "—";
}

export type SessaoHoje = {
  id: number;
  data_hora: string;
  duracao_minutos: number;
  modalidade: "presencial" | "teleconsulta";
  status: "confirmada" | "concluida";
  paciente_nome: string;
  local_nome: string;
};

export type SessaoHistorico = {
  id: number;
  data_hora: string;
  duracao_minutos: number;
  modalidade: "presencial" | "teleconsulta";
  status: "confirmada" | "concluida" | "cancelada" | "reservado";
  observacoes: string | null;
  local_nome: string;
};

export type DashboardStats = {
  consultas_hoje: number;
  pacientes_ativos: number;
  novos_pacientes_30d: number;
  sessoes_mes: number;
};

export type DashboardAnalytics = {
  sessoes_por_dia_semana: { dia_semana: number; total: number }[];
  sessoes_por_modalidade: { presencial: number; teleconsulta: number };
  sessoes_por_status: { confirmada: number; concluida: number; cancelada: number };
  novos_pacientes_por_semana: { semana_inicio: string; total: number }[];
  periodo_dias: number;
};

export type Local = {
  id: number;
  nome: string;
  endereco: string | null;
  criado_em: string;
};

export type SessaoPeriodo = {
  id: number;
  data_hora: string;
  duracao_minutos: number;
  modalidade: "presencial" | "teleconsulta";
  status: "confirmada" | "concluida";
  observacoes: string | null;
  paciente_id: number;
  paciente_nome: string;
  local_id: number;
  local_nome: string;
};

export function formatHoraBrasilia(isoDateTime: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(isoDateTime));
}

export function formatDataHoraBrasilia(isoDateTime: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(isoDateTime));
}

export type RegraHorario = {
  id: number;
  local_id: number;
  local_nome: string;
  dia_semana: number; // 0=domingo .. 6=sábado
  hora_inicio: string; // "HH:MM:SS"
  hora_fim: string;
  ativo: boolean;
};

export const DIAS_SEMANA = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

export function formatHoraCurta(horaHHMMSS: string) {
  return horaHHMMSS.slice(0, 5);
}

export function iniciais(nome: string) {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase())
    .join("");
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function brazilParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    dateISO: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekdayIndex: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

export function getTodayISO(): string {
  return brazilParts(new Date()).dateISO;
}

export function getAgoraBrasilia(): { hour: number; minute: number } {
  const { hour, minute } = brazilParts(new Date());
  return { hour, minute };
}

export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function getWeekStart(referenceISODate?: string): string {
  const ref = referenceISODate
    ? new Date(`${referenceISODate}T12:00:00-03:00`)
    : new Date();
  const { dateISO, weekdayIndex } = brazilParts(ref);
  return addDaysISO(dateISO, -weekdayIndex);
}

export function getWeekDates(mondayISO: string): string[] {
  return Array.from({ length: 5 }, (_, i) => addDaysISO(mondayISO, i));
}

export function formatDiaSemanaCurto(dateISO: string): string {
  const dt = new Date(`${dateISO}T12:00:00-03:00`);
  const label = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    timeZone: "America/Sao_Paulo",
  }).format(dt);
  return label.replace(".", "").replace(/^\w/, (c) => c.toUpperCase());
}

export function formatDiaMesCurto(dateISO: string): string {
  const dt = new Date(`${dateISO}T12:00:00-03:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(dt);
}

export type ConversaEscalonada = {
  id: number;
  telefone_paciente: string | null;
  paciente_nome: string | null;
  previa_conversa: string;
  motivo: "crise" | "fora_do_escopo";
  resolvido: boolean;
  notificado_em: string;
};

export type ContatoBot = {
  telefone_paciente: string;
  nome_whatsapp: string | null;
  atualizado_em: string;
};

export type AnamneseListaItem = {
  id: number;
  nome: string;
  telefone: string;
  enviado_em: string | null;
  respondido_em: string | null;
};

export type AnamneseDetalhe = {
  tipo_formulario: "adulto" | "infantil";
  respostas: Record<string, string | boolean> | null;
  enviado_em: string;
  respondido_em: string | null;
} | null;

export function sessaoGridPosition(isoDateTime: string, duracaoMinutos: number) {
  const { dateISO, hour, minute, weekdayIndex } = brazilParts(new Date(isoDateTime));
  const gridStartHour = 7;
  const slot = (hour - gridStartHour) * 2 + (minute >= 30 ? 1 : 0);
  const span = Math.max(1, Math.round(duracaoMinutos / 30));
  return { dateISO, dayIndex: weekdayIndex, rowStart: slot + 1, rowSpan: span };
}
