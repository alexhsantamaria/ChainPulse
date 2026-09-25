// Ruta API -- confirma una ImportacionCsv de Cobertura ya subida
// (route.ts del padre): fija el mapeo final de columnas, la estrategia,
// fuenteConsumo/periodo de referencia del consumo, y encola el
// procesamiento. Incremento 4 Bloque B, vertical slice de Cobertura.
//
// Revision de Alex (2026-09-25, segunda ronda) que motiva el diseno de
// abajo -- ver tambien claude/lecciones-aprendidas.md:
//
// 1. RECUPERACION ATOMICA (nunca "persistido pero no encolado"): la
//    version anterior persistia primero y encolaba despues, con
//    reintentos -- dejaba una ventana real entre ambas escrituras donde
//    un crash del proceso perdia el encolado sin dejar rastro
//    automatico de recuperacion. Ahora TODO (persistir mapeo/
//    estrategia/alcance/fuenteConsumo/periodo + estado=CONFIRMADA + el
//    INSERT del job de pg-boss) corre en UNA sola transaccion de
//    Postgres via tenantTransaction() + el adaptador oficial
//    `fromPrisma()` de pg-boss (boss.send(..., {db: fromPrisma(tx)}))
//    -- si el proceso muere a mitad de camino, Postgres revierte TODO
//    (la importacion queda exactamente como estaba, PENDIENTE_REVISION,
//    nada encolado) y un reintento normal (mismo POST) no encuentra
//    ningun estado intermedio que reconciliar. Nunca BYPASSRLS: la
//    tabla importaciones_csv se escribe con `tx` (RLS normal via
//    app.tenant_id), el INSERT del job va al schema "pgboss" (fuera de
//    RLS) en la MISMA transaccion/conexion.
// 2. REINTENTO IDEMPOTENTE: un segundo POST con los MISMOS valores sobre
//    una importacion ya CONFIRMADA ya no devuelve 409 a ciegas --
//    compara contra lo persistido (compararConfirmacionImportacionCsv.ts)
//    y devuelve el estado existente sin repetir efectos. Solo un POST
//    con valores DISTINTOS sobre una importacion ya confirmada es 409 --
//    no hay "reconfirmar con otros valores", hace falta una importacion
//    nueva.
// 3. VISTA PREVIA DE RETIRO ATADA A LA ACEPTACION: `confirmarRetiro=true`
//    solo no demuestra que el usuario vio ESTOS candidatos -- la vista
//    previa (soloVistaPrevia=true) devuelve un `retiroHash`
//    (hashVistaPreviaRetiroCobertura.ts) sobre el conjunto EXACTO de
//    candidatas+alcance; la confirmacion real debe mandarlo de vuelta y
//    se recalcula fresco contra la base al momento de confirmar -- si no
//    coincide, algo cambio desde la vista previa y se exige una vista
//    previa nueva (409 RETIRO_DESACTUALIZADO), nunca se confia en el
//    booleano solo.
import { NextResponse } from "next/server";
import { z } from "zod";
import { fromPrisma } from "pg-boss";
import { requireAdmin } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { tenantTransaction } from "@/infra/prisma/tenantTransaction";
import { logError } from "@/infra/log";
import { validarMapeoColumnas, detectarColumnasSospechosasDeConsumo, type MapeoColumnasCobertura } from "@/domain/mapeoColumnasCsv";
import { calcularHashVistaPreviaRetiro, type CandidataRetiroParaHash } from "@/domain/hashVistaPreviaRetiroCobertura";
import { confirmacionesCoinciden, type DatosConfirmacionCobertura } from "@/domain/compararConfirmacionImportacionCsv";
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
    // El usuario vio la vista previa de retiro (candidatasRetiro+retiroHash
    // de una llamada anterior con soloVistaPrevia=true) y la confirma --
    // Alex: "mostrar el alcance explícito y los registros que se
    // retirarán antes de confirmar". Solo exigido para REEMPLAZO_ALCANCE.
    confirmarRetiro: z.boolean().default(false),
    // Debe coincidir EXACTAMENTE con el retiroHash que devolvio la vista
    // previa -- ver cabecera, punto 3. Solo exigido para REEMPLAZO_ALCANCE.
    retiroHash: z.string().min(1).nullish(),
    fuenteConsumo: z.string().trim().min(1),
    periodoReferenciaConsumoInicio: z.coerce.date(),
    periodoReferenciaConsumoFin: z.coerce.date(),
    // true: solo calcula y devuelve la vista previa (mapeo valido,
    // columnas sospechosas, candidatas a retiro + retiroHash) -- NUNCA
    // persiste ni encola nada. Lo llama la UI antes de mostrar el boton
    // final de "Confirmar".
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
  })
  .refine((d) => d.soloVistaPrevia || d.estrategia !== "REEMPLAZO_ALCANCE" || !!d.retiroHash, {
    message: "REEMPLAZO_ALCANCE exige retiroHash (de una vista previa reciente) para confirmar de verdad",
    path: ["retiroHash"],
  });

type DatosConfirmar = z.infer<typeof confirmarSchema>;

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

  // --- Vista previa (nunca persiste ni encola nada) ---------------------
  if (datos.soloVistaPrevia) {
    if (datos.estrategia !== "REEMPLAZO_ALCANCE") {
      return NextResponse.json({ ok: true, vistaPrevia: true, mapeoValido: true, candidatasRetiro: [], retiroHash: null });
    }
    const vista = await calcularVistaPreviaRetiro(cliente, sesion.empresaId, importId, importacion, datos);
    if (!vista.ok) return NextResponse.json({ ok: false, error: vista.error }, { status: 502 });
    return NextResponse.json({
      ok: true,
      vistaPrevia: true,
      mapeoValido: true,
      candidatasRetiro: vista.candidatas,
      retiroHash: vista.hash,
    });
  }

  // --- Reintento sobre una importacion ya confirmada: idempotencia ------
  // (nunca recalcula candidatasRetiro aca -- si REEMPLAZO_ALCANCE ya
  // corrio, el retiro ya se ejecuto y "candidatas ahora" ya no significa
  // lo mismo que al momento de confirmar -- ver
  // compararConfirmacionImportacionCsv.ts).
  if (importacion.estado === "CONFIRMADA" && importacion.confirmadaEn) {
    if (!mapeoPersistido.confirmado) {
      // No deberia poder pasar (CONFIRMADA siempre se escribe junto con
      // mapeoColumnas.confirmado) -- fallar cerrado en vez de asumir.
      logError("api/kpis/cobertura/importaciones/[id]/confirmar", new Error(`ImportacionCsv ${importId} CONFIRMADA sin mapeoColumnas.confirmado`));
      return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
    }
    const persistida = datosConfirmacionDesdeImportacion(importacion, mapeoPersistido.confirmado);
    const nueva = datosConfirmacionDesdeBody(datos);
    if (confirmacionesCoinciden(persistida, nueva)) {
      return NextResponse.json({ ok: true, importId, yaConfirmada: true });
    }
    return NextResponse.json({ ok: false, error: "YA_CONFIRMADA_CON_OTROS_VALORES" }, { status: 409 });
  }
  if (importacion.estado !== "PENDIENTE_REVISION") {
    // ERROR u otro estado -- esta ruta no es un mecanismo de reintento
    // para esos casos (hace falta una importacion nueva).
    return NextResponse.json({ ok: false, error: "ESTADO_NO_CONFIRMABLE", estado: importacion.estado }, { status: 409 });
  }

  // --- Primera confirmacion real (PENDIENTE_REVISION -> CONFIRMADA) -----
  // retiroHashConfirmado: se persiste UNA SOLA VEZ aca (null para
  // CARGA_PARCIAL, que no tiene retiro que autorizar) -- es el valor
  // contra el que el job recomprueba antes de retirar/publicar, ver el
  // comentario del campo en prisma/schema.prisma y
  // procesarRetiroFueraDeAlcanceAutorizado() en
  // src/infra/kpis/cobertura/importar.ts.
  let retiroHashConfirmado: string | null = null;
  if (datos.estrategia === "REEMPLAZO_ALCANCE") {
    const vista = await calcularVistaPreviaRetiro(cliente, sesion.empresaId, importId, importacion, datos);
    if (!vista.ok) return NextResponse.json({ ok: false, error: vista.error }, { status: 502 });
    if (!datos.confirmarRetiro) {
      return NextResponse.json({ ok: false, error: "DEBE_CONFIRMAR_RETIRO", candidatasRetiro: vista.candidatas, retiroHash: vista.hash }, { status: 400 });
    }
    if (datos.retiroHash !== vista.hash) {
      // Algo cambio desde la vista previa que el cliente mando (otra
      // importacion se proceso, una correccion manual, etc.) -- nunca se
      // confia en confirmarRetiro=true solo, hace falta una vista previa
      // nueva.
      return NextResponse.json({ ok: false, error: "RETIRO_DESACTUALIZADO", candidatasRetiro: vista.candidatas, retiroHash: vista.hash }, { status: 409 });
    }
    retiroHashConfirmado = vista.hash;
  }

  const boss = await obtenerBoss();

  // Persistir + confirmar + encolar, TODOS en una sola transaccion
  // atomica -- ver cabecera, punto 1. Si esto lanza (por cualquier
  // motivo, incluido un crash a mitad de camino), Postgres revierte TODO
  // y la importacion queda exactamente como estaba (PENDIENTE_REVISION);
  // un reintento normal (mismo POST) no encuentra nada que reconciliar.
  try {
    await tenantTransaction(sesion.empresaId, async (tx) => {
      await tx.importacionCsv.update({
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
          estado: "CONFIRMADA",
          confirmadaPorId: sesion.usuarioId,
          confirmadaEn: new Date(),
          retiroHashConfirmado,
        },
      });
      // fromPrisma(tx): adaptador OFICIAL de pg-boss (pg-boss/dist/adapters/prisma.ts)
      // -- el INSERT del job corre con tx.$queryRawUnsafe DENTRO de esta
      // misma transaccion/conexion, nunca en el pool propio de PgBoss.
      await encolarImportacionCsv(boss, { importId, empresaId: sesion.empresaId }, { db: fromPrisma(tx) });
    });
  } catch (err) {
    logError("api/kpis/cobertura/importaciones/[id]/confirmar", err);
    return NextResponse.json(
      { ok: false, error: "NO_SE_PUDO_CONFIRMAR", mensaje: "No se pudo guardar la confirmacion. Volvé a intentar." },
      { status: 502 },
    );
  }

  // Disparo inmediato -- caso feliz, procesa en el mismo ciclo en vez de
  // esperar al cron de respaldo (run/route.ts). Si esto falla, no es un
  // error para el usuario -- el job YA quedo encolado de forma durable
  // (misma transaccion de arriba), el cron lo toma en su proxima corrida.
  try {
    await procesarImportacionesCsv(boss, 1);
  } catch (err) {
    logError("api/kpis/cobertura/importaciones/[id]/confirmar (disparo inmediato)", err);
  }

  return NextResponse.json({ ok: true, importId });
}

/** Arma la forma comun de "datos de confirmacion" a partir de la fila
 * de ImportacionCsv ya persistida (para comparar en la idempotencia). */
function datosConfirmacionDesdeImportacion(
  importacion: {
    estrategia: string;
    alcanceFechaCorteInicio: Date | null;
    alcanceFechaCorteFin: Date | null;
    alcanceUbicaciones: unknown;
    fuenteConsumo: string | null;
    periodoReferenciaConsumoInicio: Date | null;
    periodoReferenciaConsumoFin: Date | null;
  },
  mapeoConfirmado: MapeoColumnasCobertura,
): DatosConfirmacionCobertura {
  return {
    mapeoColumnas: mapeoConfirmado,
    estrategia: importacion.estrategia as "CARGA_PARCIAL" | "REEMPLAZO_ALCANCE",
    alcanceFechaCorteInicio: importacion.alcanceFechaCorteInicio,
    alcanceFechaCorteFin: importacion.alcanceFechaCorteFin,
    alcanceUbicaciones: (importacion.alcanceUbicaciones as string[] | null) ?? null,
    // No pueden ser null aca: CONFIRMADA siempre se escribe junto con
    // fuenteConsumo/periodo (ver el bloque de la transaccion) -- el "!"
    // documenta esa invariante en vez de silenciarla con "?? valorFalso".
    fuenteConsumo: importacion.fuenteConsumo!,
    periodoReferenciaConsumoInicio: importacion.periodoReferenciaConsumoInicio!,
    periodoReferenciaConsumoFin: importacion.periodoReferenciaConsumoFin!,
  };
}

/** Arma la misma forma a partir del body ya validado por zod. */
function datosConfirmacionDesdeBody(datos: DatosConfirmar): DatosConfirmacionCobertura {
  return {
    mapeoColumnas: datos.mapeoColumnas,
    estrategia: datos.estrategia,
    alcanceFechaCorteInicio: datos.alcanceFechaCorteInicio ?? null,
    alcanceFechaCorteFin: datos.alcanceFechaCorteFin ?? null,
    alcanceUbicaciones: datos.alcanceUbicaciones ?? null,
    fuenteConsumo: datos.fuenteConsumo,
    periodoReferenciaConsumoInicio: datos.periodoReferenciaConsumoInicio,
    periodoReferenciaConsumoFin: datos.periodoReferenciaConsumoFin,
  };
}

/** Candidatas a retiro (REEMPLAZO_ALCANCE) + su hash -- SIEMPRE
 * recalculadas frescas contra la base y el archivo real en R2 al momento
 * de la llamada, nunca contra datos que mande el cliente. Usada tanto
 * por la vista previa como por la confirmacion real (que vuelve a
 * calcular el hash para compararlo contra el que mando el cliente -- ver
 * cabecera, punto 3). */
async function calcularVistaPreviaRetiro(
  cliente: ReturnType<typeof tenantClient>,
  empresaId: string,
  importId: string,
  importacion: {
    cadenaId: string;
    objetoStorageKey: string;
    cifradoClaveId: string | null;
    cifradoDek: string | null;
    cifradoDekIv: string | null;
    cifradoDekAuthTag: string | null;
  },
  datos: DatosConfirmar,
): Promise<{ ok: true; candidatas: CandidataRetiroParaHash[]; hash: string } | { ok: false; error: string }> {
  const clavesEnArchivo = await calcularClavesEnArchivo(empresaId, importId, importacion, datos.mapeoColumnas);
  if (!clavesEnArchivo.ok) return { ok: false, error: clavesEnArchivo.error };

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
  const candidatas = vigentesEnAlcance.filter(
    (fila: { sku: string; ubicacion: string; fechaCorte: Date }) =>
      !clavesEnArchivo.claves.has(claveNegocio(fila.sku, fila.ubicacion, fila.fechaCorte)),
  );
  const hash = calcularHashVistaPreviaRetiro(candidatas, {
    fechaCorteInicio: datos.alcanceFechaCorteInicio!,
    fechaCorteFin: datos.alcanceFechaCorteFin!,
    ubicaciones: datos.alcanceUbicaciones!,
  });
  return { ok: true, candidatas, hash };
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
