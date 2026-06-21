import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "./session";

/** Read/write the session in a Server Component, Route Handler, or Server Action. */
export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
