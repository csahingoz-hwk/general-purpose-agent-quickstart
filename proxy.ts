import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { isOwnerIdentity } from "./lib/access-policy";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/ping") {
    return new Response("pong");
  }
  // These endpoints enforce their own policy, including disabled guest/cron routes.
  if (
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/cron/tick" ||
    pathname === "/api/telegram-webhook"
  ) {
    return NextResponse.next();
  }
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: request.nextUrl.protocol === "https:",
  });
  const owner = isOwnerIdentity(token);
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (pathname === "/login") {
    return owner
      ? NextResponse.redirect(new URL(`${base}/`, request.url))
      : NextResponse.next();
  }
  if (!owner) {
    if (pathname.startsWith("/api/") || pathname.includes("/api/")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL(`${base}/login`, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
