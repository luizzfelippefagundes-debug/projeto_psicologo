import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup"];
// O formulário de anamnese é aberto pelo paciente, sem login — a profissional
// também pode abrir o mesmo link estando logada (ex: pra conferir).
const ALWAYS_PUBLIC_PATHS = ["/anamnese"];

function proxyDaProfissional(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // /agendar/* tem seu próprio auth (Clerk, do lado do paciente — ver
  // ehRotaAgendarProtegida abaixo), não depende do cookie de sessão da profissional.
  if (
    ALWAYS_PUBLIC_PATHS.some((path) => pathname.startsWith(path)) ||
    pathname.startsWith("/agendar")
  ) {
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

// Só as páginas de agendamento em si exigem sessão Clerk do paciente — /entrar e
// /cadastro (as próprias telas de login/cadastro) ficam de fora, senão ninguém
// conseguiria nem abrir o login. Retorna o slug pra montar o redirect certo: cada
// profissional tem seu próprio link/tela de login, não existe um "/entrar" global.
function ehRotaAgendarProtegida(pathname: string): string | null {
  if (!pathname.startsWith("/agendar/")) return null;
  const [slug, sub] = pathname.slice("/agendar/".length).split("/");
  if (!slug) return null;
  if (sub === "entrar" || sub === "cadastro") return null;
  return slug;
}

export default clerkMiddleware(async (auth, request) => {
  const slug = ehRotaAgendarProtegida(request.nextUrl.pathname);
  if (slug) {
    await auth.protect({
      unauthenticatedUrl: new URL(`/agendar/${slug}/entrar`, request.url).toString(),
    });
  }
  return proxyDaProfissional(request);
});

export const config = {
  // /api/* fica de fora — é o proxy pro backend (next.config.ts), não uma página;
  // chamada sem sessão deve virar 401 do backend, não um redirect pra tela de login.
  // manifest/sw/ícones do PWA também ficam de fora — o navegador busca isso direto
  // (às vezes sem cookie) pra checar instalabilidade, e um redirect pro /login quebra isso.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon-.*\\.png|apple-touch-icon.png).*)",
  ],
};
