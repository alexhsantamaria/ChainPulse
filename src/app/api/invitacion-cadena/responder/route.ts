// Ruta API — persiste la respuesta de un invitado sin cuenta a las
// dimensiones de comparacion multi-rol de una Cadena/ConexionCadena
// (RF36-38). Publica, sin requireSession(): la identidad de quien
// responde es el email firmado dentro del propio token (RF36, decision
// de Alex 2026-09-24 de no crear Usuario), nunca un dato que aporte quien
// visita la pagina.
import { NextResponse } from "next/server";
import { z } from "zod";
import { verificarTokenInvitacionCadena } from "@/infra/auth/invitacion";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { logError } from "@/infra/log";

const responderSchema = z.object({
  token: z.string().min(1),
  prioridadElegida: z
    .enum([
      "DISPONIBILIDAD",
      "RAPIDEZ",
      "CUMPLIMIENTO_FECHA_CANTIDAD",
      "CALIDAD_CONSISTENCIA",
      "PRECIO_EFICIENCIA",
      "PERSONALIZACION",
      "CONTINUIDAD_INTERRUPCIONES",
      "NO_DEFINIDA",
    ])
    .nullish(),
  nodoCriticoId: z.string().min(1).nullish(),
  conocimientoEntradasSalidas: z
    .enum(["DEFINIDO_Y_USADO", "CLARO_PARA_ALGUNAS_AREAS", "DEPENDE_DE_PERSONAS", "NO_CLARO", "NO_SABE"])
    .nullish(),
  momentoInformacion: z.enum(["CORTO", "MEDIO", "LARGO"]).nullish(),
  fuenteDatos: z
    .enum(["SAP_ERP", "EXCEL", "WMS_TMS_APS", "CORREO_MENSAJERIA", "VARIOS_SISTEMAS", "SIN_FUENTE_DEFINIDA"])
    .nullish(),
  tieneAlternativa: z.boolean().nullish(),
  alternativaProbada: z.boolean().nullish(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = responderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const payload = await verificarTokenInvitacionCadena(parsed.data.token);
  if (!payload) {
    return NextResponse.json({ ok: false, error: "TOKEN_INVALIDO" }, { status: 400 });
  }

  const client = tenantClient(payload.empresaId);
  const cadena = await client.cadena.findUnique({ where: { id: payload.cadenaId } });
  if (!cadena) {
    return NextResponse.json({ ok: false, error: "CADENA_INEXISTENTE" }, { status: 404 });
  }

  // RF37: el invitado nunca responde preguntas fuera de su alcance --
  // aunque el cliente mande de mas (o se manipule el body a mano), el
  // servidor solo persiste los campos que corresponden al alcance real
  // del token (derivado del propio token, nunca del body), nunca los del
  // otro alcance.
  let datos: {
    prioridadElegida: typeof parsed.data.prioridadElegida;
    nodoCriticoId: string | null;
    conocimientoEntradasSalidas: typeof parsed.data.conocimientoEntradasSalidas;
    momentoInformacion: typeof parsed.data.momentoInformacion;
    fuenteDatos: typeof parsed.data.fuenteDatos;
    tieneAlternativa: boolean | null;
    alternativaProbada: boolean | null;
  };

  if (payload.conexionCadenaId) {
    const conexionCadena = await client.conexionCadena.findUnique({ where: { id: payload.conexionCadenaId } });
    if (!conexionCadena || conexionCadena.cadenaId !== payload.cadenaId) {
      return NextResponse.json({ ok: false, error: "CONEXION_INEXISTENTE" }, { status: 404 });
    }
    datos = {
      prioridadElegida: null,
      nodoCriticoId: null,
      conocimientoEntradasSalidas: parsed.data.conocimientoEntradasSalidas ?? null,
      momentoInformacion: parsed.data.momentoInformacion ?? null,
      fuenteDatos: parsed.data.fuenteDatos ?? null,
      tieneAlternativa: parsed.data.tieneAlternativa ?? null,
      alternativaProbada: parsed.data.tieneAlternativa ? (parsed.data.alternativaProbada ?? null) : null,
    };
  } else {
    // "cinturon y tirantes" -- si vino nodoCriticoId, confirmar que
    // pertenece a esta cadena antes de guardarlo (mismo criterio de
    // agregarConexionCadena.ts).
    let nodoCriticoId: string | null = null;
    if (parsed.data.nodoCriticoId) {
      const nodo = await client.nodo.findUnique({ where: { id: parsed.data.nodoCriticoId } });
      if (!nodo || nodo.cadenaId !== payload.cadenaId) {
        return NextResponse.json({ ok: false, error: "NODO_INVALIDO" }, { status: 400 });
      }
      nodoCriticoId = nodo.id;
    }
    datos = {
      prioridadElegida: parsed.data.prioridadElegida ?? null,
      nodoCriticoId,
      conocimientoEntradasSalidas: null,
      momentoInformacion: null,
      fuenteDatos: null,
      tieneAlternativa: null,
      alternativaProbada: null,
    };
  }

  // Identidad real (ver comentario de RespuestaCadena en schema.prisma):
  // find-then-create-or-update a mano, NO el upsert() de Prisma -- los
  // dos indices unicos parciales de la migracion no son un @@unique que
  // Prisma reconozca (conexionCadenaId nullable).
  const existente = await client.respuestaCadena.findFirst({
    where: payload.conexionCadenaId
      ? { conexionCadenaId: payload.conexionCadenaId, email: payload.email }
      : { cadenaId: payload.cadenaId, email: payload.email, conexionCadenaId: null },
  });

  try {
    if (existente) {
      await client.respuestaCadena.update({ where: { id: existente.id }, data: datos });
    } else {
      await client.respuestaCadena.create({
        data: {
          // empresaId explicito, del payload YA verificado del token
          // (nunca del body) -- injectTenantFilter() lo sobrescribe igual
          // en runtime, pero sin pasarlo aca el tipo generado real de
          // Prisma (Windows) exige empresaId como campo no opcional en el
          // create -- mismo patron ya usado en cadenas/[id]/nodos/route.ts
          // y conexiones/route.ts.
          empresaId: payload.empresaId,
          cadenaId: payload.cadenaId,
          conexionCadenaId: payload.conexionCadenaId,
          email: payload.email,
          ...datos,
        },
      });
    }
  } catch (err) {
    logError("api/invitacion-cadena/responder POST", err);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
