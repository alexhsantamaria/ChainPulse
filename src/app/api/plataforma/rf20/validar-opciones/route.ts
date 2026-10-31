// Ruta API — RF20 (PR 8), ayuda de UX (no prescrita literalmente por la
// adenda, agregada en PR 8 porque crear/editar pregunta NO valida la
// estructura de "opciones" -- esa validacion solo corre al publicar,
// §7.8 -- y el usuario pidio minimizar el numero de campos/intentos que
// el curador necesita para completar una pregunta sin errores). Invoca
// EXACTAMENTE la misma funcion que usara publicar_cuestionario_version()
// internamente (validar_estructura_opciones_pregunta(), §7.8): ningun
// motivo de rechazo se reimplementa aqui.
import { NextResponse } from "next/server";
import { requireSesionPlataformaRuta } from "@/infra/auth/sessionPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";
import { validarEstructuraOpcionesPregunta } from "@/infra/rf20/gobernanzaVersiones";
import { RESPUESTA_CUERPO_INVALIDO, RESPUESTA_ERROR_INTERNO } from "@/infra/rf20/respuestasHttp";
import { validarOpcionesSchema } from "./schema";

export async function POST(request: Request) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const resultado = await requireSesionPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const parsed = validarOpcionesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return RESPUESTA_CUERPO_INVALIDO();

  try {
    const salida = await validarEstructuraOpcionesPregunta(parsed.data.opciones);
    return NextResponse.json({ ok: true, ...salida });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}
