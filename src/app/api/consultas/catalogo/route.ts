// Ruta API -- GET del catalogo cerrado de Incremento 5 (I5-08, I5-26: "la
// interfaz solo puede ofrecer las 6 preguntas fijas"). Expone unicamente
// metadata PURA (titulo, descripcion, dependenciasDatos, requierePeriodo,
// comportamientoSinDatos, ruleVersion) -- nunca el detalle de ejecutor ni
// de Prisma (ver MetadatosCatalogoConsulta en domain/queries/tipos.ts).
//
// requireSession() (cualquier rol con sesion valida, igual que GET de
// observaciones OTIF/Fill Rate): esta ruta es de solo lectura de
// metadata, nunca ejecuta una consulta ni toca datos de una cadena.
//
// Filtra por `metadatos.permisos.includes(sesion.rol)` -- hoy es un
// no-op (las 6 entradas actuales permiten ADMINISTRADOR y RESPONSABLE
// por igual, ver catalogo.ts), pero evita que una futura entrada con
// permisos mas estrechos se liste a un rol que de todos modos recibiria
// PERMISO_DENEGADO al intentar ejecutarla.
import { NextResponse } from "next/server";
import { requireSession } from "@/infra/auth/session";
import { listarCatalogoConsultas } from "@/infra/queries/catalogo";

export const runtime = "nodejs";

export async function GET() {
  const resultadoSesion = await requireSession();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const catalogo = listarCatalogoConsultas().filter((metadatos) => metadatos.permisos.includes(sesion.rol));

  return NextResponse.json({ ok: true, catalogo });
}
