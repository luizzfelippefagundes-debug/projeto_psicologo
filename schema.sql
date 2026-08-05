-- Schema multi-tenant — Bot de agendamento + painel (SaaS multi-profissional)
-- PostgreSQL

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE profissionais (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE locais (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    nome VARCHAR(100) NOT NULL,
    endereco TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE regras_horario (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    local_id INTEGER NOT NULL REFERENCES locais(id) ON DELETE CASCADE,
    dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0=domingo .. 6=sábado
    hora_inicio TIME NOT NULL,
    hora_fim TIME NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT true,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pacientes (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    nome VARCHAR(150) NOT NULL,
    telefone VARCHAR(20) NOT NULL, -- número de WhatsApp do paciente
    email VARCHAR(150),
    tipo_atendimento VARCHAR(20) NOT NULL DEFAULT 'individual'
        CHECK (tipo_atendimento IN ('individual', 'casal')),
    tipo_procedimento VARCHAR(60)
        CHECK (tipo_procedimento IN (
            'avaliacao_neuropsicologica',
            'terapia',
            'reabilitacao_com_estimulacao',
            'reabilitacao_sem_estimulacao',
            'neuromodulacao'
        )), -- obrigatório na aplicação, não no banco (pacientes antigos ficam NULL)
    status VARCHAR(20) NOT NULL DEFAULT 'ativo'
        CHECK (status IN ('ativo', 'inativo')),
    consentimento_lgpd BOOLEAN NOT NULL DEFAULT false,
    consentimento_lgpd_data TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profissional_id, telefone)
);

CREATE TABLE sessoes (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    paciente_id INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
    local_id INTEGER NOT NULL REFERENCES locais(id),
    data_hora TIMESTAMPTZ NOT NULL,
    duracao_minutos INTEGER NOT NULL DEFAULT 50,
    data_hora_fim TIMESTAMPTZ NOT NULL, -- calculado pelo trigger trg_sessoes_calc_fim
    modalidade VARCHAR(20) NOT NULL DEFAULT 'presencial'
        CHECK (modalidade IN ('presencial', 'teleconsulta')),
    link_teleconsulta TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'confirmada'
        CHECK (status IN ('confirmada', 'cancelada', 'concluida')),
    observacoes TEXT,
    google_event_id VARCHAR(255), -- id do evento espelhado no Google Calendar, se sincronizado
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- impede duas sessões sobrepostas no mesmo local (ignora sessões canceladas)
    EXCLUDE USING gist (
        local_id WITH =,
        tstzrange(data_hora, data_hora_fim, '[)') WITH &&
    ) WHERE (status <> 'cancelada')
);

-- mantém data_hora_fim sincronizado com data_hora + duracao_minutos
CREATE OR REPLACE FUNCTION sessoes_calc_fim() RETURNS TRIGGER AS $$
BEGIN
    NEW.data_hora_fim := NEW.data_hora + (NEW.duracao_minutos * interval '1 minute');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sessoes_calc_fim
    BEFORE INSERT OR UPDATE ON sessoes
    FOR EACH ROW EXECUTE FUNCTION sessoes_calc_fim();

CREATE INDEX idx_sessoes_data_hora ON sessoes(data_hora);
CREATE INDEX idx_sessoes_paciente ON sessoes(paciente_id);
CREATE INDEX idx_sessoes_profissional ON sessoes(profissional_id);
CREATE INDEX idx_pacientes_profissional ON pacientes(profissional_id);
CREATE INDEX idx_locais_profissional ON locais(profissional_id);

CREATE TABLE bloqueios_horario (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    local_id INTEGER REFERENCES locais(id) ON DELETE CASCADE, -- nulo = compromisso pessoal, sem local de atendimento
    data_inicio TIMESTAMPTZ NOT NULL,
    data_fim TIMESTAMPTZ NOT NULL,
    motivo VARCHAR(255),
    google_event_id VARCHAR(255), -- id do evento de origem no Google Calendar (quando veio de lá)
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profissional_id, google_event_id)
);

CREATE TABLE google_conexoes (
    profissional_id INTEGER PRIMARY KEY REFERENCES profissionais(id) ON DELETE CASCADE,
    refresh_token TEXT NOT NULL,
    access_token TEXT,
    access_token_expira_em TIMESTAMPTZ,
    calendar_id VARCHAR(255) NOT NULL DEFAULT 'primary',
    sync_token TEXT,
    conectado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversas_escalonadas (
    id SERIAL PRIMARY KEY,
    profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    paciente_id INTEGER REFERENCES pacientes(id) ON DELETE SET NULL, -- pode ser nulo se ainda não identificado
    previa_conversa TEXT NOT NULL,
    motivo VARCHAR(30) NOT NULL CHECK (motivo IN ('crise', 'fora_do_escopo')),
    notificado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
