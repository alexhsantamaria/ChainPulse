// Ruta API -- actualiza una AccionDecisionKpi existente (estado,
// responsable, fecha objetivo y/o descripcion). Incremento 4 PR3.
//
// finalizadaPorId SIEMPRE se deriva de la sesion cuando `estado` pasa a
// un estado terminal (COMPLETADA/DESCARTADA) -- nunca un campo que el
// cliente pueda declarar libremente (mismo criterio que creadaPorId en
// la ruta hermana y que confirmadaPorId en el resto de esta API). Solo
// ADMINISTRADOR (requireAdmin()) -- ver el comentario de cabecera de
// ../route.ts para el razonamiento completo.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { actualizarAccionDecisionKpi } from "@/infra/kpis/acciones/servicio";

export const runtime = "nodejs";

const actualizarAccionSchema = z
  .object({
    estado: z.enum(["PENDIENTE", "EN_PROGRESO", "COMPLETADA", "DESCARTADA"]).optional(),
    responsableId: z.string().min(1).optional(),
    fechaObjetivo: z.coerce.date().optional(),
    descripcionAccion: z.string().trim().min(1).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Debe incluir al menos un campo a actualizar" });

/** Mismo criterio que ../route.ts -- `_INEXISTENTE` es 404. 409 es
 * "conflicto con el ESTADO ACTUAL de la accion, no un dato malformado"
 * -- 3 codigos distintos caen aca: TRANSICION_INVALIDA (la accion ya
 * esta finalizada y el PATCH pide OTRO estado), ACCION_FINALIZADA_INMUTABLE
 * (correccion de ronda de revision, bloqueante 2: la accion ya esta
 * finalizada y el PATCH pide cambiar CUALQUIER OTRO campo, sin tocar el
 * estado) y ACCION_MODIFICADA_CONCURRENTEMENTE (bloqueante 3: otro
 * PATCH concurrente ya cambio el estado de esta misma accion entre que
 * esta peticion la leyo y la escribio). El resto es 400. */
function estadoHttpParaError(error: string): number {
  if (error.endsWith("_INEXISTENTE")) return 404;
  if (error === "TRANSICION_INVALIDA" || error === "ACCION_FINALIZADA_INMUTABLE" || error === "ACCION_MODIFICADA_CONCURRENTEMENTE") {
    return 409;
  }
  return 400;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const resultadoSesion = await requireAdmin();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;
  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = actualizarAccionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS", detalle: parsed.error.flatten() }, { status: 400 });
  }

  const esFinalizacion = parsed.data.estado === "COMPLETADA" || parsed.data.estado === "DESCARTADA";

  const cliente = tenantClient(sesion.empresaId);
  const resultado = await actualizarAccionDecisionKpi(cliente, id, {
    ...parsed.data,
    ...(esFinalizacion ? { finalizadaPorId: sesion.usuarioId } : {}),
  });

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, error: resultado.error, detalle: resultado.detalle },
      { status: estadoHttpParaError(resultado.error) },
    );
  }

  return NextResponse.json({ ok: true, accion: resultado.datos });
}
