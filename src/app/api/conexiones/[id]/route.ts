// Ruta API — completa o corrige los datos de criticidad de una conexion ya
// declarada (RF3: "una conexion sin estos datos confirmados queda marcada
// como incompleta" -- esta ruta es como se completa despues).
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { calcularCompletitud } from "@/infra/conexiones/completitud";

const actualizarSchema = z.object({
  gradoDependencia: z.enum(["BAJA", "MEDIA", "ALTA", "CRITICA"]).optional().nullable(),
  impactoPromesaCliente: z.enum(["BAJO", "MEDIO", "ALTO", "CRITICO"]).optional().nullable(),
  tieneAlternativa: z.boolean().optional().nullable(),
  tiempoTolerable: z.enum(["CORTO", "MEDIO", "LARGO"]).optional().nullable(),
  tiempoRecuperacion: z.enum(["CORTO", "MEDIO", "LARGO"]).optional().nullable(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = actualizarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const client = tenantClient(session.user.empresaId);
  const existente = await client.conexion.findUnique({ where: { id } });
  if (!existente) {
    return NextResponse.json({ ok: false, error: "CONEXION_INEXISTENTE" }, { status: 404 });
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

  const conexion = await client.conexion.update({
    where: { id },
    data: {
      ...datosCombinados,
      completa,
      // Solo se marca la fecha de confirmacion la primera vez que pasa a completa.
      criticidadConfirmadaEn: completa && !existente.completa ? new Date() : existente.criticidadConfirmadaEn,
    },
  });

  return NextResponse.json({ ok: true, conexion });
}
