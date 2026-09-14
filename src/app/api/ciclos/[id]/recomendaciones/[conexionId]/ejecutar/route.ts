// Ruta API — marca la recomendacion (RF8) de una conexion como ejecutada (RNF9).
// Accion de administrador, igual criterio de autorizacion que cerrar/abrir ciclo:
// no depende de si la conexion es efectivamente uno de los eslabones mas debiles
// en la lectura actual -- eso ya lo filtra la UI que muestra el boton -- aca solo
// se registra la marca, idempotente via upsert (ver recomendacionEjecutada.ts).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { marcarRecomendacionEjecutada } from "@/infra/ciclos/recomendacionEjecutada";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; conexionId: string }> },
) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    return NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 });
  }
  if (session.user.rol !== "ADMINISTRADOR") {
    return NextResponse.json({ ok: false, error: "NO_AUTORIZADO" }, { status: 403 });
  }

  const { id, conexionId } = await params;

  try {
    await marcarRecomendacionEjecutada({
      empresaId: session.user.empresaId,
      cicloPulsoId: id,
      conexionId,
      usuarioId: session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}
