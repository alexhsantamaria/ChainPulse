// Ruta API -- consulta el estado real de UNA ImportacionCsv de Cobertura
// (estado/procesadaEn/erroresMuestra), para que la UI del asistente de
// confirmacion pueda reflejar el resultado del job de fondo en vez de
// quedarse con el mensaje estatico "Importacion confirmada" que mostraba
// antes.
//
// Origen: Alex, 2026-09-29 -- reporte manual sobre la importacion
// b221c930-059e-45db-b1c2-f3121a85e495 ("Cobertura VALIDACION - ERRORES"):
// la pantalla de resultado seguia diciendo "Importacion confirmada"
// mientras el historial de abajo (que SI consulta el estado real, ver
// dashboard/kpis/cobertura/page.tsx) ya mostraba "Error". El wizard
// nunca volvia a consultar la importacion despues de confirmar -- esta
// ruta es lo que le falta para poder hacerlo (polling desde el cliente).
//
// Solo ADMINISTRADOR (mismo criterio que el resto de las rutas de
// Cobertura -- ver .../confirmar/route.ts) y solo lectura, tenantClient
// ya filtra por empresaId (RLS) asi que un id de otra empresa da 404,
// nunca 403 (no revela existencia cross-tenant).
import { NextResponse } from "next/server";
import { requireAdmin } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const resultadoSesion = await requireAdmin();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;
  const { id: importId } = await context.params;

  const importacion = await tenantClient(sesion.empresaId).importacionCsv.findUnique({
    where: { id: importId },
    select: {
      id: true,
      estado: true,
      procesadaEn: true,
      filasDetectadas: true,
      filasConError: true,
      erroresMuestra: true,
    },
  });
  if (!importacion) {
    return NextResponse.json({ ok: false, error: "IMPORTACION_INEXISTENTE" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    importId: importacion.id,
    estado: importacion.estado,
    procesadaEn: importacion.procesadaEn ? importacion.procesadaEn.toISOString() : null,
    filasDetectadas: importacion.filasDetectadas,
    filasConError: importacion.filasConError,
    // erroresMuestra es Json? en el schema -- Prisma lo tipa `JsonValue`,
    // se castea al shape real que job.ts/marcarError() escriben (ver
    // erroresMuestra en job.ts).
    erroresMuestra: importacion.erroresMuestra as Array<{ numeroFila?: number; error: string }> | null,
  });
}
