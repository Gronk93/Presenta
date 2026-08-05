import { addSignal, clearSignals, listSignals } from "../../../db/signals";

const ROLES = new Set(["receiver", "controller"]);
const KINDS = new Set(["offer", "answer", "candidate", "restart"]);

function validRoom(value: string) {
  return /^\d{6}$/.test(value);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const room = url.searchParams.get("room") ?? "";
    const role = url.searchParams.get("role") ?? "";
    const after = Number(url.searchParams.get("after") ?? "0");
    if (!validRoom(room) || !ROLES.has(role) || !Number.isSafeInteger(after) || after < 0) {
      return Response.json({ error: "Invalid signaling request" }, { status: 400 });
    }
    return Response.json({ signals: await listSignals(room, role, after) }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Signaling service unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { room?: string; role?: string; kind?: string; payload?: unknown };
    const room = body.room ?? "";
    const role = body.role ?? "";
    const kind = body.kind ?? "";
    const payload = JSON.stringify(body.payload ?? null);
    if (!validRoom(room) || !ROLES.has(role) || !KINDS.has(kind) || payload.length > 24000) {
      return Response.json({ error: "Invalid signal" }, { status: 400 });
    }
    await addSignal(room, role, kind, payload);
    return Response.json({ ok: true }, { status: 201 });
  } catch {
    return Response.json({ error: "Unable to write signal" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const room = url.searchParams.get("room") ?? "";
    const role = url.searchParams.get("role") ?? "";
    if (!validRoom(room) || role !== "receiver") {
      return Response.json({ error: "Invalid reset request" }, { status: 400 });
    }
    await clearSignals(room);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Unable to reset signals" }, { status: 503 });
  }
}
