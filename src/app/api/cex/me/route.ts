import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getCexWorker, CEX_COOKIE } from "@/lib/cex-auth";

/** GET → текущият колега (от бисквитката). POST(logout) маха бисквитката. */
export async function GET(req: NextRequest) {
  const worker = await getCexWorker(req);
  if (!worker) return NextResponse.json({ worker: null }, { status: 200 });
  return NextResponse.json({ worker });
}

export async function POST(req: NextRequest) {
  void req;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CEX_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
