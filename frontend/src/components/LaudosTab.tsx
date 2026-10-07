"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2, Upload } from "lucide-react";
import type { Laudo } from "@/lib/api";
import { formatDataHoraBrasilia } from "@/lib/format";

const API_URL = "/api";
const MAX_BYTES = 20 * 1024 * 1024;

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LaudosTab({
  pacienteId,
  laudosIniciais,
}: {
  pacienteId: number;
  laudosIniciais: Laudo[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [laudos, setLaudos] = useState<Laudo[]>(laudosIniciais);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<number | null>(null);

  async function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!inputRef.current) return;
    inputRef.current.value = "";
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setErro("Arquivo muito grande. O limite é 20 MB.");
      return;
    }

    setErro(null);
    setEnviando(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("paciente_id", String(pacienteId));

    const uploadRes = await fetch("/blob/upload", { method: "POST", body: formData });
    if (!uploadRes.ok) {
      const data = await uploadRes.json().catch(() => ({}));
      setErro(data.error ?? "Não deu pra fazer o upload.");
      setEnviando(false);
      return;
    }

    const { url, nome, tamanho_bytes } = await uploadRes.json();

    const saveRes = await fetch(`${API_URL}/pacientes/${pacienteId}/laudos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ nome, url, tamanho_bytes }),
    });

    if (!saveRes.ok) {
      setErro("Upload feito mas não deu pra salvar o registro. Tenta de novo.");
      setEnviando(false);
      return;
    }

    const novoLaudo: Laudo = await saveRes.json();
    setLaudos((prev) => [novoLaudo, ...prev]);
    setEnviando(false);
  }

  async function handleExcluir(laudo: Laudo) {
    if (!confirm(`Excluir "${laudo.nome}"? Isso não pode ser desfeito.`)) return;
    setExcluindo(laudo.id);

    const res = await fetch("/blob/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ laudo_id: laudo.id, url: laudo.url }),
    });

    if (!res.ok && res.status !== 204) {
      setErro("Não deu pra excluir o laudo. Tenta de novo.");
      setExcluindo(null);
      return;
    }

    setLaudos((prev) => prev.filter((l) => l.id !== laudo.id));
    setExcluindo(null);
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-[0_8px_24px_var(--color-shadow)]">
      <div className="flex items-center justify-between border-b border-border p-6">
        <div>
          <h2 className="text-[16px] font-bold">Laudos e documentos</h2>
          <p className="mt-0.5 text-[13px] text-muted">PDFs, imagens ou documentos do paciente</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={enviando}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
        >
          <Upload className="h-4 w-4" strokeWidth={2.25} />
          {enviando ? "Enviando..." : "Enviar arquivo"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt"
          onChange={handleArquivo}
          className="hidden"
        />
      </div>

      {erro && (
        <p className="border-b border-border px-6 py-3 text-[13px] font-semibold text-red-600">{erro}</p>
      )}

      {laudos.length === 0 ? (
        <p className="px-6 py-10 text-center text-[14px] text-muted">
          Nenhum laudo enviado ainda.
        </p>
      ) : (
        <ul>
          {laudos.map((laudo) => (
            <li
              key={laudo.id}
              className="flex items-center gap-4 border-b border-border px-6 py-4 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-bold">{laudo.nome}</p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {formatDataHoraBrasilia(laudo.criado_em)}
                  {laudo.tamanho_bytes ? ` · ${formatBytes(laudo.tamanho_bytes)}` : ""}
                </p>
              </div>
              <a
                href={laudo.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Baixar laudo"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-accent-soft hover:text-fg"
              >
                <Download className="h-4 w-4" strokeWidth={2.25} />
              </a>
              <button
                type="button"
                onClick={() => handleExcluir(laudo)}
                disabled={excluindo === laudo.id}
                aria-label="Excluir laudo"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-red-500/10 hover:text-red-600 disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
