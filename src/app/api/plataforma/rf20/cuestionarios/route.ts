// Ruta API — RF20 (PR 8): listar codigos de cuestionario y crear la
// primera version (BORRADOR) de un codigo nuevo. No duplica ninguna
// invariante: crearCuestionarioVersion() solo invoca
// public.crear_cuestionario_version() (§7.3); listarCuestionarios() es
// un SELECT simple (§4.1 otorga GRANT SELECT directo a chainpulse_app).
import { NextResponse } from "next/server";
import { requireSesionPlataformaRuta } from "@/infra/auth/sessionPlataforma";
import { validarSolicitudEscrituraPlataforma } from "@/infra/auth/seguridadPlataforma";
import { listarCuestionarios } from "@/infra/rf20/consultas";
import { crearCuestionarioVersion } from "@/infra/rf20/gobernanzaVersiones";
import { RESPUESTA_CUERPO_INVALIDO, RESPUESTA_ERROR_INTERNO } from "@/infra/rf20/respuestasHttp";
import { crearCuestionarioSchema } from "./schema";

export async function GET() {
  const resultado = await requireSesionPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  try {
    const cuestionarios = await listarCuestionarios();
    return NextResponse.json({ ok: true, cuestionarios });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}

export async function POST(request: Request) {
  const rechazo = validarSolicitudEscrituraPlataforma(request);
  if (rechazo) return rechazo;

  const resultado = await requireSesionPlataformaRuta();
  if ("respuesta" in resultado) return resultado.respuesta;

  const parsed = crearCuestionarioSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return RESPUESTA_CUERPO_INVALIDO();

  try {
    const creada = await crearCuestionarioVersion(parsed.data.codigo, resultado.sesion.usuarioId);
    return NextResponse.json({ ok: true, ...creada }, { status: 201 });
  } catch {
    return RESPUESTA_ERROR_INTERNO();
  }
}
