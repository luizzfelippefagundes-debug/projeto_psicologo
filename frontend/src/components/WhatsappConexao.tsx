"use client";

import { useEffect, useState } from "react";

type Estado = "open" | "close" | "connecting" | "sem_instancia" | null;

export function WhatsappConexao() {
  const [estado, setEstado] = useState<Estado>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [carregandoQr, setCarregandoQr] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function checarStatus() {
    const res = await fetch("/api/whatsapp/status", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setEstado(data.estado);
      if (data.estado === "open") setQrcode(null);
    }
  }

  useEffect(() => {
    checarStatus();
    const id = setInterval(checarStatus, 10_000);
    return () => clearInterval(id);
  }, []);

  async function mostrarQr() {
    setErro(null);
    setCarregandoQr(true);
    const res = await fetch("/api/whatsapp/qrcode", { credentials: "include" });
    setCarregandoQr(false);
    if (!res.ok) {
      setErro("Não foi possível gerar o QR code. Verifique se o backend está rodando.");
      return;
    }
    const data = await res.json();
    setQrcode(data.qrcode);
  }

  const label: Record<string, { texto: string; cor: string }> = {
    open: { texto: "Conectado", cor: "text-green-600" },
    close: { texto: "Desconectado", cor: "text-red-600" },
    connecting: { texto: "Conectando...", cor: "text-yellow-600" },
    sem_instancia: { texto: "Não configurado", cor: "text-muted" },
  };

  const info = estado ? label[estado] ?? label.close : null;

  return (
    <div>
      <div className="flex items-center gap-3">
        <div
          className={`h-2.5 w-2.5 rounded-full ${
            estado === "open"
              ? "bg-green-500"
              : estado === "connecting"
                ? "bg-yellow-500"
                : "bg-red-500"
          }`}
        />
        <span className={`text-[14px] font-semibold ${info?.cor ?? "text-muted"}`}>
          {info?.texto ?? "Verificando..."}
        </span>
        <button
          type="button"
          onClick={checarStatus}
          className="ml-auto text-[12.5px] font-semibold text-muted hover:text-fg"
        >
          Atualizar
        </button>
      </div>

      {estado !== "open" && estado !== null && estado !== "sem_instancia" && (
        <div className="mt-4">
          {qrcode ? (
            <div>
              <p className="mb-3 text-[13.5px] text-muted">
                Abra o WhatsApp → Aparelhos conectados → Conectar um aparelho → escaneie o código abaixo:
              </p>
              <img
                src={qrcode.startsWith("data:") ? qrcode : `data:image/png;base64,${qrcode}`}
                alt="QR Code WhatsApp"
                className="h-48 w-48 rounded-xl border border-border"
              />
              <p className="mt-2 text-[12px] text-muted">
                O código expira em ~1 minuto. Se expirar, clique em "Gerar novo QR code".
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={mostrarQr}
              disabled={carregandoQr}
              className="rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
            >
              {carregandoQr ? "Gerando..." : "Gerar QR code pra reconectar"}
            </button>
          )}
          {qrcode && (
            <button
              type="button"
              onClick={mostrarQr}
              disabled={carregandoQr}
              className="mt-3 block text-[12.5px] font-semibold text-accent-dark hover:underline disabled:opacity-60"
            >
              {carregandoQr ? "Gerando..." : "Gerar novo QR code"}
            </button>
          )}
        </div>
      )}

      {erro && (
        <p className="mt-3 text-[13px] font-semibold text-red-600">{erro}</p>
      )}
    </div>
  );
}
