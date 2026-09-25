// Ruta API -- sube un CSV de Cobertura, lo cifra y sube a R2, y devuelve
// una previsualizacion (mapeo propuesto + muestra de filas + advertencias)
// SIN escribir ninguna ObservacionCobertura todavia (eso lo hace el job,
// disparado por la ruta de confirmar, ver [id]/confirmar/route.ts).
// Incremento 4 Bloque B, vertical slice de Cobertura.
//
// runtime="nodejs": ClienteAlmacenamientoR2 usa el SDK de AWS S3 (no
// corre en Edge, misma restriccion que Prisma/pg-boss -- ver r2.ts).
//
// Solo ADMINISTRADOR (requireAdmin(), no requireSession()) -- a
// diferencia de las rutas del mapa (RF27, RF36), esta ruta escribe datos
// de negocio sensibles (inventario, consumo) de forma masiva, mismo
// criterio de acceso que "Invitar responsable" en el dashboard.
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import Papa from "papaparse";
import { requireAdmin } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { prisma } from "@/infra/prisma/client";
import { logError } from "@/infra/log";
import { validarLimitesArchivoCsv } from "@/domain/limitesImportacionCsv";
import { proponerMapeoColumnas, detectarColumnasSospechosasDeConsumo } from "@/domain/mapeoColumnasCsv";
import { construirClaveObjetoCifrado } from "@/infra/storage/almacenamiento";
import { ClienteAlmacenamientoR2 } from "@/infra/storage/r2";
import { cifrarContenido, envolverDek, generarDek, obtenerClaveMaestraActiva, VERSION_FORMATO_ACTUAL } from "@/infra/storage/cifradoObjeto";
import type { MapeoColumnasPersistido } from "@/infra/kpis/cobertura/job";

export const runtime = "nodejs";

// Filas de muestra devueltas en la previsualizacion -- nunca el archivo
// completo (hasta MAX_FILAS=10.000, ver limitesImportacionCsv.ts), solo
// para que la UI muestre "asi se va a interpretar tu archivo" antes de
// confirmar.
const FILAS_DE_MUESTRA = 10;

export async function POST(request: Request) {
  const resultadoSesion = await requireAdmin();
  if ("respuesta" in resultadoSesion) return resultadoSesion.respuesta;
  const { sesion } = resultadoSesion;

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }
  const cadenaId = formData.get("cadenaId");
  const archivo = formData.get("archivo");
  if (typeof cadenaId !== "string" || !cadenaId || !(archivo instanceof File)) {
    return NextResponse.json({ ok: false, error: "DATOS_INVALIDOS" }, { status: 400 });
  }

  const cliente = tenantClient(sesion.empresaId);
  const cadena = await cliente.cadena.findUnique({ where: { id: cadenaId } });
  if (!cadena) {
    return NextResponse.json({ ok: false, error: "CADENA_INEXISTENTE" }, { status: 404 });
  }

  const definicionKpi = await prisma.definicionKpi.findFirst({
    where: { codigo: "COBERTURA", estado: "PUBLICADA" },
    orderBy: { numero: "desc" },
  });
  if (!definicionKpi) {
    // No deberia pasar (prisma/seedDefinicionesKpi.ts ya publica
    // COBERTURA) -- fallar con un mensaje claro en vez de un 500 opaco.
    logError("api/kpis/cobertura/importaciones", new Error("DefinicionKpi COBERTURA no encontrada o no publicada"));
    return NextResponse.json({ ok: false, error: "DEFINICION_KPI_NO_DISPONIBLE" }, { status: 500 });
  }

  const contenidoOriginal = Buffer.from(await archivo.arrayBuffer());

  const parseado = Papa.parse<Record<string, string>>(contenidoOriginal.toString("utf8"), {
    header: true,
    skipEmptyLines: true,
  });
  const encabezados = parseado.meta.fields ?? [];
  if (encabezados.length === 0 || parseado.data.length === 0) {
    return NextResponse.json({ ok: false, error: "ARCHIVO_VACIO_O_SIN_ENCABEZADOS" }, { status: 400 });
  }

  const limites = validarLimitesArchivoCsv({ tamanoBytes: contenidoOriginal.byteLength, numeroFilas: parseado.data.length });
  if (!limites.valido) {
    return NextResponse.json({ ok: false, error: limites.motivo, mensaje: limites.mensaje }, { status: 400 });
  }

  const propuesto = proponerMapeoColumnas(encabezados);
  const columnasSospechosasDeConsumo = detectarColumnasSospechosasDeConsumo(encabezados, propuesto);

  // Cifrar + subir. El id se genera ANTES de crear la fila (nunca lo
  // asigna Prisma) porque objetoStorageKey (no nullable) lo necesita para
  // construir la clave del objeto -- mismo criterio que
  // registrarEmpresaYAdmin() en src/infra/auth/registro.ts.
  const importId = randomUUID();
  const claveObjeto = construirClaveObjetoCifrado(sesion.empresaId, importId);
  const dek = generarDek();
  const contenidoCifrado = cifrarContenido(contenidoOriginal, dek, sesion.empresaId, importId);
  const claveMaestra = obtenerClaveMaestraActiva();
  const dekEnvuelta = envolverDek(dek, claveMaestra.clave, sesion.empresaId, importId);

  try {
    await new ClienteAlmacenamientoR2().subirObjeto(claveObjeto, contenidoCifrado);
  } catch (err) {
    logError("api/kpis/cobertura/importaciones", err);
    return NextResponse.json({ ok: false, error: "ERROR_ALMACENAMIENTO" }, { status: 502 });
  }

  const mapeoColumnas: MapeoColumnasPersistido = { encabezados, propuesto, confirmado: null };

  const importacion = await cliente.importacionCsv.create({
    data: {
      id: importId,
      empresaId: sesion.empresaId,
      cadenaId,
      definicionKpiId: definicionKpi.id,
      objetoStorageKey: claveObjeto,
      cifradoVersion: VERSION_FORMATO_ACTUAL,
      cifradoClaveId: claveMaestra.id,
      cifradoDek: dekEnvuelta.dekCifrada,
      cifradoDekIv: dekEnvuelta.iv,
      cifradoDekAuthTag: dekEnvuelta.authTag,
      mapeoColumnas,
      filasDetectadas: parseado.data.length,
      estado: "PENDIENTE_REVISION",
    },
  });

  return NextResponse.json({
    ok: true,
    importId: importacion.id,
    encabezados,
    mapeoPropuesto: propuesto,
    columnasSospechosasDeConsumo,
    filasDetectadas: parseado.data.length,
    muestra: parseado.data.slice(0, FILAS_DE_MUESTRA),
  });
}
