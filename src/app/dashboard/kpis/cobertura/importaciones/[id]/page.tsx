// Pagina (servidor) -- resultado de Cobertura POR SKU para UNA
// importacion confirmada. Incremento 4 PR1 (Alex, 2026-11-06): "Resultado
// visible de Cobertura por SKU para cada importación confirmada" +
// "Enlaces claros desde cada historial hacia su detalle" -- el enlace
// vive en kpis/cobertura/page.tsx (historial) y en
// ImportadorCoberturaWizard.tsx (paso "resultado"), ambos apuntando aca.
//
// Distinta de kpis/_compartido/DetalleObservacionKpi.tsx a proposito: la
// forma de los datos de Cobertura es otra (muchas filas por SKU/ubicacion/
// fecha de corte dentro de UNA importacion, nunca una sola observacion) --
// forzarla al mismo componente habria significado inventar una rama
// "si es Cobertura, en vez de una fila mostra una tabla" dentro de un
// componente que ya tiene su propio contrato -- mas duplicacion efectiva
// que dos archivos pequeños y honestos sobre lo que cada uno hace.
//
// Reutiliza exactamente lo mismo que ya usa kpis/cobertura/page.tsx --
// requireAdminOrRedirect() (mismo rol exigido que el importador y el
// historial) y tenantClient() (mismo aislamiento de tenant, capa 1 RNF1).
// Ningun mecanismo de autorizacion o de alcance de tenant nuevo.
import { notFound } from "next/navigation";
import Link from "next/link";
import type { EstadoObservacionCobertura } from "@prisma/client";
import { requireAdminOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import {
  clasificarFilaCobertura,
  motivoFilaCobertura,
  clasificarImportacion,
  resumirFilasCobertura,
  type EstadoVisualizacionFilaCobertura,
  type EstadoVisualizacionImportacion,
} from "@/infra/kpis/estadoVisualizacion";

// Tope de filas que se muestran en la tabla -- una importacion puede
// traer miles de filas y esta pagina no agrega paginacion todavia (fuera
// del alcance de PR1, que pide "resultado visible", no un visor general
// de CSV). El resumen de arriba (resumirFilasCobertura) SIEMPRE cuenta
// sobre el total real via groupBy/count, nunca sobre las filas mostradas
// -- nunca se "miente" el resumen por el tope de la tabla.
const LIMITE_FILAS_TABLA = 500;

const ETIQUETA_ESTADO_IMPORTACION: Record<EstadoVisualizacionImportacion, string> = {
  PENDIENTE_REVISION: "Pendiente de revisión",
  PROCESANDO: "Confirmada, procesando",
  PROCESADA: "Procesada",
  CON_ERRORES: "Con errores",
  DESCARTADA: "Descartada",
  INCONSISTENTE: "Estado inconsistente",
};

const ESTILO_BADGE_IMPORTACION: Record<EstadoVisualizacionImportacion, string> = {
  PENDIENTE_REVISION: "bg-slate-100 text-slate-600",
  PROCESANDO: "bg-amber-100 text-amber-700",
  PROCESADA: "bg-emerald-100 text-emerald-700",
  CON_ERRORES: "bg-red-100 text-red-700",
  DESCARTADA: "bg-slate-100 text-slate-500",
  INCONSISTENTE: "bg-red-100 text-red-700",
};

const ETIQUETA_ESTADO_FILA: Record<EstadoVisualizacionFilaCobertura, string> = {
  SIN_DATOS: "Sin datos",
  CERO_REAL: "0 días (real)",
  CON_ERRORES: "Con errores",
  VALOR: "Calculada",
};

const ESTILO_BADGE_FILA: Record<EstadoVisualizacionFilaCobertura, string> = {
  SIN_DATOS: "bg-slate-100 text-slate-600",
  CERO_REAL: "bg-amber-100 text-amber-700",
  CON_ERRORES: "bg-red-100 text-red-700",
  VALOR: "bg-emerald-100 text-emerald-700",
};

function formatearFechaHora(fecha: Date): string {
  return fecha.toLocaleString("es-PE", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatearFecha(fecha: Date): string {
  return fecha.toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit" });
}

function formatearCoberturaDias(dias: number | null): string {
  return dias === null ? "--" : `${dias.toFixed(1)} días`;
}

export default async function DetalleImportacionCoberturaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesion = await requireAdminOrRedirect();
  const client = tenantClient(sesion.empresaId);

  // findFirst (no findUnique) por el mismo motivo que
  // DetalleObservacionKpi.tsx: combina el id con el filtro de
  // definicionKpi.codigo en el mismo WHERE sin pelear con la restriccion
  // de Prisma sobre findUnique -- tenantClient() sigue agregando el
  // aislamiento de tenant (injectTenantFilter) exactamente igual.
  const importacion = await client.importacionCsv.findFirst({
    where: { id, definicionKpi: { codigo: "COBERTURA" } },
    select: {
      id: true,
      estado: true,
      confirmadaEn: true,
      procesadaEn: true,
      filasDetectadas: true,
      filasConError: true,
      erroresMuestra: true,
      cadena: { select: { nombre: true } },
      definicionKpi: { select: { nombre: true, formula: true, unidad: true } },
    },
  });

  if (!importacion) {
    notFound();
  }

  // Resumen SIEMPRE sobre el total real (groupBy + count), nunca sobre
  // las filas que trae la tabla de abajo (que tiene un tope, ver
  // LIMITE_FILAS_TABLA) -- ver tambien resumirFilasCobertura() en
  // estadoVisualizacion.ts para el porque de calcularaConCeroDias
  // separado del groupBy (distingue CERO_REAL de VALOR dentro del mismo
  // estado CALCULADA de la BD).
  const [porEstadoBruto, calculadaConCeroDias, rangoFechaCorte, filas, totalFilasPersistidas] = await Promise.all([
    client.observacionCobertura.groupBy({ by: ["estado"], where: { importId: id }, _count: { _all: true } }),
    client.observacionCobertura.count({ where: { importId: id, estado: "CALCULADA", coberturaDias: 0 } }),
    client.observacionCobertura.aggregate({ where: { importId: id }, _min: { fechaCorte: true }, _max: { fechaCorte: true } }),
    client.observacionCobertura.findMany({
      where: { importId: id },
      orderBy: [{ sku: "asc" }, { ubicacion: "asc" }, { fechaCorte: "asc" }],
      take: LIMITE_FILAS_TABLA,
      select: {
        id: true,
        skuOriginal: true,
        ubicacionOriginal: true,
        fechaCorte: true,
        inventarioDisponible: true,
        unidadInventario: true,
        consumoDiarioEsperado: true,
        unidadConsumoDiario: true,
        coberturaDias: true,
        estado: true,
        vigente: true,
        reemplazadaEn: true,
        numeroFila: true,
      },
    }),
    client.observacionCobertura.count({ where: { importId: id } }),
  ]);

  const porEstado: Partial<Record<EstadoObservacionCobertura, number>> = {};
  for (const grupo of porEstadoBruto as Array<{ estado: EstadoObservacionCobertura; _count: { _all: number } }>) {
    porEstado[grupo.estado] = grupo._count._all;
  }
  const resumen = resumirFilasCobertura(porEstado, calculadaConCeroDias);

  const estadoVisualImportacion = clasificarImportacion(importacion.estado, importacion.confirmadaEn, importacion.procesadaEn);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard/kpis/cobertura" className="text-sm text-slate-500 underline">
          ← Volver a {importacion.definicionKpi.nombre}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {importacion.definicionKpi.nombre} — {importacion.cadena.nombre}
        </h1>
        <p className="text-sm text-slate-600">
          {rangoFechaCorte._min.fechaCorte && rangoFechaCorte._max.fechaCorte
            ? rangoFechaCorte._min.fechaCorte.getTime() === rangoFechaCorte._max.fechaCorte.getTime()
              ? `Fecha de corte: ${formatearFecha(rangoFechaCorte._min.fechaCorte)}`
              : `Periodo: ${formatearFecha(rangoFechaCorte._min.fechaCorte)} – ${formatearFecha(rangoFechaCorte._max.fechaCorte)}`
            : "Todavía no hay filas con fecha de corte para esta importación."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 p-4">
        <span className={"rounded px-2 py-1 text-xs font-medium " + ESTILO_BADGE_IMPORTACION[estadoVisualImportacion]}>
          {ETIQUETA_ESTADO_IMPORTACION[estadoVisualImportacion]}
        </span>
        <p className="text-sm text-slate-600">
          Confirmada: {importacion.confirmadaEn ? formatearFechaHora(importacion.confirmadaEn) : "--"} · Procesada:{" "}
          {importacion.procesadaEn ? formatearFechaHora(importacion.procesadaEn) : "Todavía no"}
        </p>
      </div>

      <div className="rounded border border-slate-200 p-4">
        <p className="text-sm text-slate-500">Fórmula</p>
        <p className="text-sm">{importacion.definicionKpi.formula}</p>
        <p className="mt-1 text-xs text-slate-500">Unidad: {importacion.definicionKpi.unidad}</p>
      </div>

      {estadoVisualImportacion === "CON_ERRORES" && importacion.estado === "ERROR" && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">La importación terminó en error -- no hay filas de resultado para mostrar.</p>
          {Array.isArray(importacion.erroresMuestra) && importacion.erroresMuestra.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {(importacion.erroresMuestra as Array<{ numeroFila?: number; error?: string }>).slice(0, 5).map((error, indice) => (
                <li key={indice}>
                  {error.numeroFila ? `Fila ${error.numeroFila}: ` : ""}
                  {error.error ?? "Error sin detalle"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {estadoVisualImportacion === "PENDIENTE_REVISION" && (
        <p className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Esta importación todavía no fue confirmada -- no hay ningún resultado que mostrar hasta que se confirme.
        </p>
      )}

      {estadoVisualImportacion === "PROCESANDO" && (
        <p className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          El cálculo de esta importación corre en segundo plano y todavía no terminó -- volvé a esta página en unos
          segundos para ver el resultado.
        </p>
      )}

      {estadoVisualImportacion === "DESCARTADA" && (
        <p className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          Esta importación fue descartada -- no tiene ningún resultado que mostrar.
        </p>
      )}

      {estadoVisualImportacion === "INCONSISTENTE" && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">
            Esta importación quedó en un estado inconsistente (confirmada sin fecha de confirmación) -- esto no
            debería ocurrir nunca.
          </p>
          <p className="mt-1">
            No se muestra ningún resultado hasta que se revise manualmente -- nunca se trata como una importación
            procesada, aunque parezca tener filas calculadas.
          </p>
        </div>
      )}

      {(estadoVisualImportacion === "PROCESADA" || (estadoVisualImportacion === "CON_ERRORES" && importacion.estado !== "ERROR")) && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Filas válidas</p>
              <p className="text-lg font-semibold text-emerald-700">{resumen.valor + resumen.ceroReal}</p>
              <p className="text-xs text-slate-400">({resumen.ceroReal} en 0 días reales)</p>
            </div>
            <div className="rounded border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Sin datos</p>
              <p className="text-lg font-semibold text-slate-600">{resumen.sinDatos}</p>
            </div>
            <div className="rounded border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Con errores</p>
              <p className="text-lg font-semibold text-red-700">{resumen.conErrores}</p>
            </div>
            <div className="rounded border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Total de filas</p>
              <p className="text-lg font-semibold">{resumen.total}</p>
            </div>
          </div>

          {importacion.filasDetectadas > totalFilasPersistidas && (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              El archivo traía {importacion.filasDetectadas} filas y aquí se persistieron {totalFilasPersistidas}. La
              diferencia corresponde a filas con error de formato al leer el archivo ({importacion.filasConError}) y/o a
              duplicados en conflicto dentro del mismo archivo, que el motor excluye antes de guardar nada (nunca se
              fusionan ni se guarda una copia en silencio).
            </p>
          )}

          {totalFilasPersistidas === 0 ? (
            <p className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Esta importación se procesó pero no generó ninguna fila de resultado.
            </p>
          ) : (
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Ubicación</th>
                    <th className="px-3 py-2">Fecha de corte</th>
                    <th className="px-3 py-2">Inventario disponible</th>
                    <th className="px-3 py-2">Consumo diario esperado</th>
                    <th className="px-3 py-2">Cobertura</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Vigencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any sin `prisma generate` con red real (ver tenantClient.ts); mismo patron ya usado en cobertura/page.tsx */}
                  {filas.map((fila: any) => {
                    const estadoVisualFila = clasificarFilaCobertura(fila.estado, fila.coberturaDias);
                    const motivo = motivoFilaCobertura(fila.estado);
                    return (
                      <tr key={fila.id}>
                        <td className="px-3 py-2 font-medium">{fila.skuOriginal}</td>
                        <td className="px-3 py-2">{fila.ubicacionOriginal}</td>
                        <td className="px-3 py-2">{formatearFecha(fila.fechaCorte)}</td>
                        <td className="px-3 py-2">
                          {fila.inventarioDisponible === null ? "--" : `${fila.inventarioDisponible} ${fila.unidadInventario}`}
                        </td>
                        <td className="px-3 py-2">
                          {fila.consumoDiarioEsperado === null
                            ? "--"
                            : `${fila.consumoDiarioEsperado} ${fila.unidadConsumoDiario}`}
                        </td>
                        <td className="px-3 py-2">{formatearCoberturaDias(fila.coberturaDias)}</td>
                        <td className="px-3 py-2">
                          <span className={"rounded px-2 py-0.5 text-xs font-medium " + ESTILO_BADGE_FILA[estadoVisualFila]}>
                            {ETIQUETA_ESTADO_FILA[estadoVisualFila]}
                          </span>
                          {motivo && <p className="mt-1 text-xs text-slate-500">{motivo}</p>}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {fila.vigente
                            ? "Vigente"
                            : `Reemplazada${fila.reemplazadaEn ? ` el ${formatearFecha(fila.reemplazadaEn)}` : ""}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {totalFilasPersistidas > LIMITE_FILAS_TABLA && (
                <p className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Mostrando las primeras {LIMITE_FILAS_TABLA} filas de {totalFilasPersistidas} (orden por SKU). El resumen
                  de arriba sí cuenta sobre el total real.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
