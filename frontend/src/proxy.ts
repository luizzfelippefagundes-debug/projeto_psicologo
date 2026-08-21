import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
  // chamada sem sessão deve virar 401 do backend, não um redirect pra tela de login
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
