import { put } from "@vercel/blob";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export async function POST(request: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Vercel Blob não está configurado. Adicione BLOB_READ_WRITE_TOKEN nas variáveis de ambiente." },
      { status: 503 }
    );
  }

  const cookieStore = await cookies();
  const session = cookieStore.get("session");
  if (!session) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const meRes = await fetch(`${API_URL}/auth/me`, {
    headers: { Cookie: `session=${session.value}` },
    cache: "no-store",
  });
  if (!meRes.ok) {
    return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
  }
  const me = await meRes.json();

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const pacienteId = formData.get("paciente_id") as string | null;

  if (!file || !pacienteId) {
    return NextResponse.json({ error: "Arquivo e paciente_id são obrigatórios" }, { status: 400 });
  }

  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "Arquivo muito grande (máximo 20 MB)" }, { status: 400 });
  }

  const nomeSeguro = file.name.replace(/[^a-zA-Z0-9._\-]/g, "_");
  const pathname = `laudos/${me.id}/${pacienteId}/${Date.now()}-${nomeSeguro}`;

  const blob = await put(pathname, file, { access: "public" });

  return NextResponse.json({ url: blob.url, nome: file.name, tamanho_bytes: file.size });
}
