import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup"];
// Rotas públicas de verdade (sem exigir sessão, mas também sem redirecionar quem
// já está logado — diferente de /login e /signup, que não fazem sentido pra quem
// já tem sessão. O formulário de anamnese é aberto pelo paciente, sem login, mas
// a profissional também pode abrir o mesmo link estando logada (ex: pra conferir).
const ALWAYS_PUBLIC_PATHS = ["/anamnese"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (ALWAYS_PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const hasSession = request.cookies.has("session");

  if (!hasSession && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (hasSession && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // /api/* fica de fora — é o proxy pro backend (next.config.ts), não uma página;
  // chamada sem sessão deve virar 401 do backend, não um redirect pra tela de login.
  // manifest/sw/ícones do PWA também ficam de fora — o navegador busca isso direto
  // (às vezes sem cookie) pra checar instalabilidade, e um redirect pro /login quebra isso.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon-.*\\.png|apple-touch-icon.png).*)",
  ],
};
