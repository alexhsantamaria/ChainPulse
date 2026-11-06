// Ruta API — completa o corrige los datos de criticidad de una conexion ya
// declarada (RF3: "una conexion sin estos datos confirmados queda marcada
// como incompleta" -- esta ruta es como se completa despues).
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { calcularCompletitud } from "@/infra/conexiones/completitud";
import { esViolacionUnica } from "@/infra/prisma/errores";
import { logError } from "@/infra/log";

const actualizarSchema = z.object({
  origenId: z.string().min(1),
  destinoId: z.string().min(1),
  gradoDependencia: z.enum(["BAJA", "MEDIA", "ALTA", "CRITICA"]).optional().nullable(),
  impactoPromesaCliente: z.enum(["BAJO", "MEDIO", "ALTO", "CRITICO"]).optional().nullable(),
  tieneAlternativa: z.boolean().optional().nullable(),
  tiempoTolerable: z.enum(["CORTO", "MEDIO", "LARGO"]).optional().nullable(),
  tiempoRecuperacion: z.enum(["CORTO", "MEDIO", "LARGO"]).optional().nullable(),
}).refine((datos) => datos.origenId !== datos.destinoId, {
  message: "origenId y destinoId no pueden ser el mismo eslabon",
  path: ["destinoId"],
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const resultado = await requireSession();
  if ("respuesta" in resultado) return resultado.respuesta;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = actualizarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const client = tenantClient(resultado.sesion.empresaId);
  const existente = await client.conexion.findUnique({ where: { id } });
  if (!existente) {
    return NextResponse.json({ ok: false, error: "CONEXION_INEXISTENTE" }, { status: 404 });
  }

  const [origen, destino] = await Promise.all([
    client.eslabon.findUnique({ where: { id: parsed.data.origenId } }),
    client.eslabon.findUnique({ where: { id: parsed.data.destinoId } }),
  ]);
  if (!origen || !destino) {
    return NextResponse.json({ ok: false, error: "ESLABON_INEXISTENTE" }, { status: 400 });
  }

  // Merge sobre los datos ya guardados: PATCH permite completar solo los
  // campos que faltaban sin obligar a reenviar los que ya estaban.
  const datosCombinados = {
    gradoDependencia: parsed.data.gradoDependencia ?? existente.gradoDependencia,
    impactoPromesaCliente: parsed.data.impactoPromesaCliente ?? existente.impactoPromesaCliente,
    tieneAlternativa:
      parsed.data.tieneAlternativa !== undefined ? parsed.data.tieneAlternativa : existente.tieneAlternativa,
    tiempoTolerable: parsed.data.tiempoTolerable ?? existente.tiempoTolerable,
    tiempoRecuperacion: parsed.data.tiempoRecuperacion ?? existente.tiempoRecuperacion,
  };
  const completa = calcularCompletitud(datosCombinados);

  try {
    const conexion = await client.conexion.update({
      where: { id },
      data: {
        origenId: parsed.data.origenId,
        destinoId: parsed.data.destinoId,
        ...datosCombinados,
        completa,
        // Solo se marca la fecha de confirmacion la primera vez que pasa a completa.
        criticidadConfirmadaEn: completa && !existente.completa ? new Date() : existente.criticidadConfirmadaEn,
      },
    });
    return NextResponse.json({ ok: true, conexion });
  } catch (err) {
    if (esViolacionUnica(err)) {
      return NextResponse.json({ ok: false, error: "CONEXION_YA_EXISTE" }, { status: 409 });
    }
    logError("api/conexiones/[id] PATCH", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
