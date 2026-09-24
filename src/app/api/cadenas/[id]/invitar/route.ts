// Ruta API — un usuario con sesion (administrador o responsable, RF36:
// "un administrador o responsable con acceso a una Cadena invita a otra
// persona") invita por correo a alguien a responder sobre una Cadena
// completa o sobre una ConexionCadena puntual. requireSession() (no
// requireAdmin()), mismo criterio que las otras 5 rutas del mapa -- RF27
// ya confirmo que administrador y responsable tienen el mismo acceso al
// mapa, ver revision-externa-2026-09-22.md.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { crearTokenInvitacionCadena } from "@/infra/auth/invitacion";
import { enviarInvitacionCadena } from "@/infra/email/resend";
import { logError } from "@/infra/log";

const invitarCadenaSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // Ausente/null = invitacion a la Cadena completa (RF36).
  conexionCadenaId: z.string().min(1).nullish(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const { id: cadenaId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = invitarCadenaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const client = tenantClient(sesion.empresaId);
  const [cadena, empresa] = await Promise.all([
    client.cadena.findUnique({ where: { id: cadenaId } }),
    client.empresa.findUnique({ where: { id: sesion.empresaId } }),
  ]);
  if (!cadena || !empresa) {
    return NextResponse.json({ ok: false, error: "CADENA_INEXISTENTE" }, { status: 404 });
  }

  // "cinturon y tirantes" -- si vino conexionCadenaId, confirmar que
  // existe Y pertenece a ESTA cadena (mismo criterio de
  // agregarConexionCadena.ts: un nodo/conexion de otra Cadena pasa el
  // filtro de tenant igual, hay que chequear cadenaId a mano).
  let alcanceTexto = "toda la cadena";
  if (parsed.data.conexionCadenaId) {
    const conexionCadena = await client.conexionCadena.findUnique({
      where: { id: parsed.data.conexionCadenaId },
      include: { origenNodo: true, destinoNodo: true },
    });
    if (!conexionCadena || conexionCadena.cadenaId !== cadenaId) {
      return NextResponse.json({ ok: false, error: "CONEXION_INVALIDA" }, { status: 400 });
    }
    alcanceTexto = `la conexión de "${conexionCadena.origenNodo.nombre}" a "${conexionCadena.destinoNodo.nombre}"`;
  }

  const token = await crearTokenInvitacionCadena({
    empresaId: sesion.empresaId,
    cadenaId,
    conexionCadenaId: parsed.data.conexionCadenaId ?? null,
    email: parsed.data.email,
  });

  const origen = request.headers.get("origin") ?? new URL(request.url).origin;
  const linkInvitacion = `${origen}/invitacion-cadena/responder?token=${encodeURIComponent(token)}`;

  try {
    await enviarInvitacionCadena({
      email: parsed.data.email,
      empresaNombre: empresa.nombre,
      cadenaNombre: cadena.nombre,
      alcanceTexto,
      linkInvitacion,
    });
  } catch (err) {
    logError("api/cadenas/[id]/invitar POST", err);
    return NextResponse.json({ ok: false, error: "ERROR_ENVIO_CORREO" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
