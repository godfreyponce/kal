import { getSession } from "@/lib/auth";

// POST /api/auth/logout
export async function POST() {
  const session = await getSession();
  session.destroy();
  return Response.json({ ok: true });
}
