import type { SessionOptions } from "iron-session";

// Shared session config — kept free of next/headers so it's safe to import from
// proxy.ts (which has no render context) as well as route handlers.
export type SessionData = { loggedIn: boolean };

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET ?? "",
  cookieName: "kal_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  },
};
