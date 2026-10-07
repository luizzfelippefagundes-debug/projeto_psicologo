import { del } from "@vercel/blob";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

export async function DELETE(request: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Vercel Blob não configurado" }, { status: 503 });
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

  const { laudo_id, url } = await request.json();
  if (!laudo_id || !url) {
    return NextResponse.json({ error: "laudo_id e url são obrigatórios" }, { status: 400 });
  }

  await del(url);

  const backendRes = await fetch(`${API_URL}/laudos/${laudo_id}`, {
    method: "DELETE",
    headers: { Cookie: `session=${session.value}` },
  });
  if (!backendRes.ok && backendRes.status !== 404) {
    return NextResponse.json({ error: "Erro ao excluir registro" }, { status: 502 });
  }

  return new NextResponse(null, { status: 204 });
}
