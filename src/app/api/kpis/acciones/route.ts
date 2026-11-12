// Ruta API -- crea una AccionDecisionKpi nueva (POST) y lista el
// historial de acciones de UN origen (GET ?observacionKpiId=... o
// ?importacionCsvId=...). Incremento 4 PR3 (persistencia y seguimiento
// de acciones de decision de KPI).
//
// Solo ADMINISTRADOR (requireAdmin()) -- mismo criterio que el resto de
// la API de KPIs (confirmar cobertura, confirmar OTIF/Fill Rate): ambas
// paginas desde las que se usa esta API (DetalleObservacionKpi.tsx,
// Cobertura [id]/page.tsx) ya exigen requireAdminOrRedirect() para
// verse siquiera. Si en el futuro un RESPONSABLE debe poder actualizar
// SOLO las acciones que se le asignaron, es una decision de producto
// nueva (ver el reporte de entrega, "decisiones pendientes") -- esta
// ruta no la asume.
//
// creadaPorId SIEMPRE se deriva de la sesion (sesion.usuarioId), nunca
// del body -- mismo criterio que confirmadaPorId en
// kpis/cobertura/importaciones/[id]/confirmar/route.ts.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { crearAccionDecisionKpi, listarAccionesPorOrigen } from "@/infra/kpis/acciones/servicio";
import { validarOrigenUnico } from "@/infra/kpis/acciones/validacion";

export const runtime = "nodejs";

const origenSchema = z.union([
  z.object({ tipo: z.literal("OBSERVACION_KPI"), observacionKpiId: z.string().min(1) }),
  z.object({ tipo: z.literal("IMPORTACION_CSV"), importacionCsvId: z.string().min(1) }),
]);

// Correccion de ronda de revision (bloqueante 1): este schema YA NO
// acepta `ruleVersionOrigen` ni `prioridadOrigen` -- ANTES el cliente
// los declaraba en el body (con los mismos valores que la pagina le
// habia sugerido) y el servidor los guardaba tal cual, sin volver a
// calcularlos; un body manipulado a mano podia declarar una prioridad o
// una version de regla que no coincidian con el analisis real del
// origen en ese momento. Ahora `crearAccionDecisionKpi()` los deriva
// SIEMPRE en el servidor (ver derivarOrigenActual.ts) -- zod ya no los
// reconoce como campos del body (si vinieran, zod los ignora en
// silencio como cualquier clave no declarada; lo que importa es que
// `DatosCrearAccionDecisionKpi` -- tipos.ts -- ni los admite como
// parametro de crearAccionDecisionKpi(), asi que esta ruta no podria
// reenviarlos ni queriendo).
const crearAccionSchema = z.object({
  origen: origenSchema,
  descripcionAccion: z.string().trim().min(1),
  responsableId: z.string().min(1),
  fechaObjetivo: z.coerce.date(),
});

/** Mapa de error de servicio -> status HTTP. Los `_INEXISTENTE` son 404
 * (una referencia que el body declaro no existe); ORIGEN_SIN_RECOMENDACION_ACCIONABLE
 * es 409 (conflicto con el ESTADO ACTUAL del origen -- el analisis ya
 * no sugiere una accion, no es un dato malformado, mismo criterio que
 * TRANSICION_INVALIDA en la ruta hermana); el resto es 400 (datos
 * validos en forma pero inconsistentes en contenido). */
function estadoHttpParaError(error: string): number {
  if (error.endsWith("_INEXISTENTE")) return 404;
  if (error === "ORIGEN_SIN_RECOMENDACION_ACCIONABLE") return 409;
  return 400;
}

export async function POST(request: Request) {
  const resultadoSesion = await requireAdmin();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const body = await request.json().catch(() => null);
  const parsed = crearAccionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS", detalle: parsed.error.flatten() }, { status: 400 });
  }

  const cliente = tenantClient(sesion.empresaId);
  const resultado = await crearAccionDecisionKpi(cliente, {
    empresaId: sesion.empresaId,
    origen: parsed.data.origen,
    descripcionAccion: parsed.data.descripcionAccion,
    responsableId: parsed.data.responsableId,
    fechaObjetivo: parsed.data.fechaObjetivo,
    creadaPorId: sesion.usuarioId,
  });

  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, error: resultado.error, detalle: resultado.detalle },
      { status: estadoHttpParaError(resultado.error) },
    );
  }

  return NextResponse.json({ ok: true, accion: resultado.datos }, { status: 201 });
}

export async function GET(request: Request) {
  const resultadoSesion = await requireAdmin();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const { searchParams } = new URL(request.url);
  const observacionKpiId = searchParams.get("observacionKpiId");
  const importacionCsvId = searchParams.get("importacionCsvId");

  const validacion = validarOrigenUnico(observacionKpiId, importacionCsvId);
  if (!validacion.valido) {
    return NextResponse.json({ ok: false, error: "ORIGEN_INVALIDO", detalle: validacion.errores }, { status: 400 });
  }

  const cliente = tenantClient(sesion.empresaId);
  const acciones = observacionKpiId
    ? await listarAccionesPorOrigen(cliente, { observacionKpiId })
    : await listarAccionesPorOrigen(cliente, { importacionCsvId: importacionCsvId as string });

  return NextResponse.json({ ok: true, acciones });
}
