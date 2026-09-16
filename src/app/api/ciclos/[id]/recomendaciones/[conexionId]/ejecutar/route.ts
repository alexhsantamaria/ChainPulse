// Ruta API — marca la recomendacion (RF8) de una conexion como ejecutada (RNF9).
// Accion de administrador, igual criterio de autorizacion que cerrar/abrir ciclo:
// no depende de si la conexion es efectivamente uno de los eslabones mas debiles
// en la lectura actual -- eso ya lo filtra la UI que muestra el boton -- aca solo
// se registra la marca, idempotente via upsert (ver recomendacionEjecutada.ts).
import { NextResponse } from "next/server";
import { requireAdmin } from "@/infra/auth/session";
import { marcarRecomendacionEjecutada } from "@/infra/ciclos/recomendacionEjecutada";
import { logError } from "@/infra/log";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; conexionId: string }> },
) {
  const resultado = await requireAdmin();
  if ("respuesta" in resultado) return resultado.respuesta;

  const { id, conexionId } = await params;

  try {
    await marcarRecomendacionEjecutada({
      empresaId: resultado.sesion.empresaId,
      cicloPulsoId: id,
      conexionId,
      usuarioId: resultado.sesion.usuarioId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("api/ciclos/[id]/recomendaciones/[conexionId]/ejecutar", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
