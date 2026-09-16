// Ruta API interna — dispara el procesamiento de jobs en segundo plano
// (ADR-0004, Bloque A del Incremento 2). Invocada por el Cron nativo de
// Vercel (cadencia diaria en el plan Hobby, vercel.json) y, de respaldo, por
// un workflow de GitHub Actions cada 15 minutos (PLAN-DE-TRABAJO.md Seccion
// 18.1.E) — nunca un proceso persistente: cada invocacion hace
// boss.fetch() + complete()/fail() y retorna.
//
// Autenticacion: encabezado "Authorization: Bearer <CRON_SECRET>", mismo
// esquema que usa Vercel Cron de forma nativa (inyecta este header solo si
// CRON_SECRET esta configurado como variable de entorno — ver
// .env.example / SEGURIDAD-credenciales.md). El workflow de GitHub Actions
// de respaldo manda el mismo header a mano con el secreto del repo.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { obtenerBoss } from "@/infra/jobs/pgBoss";
import { encolarPurgaHuellaOrigen, procesarPurgaHuellaOrigen } from "@/infra/jobs/purgaHuellaOrigenJob";

export const runtime = "nodejs"; // pg-boss necesita el pool "pg" (modulo "node:net"), no corre en Edge.

function autorizado(request: Request): boolean {
  const secreto = process.env.CRON_SECRET;
  const encabezado = request.headers.get("authorization");
  if (!secreto || !encabezado) return false; // sin CRON_SECRET configurado, la ruta queda cerrada por defecto.

  const esperado = Buffer.from(`Bearer ${secreto}`);
  const recibido = Buffer.from(encabezado);
  if (esperado.length !== recibido.length) return false; // timingSafeEqual exige el mismo largo.
  return timingSafeEqual(esperado, recibido);
}

export async function GET(request: Request) {
  if (!autorizado(request)) {
    return NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 401 });
  }

  try {
    const boss = await obtenerBoss();
    await encolarPurgaHuellaOrigen(boss);
    const resultado = await procesarPurgaHuellaOrigen(boss);
    return NextResponse.json({ ok: true, ...resultado });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
