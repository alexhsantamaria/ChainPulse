// Ruta API -- confirma una ImportacionCsv de Cobertura ya subida
// (route.ts del padre): fija el mapeo final de columnas, la estrategia,
// fuenteConsumo/periodo de referencia del consumo, y encola el
// procesamiento. Incremento 4 Bloque B, vertical slice de Cobertura.
//
// Inmutabilidad tras confirmar (Alex, 2026-09-25): esta ruta SOLO acepta
// una ImportacionCsv en estado PENDIENTE_REVISION sin confirmadaEn -- una
// vez que estado pasa a CONFIRMADA (siempre junto con confirmadaEn/
// confirmadaPorId, en la misma escritura, solo tras encolar con exito),
// un segundo POST se rechaza con 409. No hay "reconfirmar con otros
// valores" -- hace falta una importacion nueva.
//
// Persistencia ANTES de encolar (Alex): mapeo/estrategia/alcance/
// fuenteConsumo/periodo se guardan en una escritura separada, ANTES de
// intentar encolar el job -- si falla el encolado (ver mas abajo,
// reintentos), esos datos ya quedaron guardados y un segundo POST
// (idempotente, misma validacion) puede reintentar solo el encolado sin
// perder lo ya guardado.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { logError } from "@/infra/log";
import { validarMapeoColumnas, detectarColumnasSospechosasDeConsumo, type MapeoColumnasCobertura } from "@/domain/mapeoColumnasCsv";
import { claveNegocio } from "@/infra/kpis/cobertura/importar";
import { encolarImportacionCsv, procesarImportacionesCsv, type MapeoColumnasPersistido } from "@/infra/kpis/cobertura/job";
import { obtenerBoss } from "@/infra/jobs/pgBoss";

export const runtime = "nodejs";

const mapeoColumnasSchema: z.ZodType<MapeoColumnasCobertura> = z.object({
  sku: z.string().min(1).nullable(),
  ubicacion: z.string().min(1).nullable(),
  fechaCorte: z.string().min(1).nullable(),
  inventarioDisponible: z.string().min(1).nullable(),
  unidadInventario: z.string().min(1).nullable(),
  consumoDiarioEsperado: z.string().min(1).nullable(),
  unidadConsumoDiario: z.string().min(1).nullable(),
});

const confirmarSchema = z
  .object({
    mapeoColumnas: mapeoColumnasSchema,
    // Encabezados que el usuario revisó y decidió ignorar explícitamente
    // (Alex: "no ignorarlas ni sobrescribirlas silenciosamente" -- nunca
    // una confirmacion en blanco, cada encabezado sospechoso debe listarse
    // por su nombre exacto).
    columnasSospechosasReconocidas: z.array(z.string()).default([]),
    estrategia: z.enum(["CARGA_PARCIAL", "REEMPLAZO_ALCANCE"]),
    alcanceFechaCorteInicio: z.coerce.date().nullish(),
    alcanceFechaCorteFin: z.coerce.date().nullish(),
    alcanceUbicaciones: z.array(z.string().trim().min(1)).nullish(),
    // El usuario vio la vista previa de retiro (candidatasRetiro de una
    // llamada anterior con soloVistaPrevia=true) y la confirma -- Alex:
    // "mostrar el alcance explícito y los registros que se retirarán
    // antes de confirmar". Solo exigido para REEMPLAZO_ALCANCE.
    confirmarRetiro: z.boolean().default(false),
    fuenteConsumo: z.string().trim().min(1),
    periodoReferenciaConsumoInicio: z.coerce.date(),
    periodoReferenciaConsumoFin: z.coerce.date(),
    // true: solo calcula y devuelve la vista previa (mapeo valido,
    // columnas sospechosas, candidatas a retiro) -- NUNCA persiste ni
    // encola nada. Lo llama la UI antes de mostrar el boton final de
    // "Confirmar".
    soloVistaPrevia: z.boolean().default(false),
  })
  .refine((d) => d.periodoReferenciaConsumoInicio <= d.periodoReferenciaConsumoFin, {
    message: "periodoReferenciaConsumoInicio debe ser anterior o igual a periodoReferenciaConsumoFin",
    path: ["periodoReferenciaConsumoInicio"],
  })
  .refine(
    (d) =>
      d.estrategia !== "REEMPLAZO_ALCANCE" ||
      (d.alcanceFechaCorteInicio && d.alcanceFechaCorteFin && d.alcanceUbicaciones && d.alcanceUbicaciones.length > 0),
    {
      message: "REEMPLAZO_ALCANCE exige alcanceFechaCorteInicio, alcanceFechaCorteFin y alcanceUbicaciones (al menos una)",
      path: ["alcanceUbicaciones"],
    },
  )
  .refine((d) => !d.alcanceFechaCorteInicio || !d.alcanceFechaCorteFin || d.alcanceFechaCorteInicio <= d.alcanceFechaCorteFin, {
    message: "alcanceFechaCorteInicio debe ser anterior o igual a alcanceFechaCorteFin",
    path: ["alcanceFechaCorteInicio"],
  });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const resultadoSesion = await requireAdmin();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;
  const { id: importId } = await context.params;

  const cliente = tenantClient(sesion.empresaId);
  const importacion = await cliente.importacionCsv.findUnique({ where: { id: importId } });
  if (!importacion) {
    return NextResponse.json({ ok: false, error: "IMPORTACION_INEXISTENTE" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = confirmarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS", detalle: parsed.error.flatten() }, { status: 400 });
  }
  const datos = parsed.data;

  // Inmutabilidad -- ver cabecera. Se chequea DESPUES de validar el body
  // (para que un error de body siempre gane, mas facil de depurar) pero
  // ANTES de tocar nada mas.
  if (!datos.soloVistaPrevia && (importacion.estado !== "PENDIENTE_REVISION" || importacion.confirmadaEn)) {
    return NextResponse.json({ ok: false, error: "YA_CONFIRMADA" }, { status: 409 });
  }

  const mapeoPersistido = importacion.mapeoColumnas as unknown as MapeoColumnasPersistido | null;
  if (!mapeoPersistido) {
    logError("api/kpis/cobertura/importaciones/[id]/confirmar", new Error(`ImportacionCsv ${importId} sin mapeoColumnas persistido`));
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }

  // Re-validar SIEMPRE contra los encabezados reales persistidos en la
  // subida -- nunca confiar en lo que manda el cliente en el body.
  const validacionMapeo = validarMapeoColumnas(datos.mapeoColumnas, mapeoPersistido.encabezados);
  if (!validacionMapeo.valido) {
    return NextResponse.json({ ok: false, error: "MAPEO_INVALIDO", detalle: validacionMapeo }, { status: 400 });
  }

  const sospechosas = detectarColumnasSospechosasDeConsumo(mapeoPersistido.encabezados, datos.mapeoColumnas);
  const sinResolver = sospechosas.filter((s) => !datos.columnasSospechosasReconocidas.includes(s.encabezado));
  if (sinResolver.length > 0) {
    return NextResponse.json({ ok: false, error: "COLUMNAS_SOSPECHOSAS_SIN_RESOLVER", columnas: sinResolver }, { status: 400 });
  }

  // Candidatas a retiro -- SOLO se calculan si REEMPLAZO_ALCANCE. Requiere
  // conocer que claves de negocio trae el archivo: se re-descarga+
  // descifra+parsea aca (el objeto en R2 es inmutable desde la subida,
  // nunca cambia) -- costo aceptable (archivo <=4MB) a cambio de nunca
  // confiar en datos de fila que el cliente pudiera mandar en el body.
  let candidatasRetiro: Array<{ id: string; sku: string; ubicacion: string; fechaCorte: Date }> = [];
  if (datos.estrategia === "REEMPLAZO_ALCANCE") {
    const clavesEnArchivo = await calcularClavesEnArchivo(sesion.empresaId, importId, importacion, datos.mapeoColumnas);
    if (!clavesEnArchivo.ok) {
      return NextResponse.json({ ok: false, error: clavesEnArchivo.error }, { status: 502 });
    }
    const vigentesEnAlcance = await cliente.observacionCobertura.findMany({
      where: {
        cadenaId: importacion.cadenaId,
        fuente: "csv",
        vigente: true,
        fechaCorte: { gte: datos.alcanceFechaCorteInicio!, lte: datos.alcanceFechaCorteFin! },
        ubicacion: { in: datos.alcanceUbicaciones! },
      },
      select: { id: true, sku: true, ubicacion: true, fechaCorte: true },
    });
    candidatasRetiro = vigentesEnAlcance.filter(
      (fila: { sku: string; ubicacion: string; fechaCorte: Date }) =>
        !clavesEnArchivo.claves.has(claveNegocio(fila.sku, fila.ubicacion, fila.fechaCorte)),
    );
  }

  if (datos.soloVistaPrevia) {
    return NextResponse.json({ ok: true, vistaPrevia: true, mapeoValido: true, candidatasRetiro });
  }

  if (datos.estrategia === "REEMPLAZO_ALCANCE" && !datos.confirmarRetiro) {
    return NextResponse.json(
      { ok: false, error: "DEBE_CONFIRMAR_RETIRO", candidatasRetiro },
      { status: 400 },
    );
  }

  // 1. Persistir los datos confirmados -- ANTES de intentar encolar (ver
  //    cabecera). estado/confirmadaEn/confirmadaPorId NO se tocan aca
  //    todavia.
  await cliente.importacionCsv.update({
    where: { id: importId },
    data: {
      mapeoColumnas: { ...mapeoPersistido, confirmado: datos.mapeoColumnas } satisfies MapeoColumnasPersistido,
      estrategia: datos.estrategia,
      alcanceFechaCorteInicio: datos.alcanceFechaCorteInicio ?? null,
      alcanceFechaCorteFin: datos.alcanceFechaCorteFin ?? null,
      alcanceUbicaciones: datos.alcanceUbicaciones ?? null,
      fuenteConsumo: datos.fuenteConsumo,
      periodoReferenciaConsumoInicio: datos.periodoReferenciaConsumoInicio,
      periodoReferenciaConsumoFin: datos.periodoReferenciaConsumoFin,
    },
  });

  // 2. Encolar, con reintentos cortos -- "garantizar recuperacion si se
  //    guarda la confirmacion pero falla el encolado" (Alex). Si los 3
  //    intentos fallan, NO se marca CONFIRMADA -- los datos ya guardados
  //    en el paso 1 quedan intactos y un nuevo POST a esta misma ruta
  //    revalida todo de nuevo y reintenta encolar, sin perder nada.
  const boss = await obtenerBoss();
  let encolado = false;
  let ultimoError: unknown;
  for (let intento = 0; intento < 3 && !encolado; intento += 1) {
    try {
      await encolarImportacionCsv(boss, { importId, empresaId: sesion.empresaId });
      encolado = true;
    } catch (err) {
      ultimoError = err;
    }
  }
  if (!encolado) {
    logError("api/kpis/cobertura/importaciones/[id]/confirmar", ultimoError);
    return NextResponse.json(
      { ok: false, error: "NO_SE_PUDO_ENCOLAR", mensaje: "Los datos se guardaron. Volvé a confirmar para reintentar el procesamiento." },
      { status: 502 },
    );
  }

  // 3. Recien AHORA, junto con el encolado ya exitoso: CONFIRMADA +
  //    confirmadaEn/confirmadaPorId, todos en la misma escritura.
  await cliente.importacionCsv.update({
    where: { id: importId },
    data: { estado: "CONFIRMADA", confirmadaPorId: sesion.usuarioId, confirmadaEn: new Date() },
  });

  // 4. Disparo inmediato -- caso feliz, procesa en el mismo ciclo en vez
  //    de esperar al cron de respaldo (run/route.ts). Si esto falla, no
  //    es un error para el usuario -- el job YA esta encolado de forma
  //    durable (paso 2), el cron lo toma en su proxima corrida.
  try {
    await procesarImportacionesCsv(boss, 1);
  } catch (err) {
    logError("api/kpis/cobertura/importaciones/[id]/confirmar (disparo inmediato)", err);
  }

  return NextResponse.json({ ok: true, importId });
}

/** Re-descarga+descifra+parsea el archivo y devuelve el conjunto de
 * claves de negocio que trae, usando el mapeo dado. Solo se llama para
 * REEMPLAZO_ALCANCE (calcular candidatas a retiro). */
async function calcularClavesEnArchivo(
  empresaId: string,
  importId: string,
  importacion: {
    objetoStorageKey: string;
    cifradoClaveId: string | null;
    cifradoDek: string | null;
    cifradoDekIv: string | null;
    cifradoDekAuthTag: string | null;
  },
  mapeo: MapeoColumnasCobertura,
): Promise<{ ok: true; claves: Set<string> } | { ok: false; error: string }> {
  if (!importacion.cifradoClaveId || !importacion.cifradoDek || !importacion.cifradoDekIv || !importacion.cifradoDekAuthTag) {
    return { ok: false, error: "METADATA_CIFRADO_INCOMPLETA" };
  }
  try {
    const [{ ClienteAlmacenamientoR2 }, { desenvolverDek, descifrarContenido, obtenerClaveMaestraPorId }, Papa, { interpretarFilaCobertura }] =
      await Promise.all([
        import("@/infra/storage/r2"),
        import("@/infra/storage/cifradoObjeto"),
        import("papaparse"),
        import("@/domain/interpretarFilaCoberturaCsv"),
      ]);
    const objetoCifrado = await new ClienteAlmacenamientoR2().descargarObjeto(importacion.objetoStorageKey);
    const claveMaestra = obtenerClaveMaestraPorId(importacion.cifradoClaveId);
    const dek = desenvolverDek(
      { dekCifrada: importacion.cifradoDek, iv: importacion.cifradoDekIv, authTag: importacion.cifradoDekAuthTag },
      claveMaestra,
      empresaId,
      importId,
    );
    const contenido = descifrarContenido(objetoCifrado, dek, empresaId, importId);
    const parseado = Papa.default.parse<Record<string, string>>(contenido.toString("utf8"), { header: true, skipEmptyLines: true });
    const claves = new Set<string>();
    parseado.data.forEach((fila, indice) => {
      const r = interpretarFilaCobertura(fila, indice + 1, mapeo);
      if (r.ok) claves.add(claveNegocio(r.datos.fila.sku, r.datos.fila.ubicacion, r.datos.fila.fecha));
    });
    return { ok: true, claves };
  } catch (err) {
    logError("api/kpis/cobertura/importaciones/[id]/confirmar (calcularClavesEnArchivo)", err);
    return { ok: false, error: "ERROR_LEYENDO_ARCHIVO" };
  }
}
