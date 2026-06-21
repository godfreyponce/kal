import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";

// POST /api/auth/login  body: { password }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";

  if (!process.env.APP_PASSWORD || password !== process.env.APP_PASSWORD) {
    return Response.json({ error: "Incorrect password" }, { status: 401 });
  }

  const session = await getSession();
  session.loggedIn = true;
  await session.save();
  return Response.json({ ok: true });
}
