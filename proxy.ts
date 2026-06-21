import { getIronSession } from "iron-session";
import { NextResponse, type NextRequest } from "next/server";
import { sessionOptions, type SessionData } from "@/lib/session";

// Single-password gate: everything requires a logged-in session except the login
// page and the auth API. Unauthenticated API calls get 401; pages redirect to /login.
export async function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  const { pathname } = req.nextUrl;

  const isLogin = pathname === "/login";
  const isAuthApi = pathname.startsWith("/api/auth");

  if (session.loggedIn) {
    if (isLogin) return NextResponse.redirect(new URL("/", req.url));
    return res;
  }

  if (isLogin || isAuthApi) return res;
  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // Run on everything except static assets, the icon, and the manifest.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon|manifest.webmanifest).*)"],
};
