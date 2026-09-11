type Fala = { speaker: string; tempo: string; texto: string };

const REGEX_FALA = /^Speaker\s+(\d+)\s+(\d{1,2}:\d{2}:\d{2})\s*$/gm;

function parsearTranscricao(texto: string): Fala[] | null {
  const marcadores = [...texto.matchAll(REGEX_FALA)];
  if (marcadores.length === 0) return null;

  const falas: Fala[] = [];
  for (let i = 0; i < marcadores.length; i++) {
    const atual = marcadores[i];
    const proximo = marcadores[i + 1];
    const inicio = (atual.index ?? 0) + atual[0].length;
    const fim = proximo?.index ?? texto.length;
    const trecho = texto.slice(inicio, fim).trim();
    if (!trecho) continue;
    falas.push({ speaker: atual[1], tempo: atual[2], texto: trecho });
  }
  return falas.length > 0 ? falas : null;
}

const ESTILO_PACIENTE = "items-start bg-accent-soft text-fg";
const ESTILO_PSICOLOGA = "items-end ml-auto bg-card border border-border text-fg";

// Nas gravações dela, "Speaker 1" é sempre quem trouxe o paciente e "Speaker 2" é
// sempre ela (entra depois de cumprimentar quem chegou).
function rotuloSpeaker(speaker: string): string {
  if (speaker === "1") return "Paciente";
  if (speaker === "2") return "Psicóloga";
  return `Pessoa ${speaker}`;
}

export function TranscricaoChat({ texto }: { texto: string }) {
  const falas = parsearTranscricao(texto);

  if (!falas) {
    return <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted">{texto}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {falas.map((fala, i) => {
        const rotulo = rotuloSpeaker(fala.speaker);
        const estilo = fala.speaker === "2" ? ESTILO_PSICOLOGA : ESTILO_PACIENTE;
        return (
          <div key={i} className={`flex max-w-[85%] flex-col gap-1 ${estilo} rounded-2xl px-4 py-2.5`}>
            <div className="flex items-baseline gap-2 text-[11.5px] font-bold text-muted">
              <span>{rotulo}</span>
              <span className="font-normal opacity-70">{fala.tempo}</span>
            </div>
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{fala.texto}</p>
          </div>
        );
      })}
    </div>
  );
}
