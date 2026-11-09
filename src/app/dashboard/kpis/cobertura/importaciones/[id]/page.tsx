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
//
// Correccion (Alex, validacion manual Windows 2026-11-06): la version
// anterior disparaba las 5 consultas de resultado (groupBy/count x2/
// aggregate/findMany) para CUALQUIER estado, sin mirar antes
// clasificarImportacion(). En la validacion real, una importacion en
// estado ERROR disparo esas mismas consultas igual -- y un timeout
// transitorio del driver (DriverAdapterError: Authentication timed out,
// ajeno al estado real de la importacion) tiro abajo toda la pagina en
// vez de mostrar el mensaje de error que ya se podia armar solo con los
// metadatos de `importacion` (sin ninguna consulta a ObservacionCobertura).
// Ahora: 1) se clasifica el estado PRIMERO, con los metadatos ya
// obtenidos; 2) para cualquier estado que no sea PROCESADA no se ejecuta
// NINGUNA consulta de resultado -- nunca hubo (ni puede haber) filas
// definitivas que mostrar; 3) solo para PROCESADA se consulta, y esa
// consulta esta en su propio try/catch -- un fallo de LECTURA (conexion,
// timeout, lo que sea) nunca se confunde con el ESTADO funcional de la
// importacion (que ya quedo fijado en el paso 1, sin depender de esta
// consulta) ni se muestra con su detalle interno: se recupera con un
// mensaje generico y un reintento.
import { notFound } from "next/navigation";
import Link from "next/link";
import type { EstadoObservacionCobertura } from "@prisma/client";
import { requireAdminOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { diagnosticoLecturaSeguro } from "@/infra/prisma/errores";
import {
  clasificarFilaCobertura,
  motivoFilaCobertura,
  clasificarImportacion,
  resumirFilasCobertura,
  type EstadoVisualizacionFilaCobertura,
  type EstadoVisualizacionImportacion,
  type ResumenFilasCobertura,
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

// Forma del resultado de UNA importacion ya PROCESADA -- separado del
// cuerpo del componente para poder envolver su obtencion en su propio
// try/catch (ver comentario de cabecera). `filas` queda tipado `any[]`
// a proposito, igual que el resto de este archivo (ver el
// eslint-disable mas abajo): el cliente Prisma de este entorno esta
// tipado como `any` sin `prisma generate` contra una base real.
interface ResultadoImportacionCobertura {
  resumen: ResumenFilasCobertura;
  totalFilasPersistidas: number;
  rangoFechaCorte: { min: Date | null; max: Date | null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver comentario de arriba
  filas: any[];
}

// Antes: 5 consultas concurrentes (groupBy, count con filtro, aggregate,
// findMany, count SIN filtro para el total). Correccion de Alex
// (2026-11-06): el total real ya sale de sumar los grupos que devuelve
// el PRIMER groupBy -- pedirlo de nuevo con un count() aparte era una
// quinta consulta redundante (nunca puede dar un numero distinto, ambas
// cuentan las mismas filas de la misma tabla con el mismo `where`).
// Quedan 4 consultas concurrentes, no 5.
async function cargarResultadoImportacionCobertura(
  client: ReturnType<typeof tenantClient>,
  importId: string,
): Promise<ResultadoImportacionCobertura> {
  const [porEstadoBruto, calculadaConCeroDias, rangoFechaCorte, filas] = await Promise.all([
    client.observacionCobertura.groupBy({ by: ["estado"], where: { importId }, _count: { _all: true } }),
    client.observacionCobertura.count({ where: { importId, estado: "CALCULADA", coberturaDias: 0 } }),
    client.observacionCobertura.aggregate({ where: { importId }, _min: { fechaCorte: true }, _max: { fechaCorte: true } }),
    client.observacionCobertura.findMany({
      where: { importId },
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
  ]);

  const porEstado: Partial<Record<EstadoObservacionCobertura, number>> = {};
  let totalFilasPersistidas = 0;
  for (const grupo of porEstadoBruto as Array<{ estado: EstadoObservacionCobertura; _count: { _all: number } }>) {
    porEstado[grupo.estado] = grupo._count._all;
    totalFilasPersistidas += grupo._count._all;
  }

  return {
    resumen: resumirFilasCobertura(porEstado, calculadaConCeroDias),
    totalFilasPersistidas,
    rangoFechaCorte: { min: rangoFechaCorte._min.fechaCorte, max: rangoFechaCorte._max.fechaCorte },
    filas,
  };
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

  // El ESTADO visual se fija aca, con los metadatos que ya se tienen --
  // nunca depende de si la consulta de resultado (de abajo) sale bien o
  // mal. Es la unica puerta que decide si tiene sentido pedir algo a
  // ObservacionCobertura: para cualquier estado que no sea PROCESADA no
  // existen (ni pueden existir) filas de resultado definitivas que
  // consultar.
  const estadoVisualImportacion = clasificarImportacion(importacion.estado, importacion.confirmadaEn, importacion.procesadaEn);

  let resultado: ResultadoImportacionCobertura | null = null;
  let errorLecturaResultado = false;

  if (estadoVisualImportacion === "PROCESADA") {
    try {
      resultado = await cargarResultadoImportacionCobertura(client, id);
    } catch (error) {
      // Correccion de Alex (2026-11-06 / 2026-11-07, antes del staging):
      // NUNCA se registra el objeto `error` completo ni su message/
      // stack/query/params/detail/hint/causa sin filtrar -- ni siquiera
      // en el log del servidor. Solo una estructura por ALLOWLIST, tanto
      // en que CAMPOS se loguean como en que VALORES puede tomar cada
      // uno (ver diagnosticoLecturaSeguro() en src/infra/prisma/
      // errores.ts, que ya se reutiliza en otros dominios -- no es un
      // helper nuevo por dominio): evento fijo, el importId (ya conocido,
      // no sensible), el nombre de clase del error (solo si coincide
      // EXACTO con una lista cerrada de nombres conocidos -- si no,
      // "ERROR_DESCONOCIDO") y su codigo (solo si tiene el FORMATO de un
      // codigo de Prisma o un SQLSTATE -- si no, null). Nada de esto
      // puede contener una contraseña, una cadena de conexion ni el
      // texto de una consulta, por diseno -- ningun valor de entrada se
      // interpola tal cual, solo constantes de ese archivo o `null`.
      const diagnostico = diagnosticoLecturaSeguro(error);
      console.error("COBERTURA_RESULTADO_LECTURA_FALLIDA", {
        importId: id,
        nombreClase: diagnostico.nombreClase,
        codigo: diagnostico.codigo,
      });
      errorLecturaResultado = true;
    }
  }

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
          {resultado?.rangoFechaCorte.min && resultado?.rangoFechaCorte.max
            ? resultado.rangoFechaCorte.min.getTime() === resultado.rangoFechaCorte.max.getTime()
              ? `Fecha de corte: ${formatearFecha(resultado.rangoFechaCorte.min)}`
              : `Periodo: ${formatearFecha(resultado.rangoFechaCorte.min)} – ${formatearFecha(resultado.rangoFechaCorte.max)}`
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

      {estadoVisualImportacion === "CON_ERRORES" && (
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

      {estadoVisualImportacion === "PROCESADA" && errorLecturaResultado && (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">No se pudo cargar el resultado. Intenta nuevamente.</p>
          <a
            href={`/dashboard/kpis/cobertura/importaciones/${id}`}
            className="mt-2 inline-block rounded border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 underline"
          >
            Reintentar
          </a>
        </div>
      )}

      {estadoVisualImportacion === "PROCESADA" && resultado && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Filas válidas</p>
              <p className="text-lg font-semibold text-emerald-700">{resultado.resumen.valor + resultado.resumen.ceroReal}</p>
              <p className="text-xs text-slate-400">({resultado.resumen.ceroReal} en 0 días reales)</p>
            </div>
            <div className="rounded border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Sin datos</p>
              <p className="text-lg font-semibold text-slate-600">{resultado.resumen.sinDatos}</p>
            </div>
            <div className="rounded border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Con errores</p>
              <p className="text-lg font-semibold text-red-700">{resultado.resumen.conErrores}</p>
            </div>
            <div className="rounded border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Total de filas</p>
              <p className="text-lg font-semibold">{resultado.resumen.total}</p>
            </div>
          </div>

          {importacion.filasDetectadas > resultado.totalFilasPersistidas && (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              El archivo traía {importacion.filasDetectadas} filas y aquí se persistieron {resultado.totalFilasPersistidas}. La
              diferencia corresponde a filas con error de formato al leer el archivo ({importacion.filasConError}) y/o a
              duplicados en conflicto dentro del mismo archivo, que el motor excluye antes de guardar nada (nunca se
              fusionan ni se guarda una copia en silencio).
            </p>
          )}

          {resultado.totalFilasPersistidas === 0 ? (
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
                  {resultado.filas.map((fila: any) => {
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
              {resultado.totalFilasPersistidas > LIMITE_FILAS_TABLA && (
                <p className="border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Mostrando las primeras {LIMITE_FILAS_TABLA} filas de {resultado.totalFilasPersistidas} (orden por SKU). El resumen
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
