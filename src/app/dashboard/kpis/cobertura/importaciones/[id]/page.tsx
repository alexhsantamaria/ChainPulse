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
//
// Incremento 4 PR2 (Alex, 2026-11-09): agrega la seccion "Analisis y
// decision" -- tendencia, comparacion contra la importacion anterior,
// causas observables y una recomendacion priorizada (ver src/infra/kpis/
// analisisDecision.ts). Solo se intenta cuando `resultado` (el de ARRIBA)
// ya se cargo con exito -- si la consulta principal fallo, no tiene
// sentido gastar una consulta historica adicional para un analisis que
// de todos modos no se va a poder anclar a nada (mismo criterio de
// "evitar consultas innecesarias" de PR1). Es su PROPIO try/catch,
// separado del de `resultado`: un fallo del historico nunca oculta el
// resultado principal, que ya quedo resuelto.
//
// RONDA 2 (Alex, 2026-11-09): 4 correcciones sobre lo de arriba --
// (1) el historico se limita a `confirmadaEn` ESTRICTAMENTE anterior al
// de la importacion actual (nunca importaciones posteriores); (2) la
// direccion/prioridad de la comparacion se decide por TASAS sobre el
// total de filas, nunca por conteos absolutos solos (ver
// src/infra/kpis/analisisDecision.ts); (3) se deriva ruleVersion por
// importacion extendiendo los `by` de los groupBy YA existentes (sin
// consultas nuevas) y se excluye cualquier comparacion entre versiones
// distintas; (4) "Tendencia"/"Causas observables" se renombran a
// "Evolucion reciente"/"Descomposicion del cambio", y el texto sobre la
// migracion de esquema se sustituye por un mensaje generico de roadmap.
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdminOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { diagnosticoLecturaSeguro } from "@/infra/prisma/errores";
import AccionesDecisionKpi from "@/app/dashboard/kpis/_compartido/AccionesDecisionKpi";
import {
  clasificarFilaCobertura,
  motivoFilaCobertura,
  clasificarImportacion,
  type EstadoVisualizacionFilaCobertura,
  type EstadoVisualizacionImportacion,
  type ResumenFilasCobertura,
} from "@/infra/kpis/estadoVisualizacion";
import {
  generarAnalisisImportacionCobertura,
  type PuntoResumenCobertura,
  type MotivoInformacionInsuficiente,
  type EstadoVersionCobertura,
} from "@/infra/kpis/analisisDecision";
import { cargarResumenYVersionCobertura, cargarHistoricoResumenCobertura } from "@/infra/kpis/cobertura/resumenCobertura";

// Tope de filas que se muestran en la tabla -- una importacion puede
// traer miles de filas y esta pagina no agrega paginacion todavia (fuera
// del alcance de PR1, que pide "resultado visible", no un visor general
// de CSV). El resumen de arriba (resumirFilasCobertura) SIEMPRE cuenta
// sobre el total real via groupBy/count, nunca sobre las filas mostradas
// -- nunca se "miente" el resumen por el tope de la tabla.
const LIMITE_FILAS_TABLA = 500;

// LIMITE_HISTORICO_COBERTURA vive ahora en src/infra/kpis/cobertura/resumenCobertura.ts
// (correccion de ronda de revision, bloqueante 1) -- reutilizado tal cual.

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

const ETIQUETA_DIRECCION: Record<string, string> = { MEJORA: "Mejora", EMPEORA: "Empeora", ESTABLE: "Estable" };
const ESTILO_DIRECCION: Record<string, string> = {
  MEJORA: "bg-emerald-100 text-emerald-700",
  EMPEORA: "bg-red-100 text-red-700",
  ESTABLE: "bg-slate-100 text-slate-600",
};
const ETIQUETA_PRIORIDAD: Record<string, string> = { ALTA: "Prioridad alta", MEDIA: "Prioridad media", BAJA: "Prioridad baja" };
const ESTILO_PRIORIDAD: Record<string, string> = {
  ALTA: "bg-red-100 text-red-700",
  MEDIA: "bg-amber-100 text-amber-700",
  BAJA: "bg-slate-100 text-slate-600",
};

// RONDA 3 (Alex, 2026-11-09, punto 2): mensaje de "informacion insuficiente"
// especifico por motivo, no un unico texto generico. SIN_HISTORICO no tiene
// entrada propia a proposito -- el texto por defecto de cada seccion (mas
// abajo) ya describe ese caso con suficiente precision ("todavia no hay
// suficientes importaciones procesadas...", "no hay una importacion procesada
// anterior..."). RULE_VERSION_INCOMPATIBLE es el MISMO motivo para evolucion y
// comparacion (ver el comentario equivalente en DetalleObservacionKpi.tsx).
// VERSION_MEZCLADA y TOTAL_CERO son exclusivos de Cobertura (ver
// generarAnalisisImportacionCobertura() en analisisDecision.ts).
const MENSAJE_INSUFICIENTE_POR_MOTIVO: Partial<Record<NonNullable<MotivoInformacionInsuficiente>, string>> = {
  RULE_VERSION_INCOMPATIBLE:
    "Información insuficiente: los períodos anteriores usan otra versión de cálculo y no son comparables.",
  VERSION_MEZCLADA:
    "Información insuficiente: esta importación mezcla más de una versión de cálculo y no se puede comparar hasta que se resuelva.",
  TOTAL_CERO:
    "Información insuficiente: esta importación (o la anterior comparable) no tiene ninguna fila -- no hay una tasa que calcular.",
};
const MENSAJE_EVOLUCION_COBERTURA_POR_DEFECTO =
  "Información insuficiente: todavía no hay suficientes importaciones procesadas (de la misma versión de regla) para mostrar una evolución reciente.";
const MENSAJE_COMPARACION_COBERTURA_POR_DEFECTO =
  "Información insuficiente: no hay una importación procesada anterior (con filas, de la misma versión de regla) de esta cadena para comparar.";

function mensajeInsuficienteCobertura(motivo: MotivoInformacionInsuficiente, porDefecto: string): string {
  return (motivo && MENSAJE_INSUFICIENTE_POR_MOTIVO[motivo]) ?? porDefecto;
}

function formatearFechaHora(fecha: Date): string {
  return fecha.toLocaleString("es-PE", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatearFecha(fecha: Date): string {
  return fecha.toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit" });
}

function formatearCoberturaDias(dias: number | null): string {
  return dias === null ? "--" : `${dias.toFixed(1)} días`;
}

function formatearPeriodoReferencia(periodo: { inicio: Date | null; fin: Date | null }): string {
  if (!periodo.inicio || !periodo.fin) return "Sin período de referencia declarado";
  return periodo.inicio.getTime() === periodo.fin.getTime()
    ? formatearFecha(periodo.inicio)
    : `${formatearFecha(periodo.inicio)} – ${formatearFecha(periodo.fin)}`;
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
  // RONDA 4, punto 1: estado explicito (ver EstadoVersionCobertura en
  // analisisDecision.ts) -- derivado del MISMO groupBy de abajo (RONDA
  // 2, punto 4, extendido con "ruleVersion"), SIN consulta nueva.
  estadoVersion: EstadoVersionCobertura;
  // Version de regla derivada del groupBy de abajo. Solo no-null cuando
  // estadoVersion === "UNICA".
  ruleVersion: string | null;
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
// Correccion de ronda de revision (bloqueante 1): el groupBy+count de
// abajo (resumen/estadoVersion/ruleVersion) ahora vive en
// cargarResumenYVersionCobertura() (src/infra/kpis/cobertura/
// resumenCobertura.ts), reutilizado tal cual por derivarOrigenActual.ts
// para derivar lo mismo en el servidor al crear una AccionDecisionKpi
// nueva -- esta funcion solo agrega, en el MISMO Promise.all, las 2
// consultas que son exclusivas de la pagina (rangoFechaCorte para
// mostrar el rango de fechas de corte, `filas` para la tabla) -- ninguna
// de las 2 hace falta para derivar una prioridad, asi que
// derivarOrigenActual.ts nunca las pide.
async function cargarResultadoImportacionCobertura(
  client: ReturnType<typeof tenantClient>,
  importId: string,
): Promise<ResultadoImportacionCobertura> {
  const [{ resumen, estadoVersion, ruleVersion, totalFilasPersistidas }, rangoFechaCorte, filas] = await Promise.all([
    cargarResumenYVersionCobertura(client, importId),
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

  return {
    resumen,
    totalFilasPersistidas,
    rangoFechaCorte: { min: rangoFechaCorte._min.fechaCorte, max: rangoFechaCorte._max.fechaCorte },
    estadoVersion,
    ruleVersion,
    filas,
  };
}

// cargarHistoricoResumenCobertura() vive ahora en
// src/infra/kpis/cobertura/resumenCobertura.ts (correccion de ronda de
// revision, bloqueante 1) -- relocacion exacta, sin cambios de
// comportamiento; reutilizada tal cual por derivarOrigenActual.ts.

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
      cadenaId: true,
      estado: true,
      confirmadaEn: true,
      procesadaEn: true,
      filasDetectadas: true,
      filasConError: true,
      erroresMuestra: true,
      periodoReferenciaConsumoInicio: true,
      periodoReferenciaConsumoFin: true,
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
  let historicoCobertura: PuntoResumenCobertura[] = [];
  let errorLecturaHistoricoCobertura = false;

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

    // Solo si el resultado principal SI se cargo -- sin el, no hay nada
    // a que anclar el analisis, y pedir el historico igual seria una
    // consulta desperdiciada (ver comentario de cabecera).
    if (resultado) {
      try {
        historicoCobertura = await cargarHistoricoResumenCobertura(client, importacion.cadenaId, id, importacion.confirmadaEn);
      } catch (error) {
        const diagnostico = diagnosticoLecturaSeguro(error);
        console.error("COBERTURA_HISTORICO_LECTURA_FALLIDA", {
          importId: id,
          nombreClase: diagnostico.nombreClase,
          codigo: diagnostico.codigo,
        });
        errorLecturaHistoricoCobertura = true;
      }
    }
  }

  const analisisCobertura =
    resultado && !errorLecturaHistoricoCobertura
      ? generarAnalisisImportacionCobertura(
          {
            importId: id,
            periodoReferencia: { inicio: importacion.periodoReferenciaConsumoInicio, fin: importacion.periodoReferenciaConsumoFin },
            resumen: resultado.resumen,
            estadoVersion: resultado.estadoVersion,
            ruleVersion: resultado.ruleVersion,
          },
          historicoCobertura,
        )
      : null;

  // Incremento 4 PR3 -- candidatos a responsable/creador/finalizador para
  // el formulario de AccionesDecisionKpi.tsx, mismo criterio que
  // DetalleObservacionKpi.tsx (propio try/catch, nunca tira abajo el
  // resto de la pagina si falla).
  let usuariosEmpresa: { id: string; nombre: string; email: string }[] = [];
  try {
    usuariosEmpresa = await client.usuario.findMany({
      select: { id: true, nombre: true, email: true },
      orderBy: { nombre: "asc" },
    });
  } catch (error) {
    const diagnostico = diagnosticoLecturaSeguro(error);
    console.error("COBERTURA_USUARIOS_LECTURA_FALLIDA", {
      importId: id,
      nombreClase: diagnostico.nombreClase,
      codigo: diagnostico.codigo,
    });
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

          <div className="rounded border border-slate-200 p-4">
            <h2 className="mb-3 font-medium">Análisis y decisión</h2>

            {errorLecturaHistoricoCobertura ? (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-medium">No se pudo cargar el análisis histórico. Intenta nuevamente.</p>
                <a
                  href={`/dashboard/kpis/cobertura/importaciones/${id}`}
                  className="mt-2 inline-block rounded border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 underline"
                >
                  Reintentar
                </a>
              </div>
            ) : (
              analisisCobertura && (
                <div className="flex flex-col gap-4 text-sm">
                  <p className="text-xs text-slate-500">{analisisCobertura.notaMetodologica}</p>

                  <div>
                    <p className="text-slate-500">
                      Evolución reciente ({analisisCobertura.tendencia.length} importación
                      {analisisCobertura.tendencia.length === 1 ? "" : "es"})
                    </p>
                    {analisisCobertura.tendenciaInformacionInsuficiente ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {mensajeInsuficienteCobertura(
                          analisisCobertura.motivoInformacionInsuficiente,
                          MENSAJE_EVOLUCION_COBERTURA_POR_DEFECTO,
                        )}
                      </p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-0.5 text-xs text-slate-600">
                        {analisisCobertura.tendencia.map((punto) => (
                          <li key={punto.importId}>
                            {formatearPeriodoReferencia(punto.periodoReferencia)}: {punto.resumen.valor + punto.resumen.ceroReal} válidas ·{" "}
                            {punto.resumen.sinDatos} sin datos · {punto.resumen.conErrores} con errores
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="text-slate-500">Comparación contra la importación anterior</p>
                    {analisisCobertura.comparacionInformacionInsuficiente ||
                    analisisCobertura.variacionTasaConErrores === null ||
                    analisisCobertura.variacionTasaValidas === null ||
                    analisisCobertura.variacionTasaSinDatos === null ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {mensajeInsuficienteCobertura(
                          analisisCobertura.motivoInformacionInsuficiente,
                          MENSAJE_COMPARACION_COBERTURA_POR_DEFECTO,
                        )}
                      </p>
                    ) : (
                      <div className="mt-1 flex flex-col gap-1">
                        {/* RONDA 2 (punto 2): la direccion se decide por la TASA (sobre el total de filas),
                            nunca por el conteo absoluto solo -- el conteo se muestra ABAJO, como contexto. */}
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              "rounded px-2 py-0.5 text-xs font-medium " +
                              ESTILO_DIRECCION[analisisCobertura.variacionTasaConErrores.direccion]
                            }
                          >
                            Tasa con errores: {ETIQUETA_DIRECCION[analisisCobertura.variacionTasaConErrores.direccion]}
                          </span>
                          <span className="text-xs text-slate-600">
                            {analisisCobertura.variacionTasaConErrores.deltaAbsoluto >= 0 ? "+" : ""}
                            {(analisisCobertura.variacionTasaConErrores.deltaAbsoluto * 100).toFixed(1)} puntos
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              "rounded px-2 py-0.5 text-xs font-medium " +
                              ESTILO_DIRECCION[analisisCobertura.variacionTasaValidas.direccion]
                            }
                          >
                            Tasa de filas válidas: {ETIQUETA_DIRECCION[analisisCobertura.variacionTasaValidas.direccion]}
                          </span>
                          <span className="text-xs text-slate-600">
                            {analisisCobertura.variacionTasaValidas.deltaAbsoluto >= 0 ? "+" : ""}
                            {(analisisCobertura.variacionTasaValidas.deltaAbsoluto * 100).toFixed(1)} puntos
                          </span>
                        </div>
                        {/* RONDA 3 (punto 1): misma logica de direccion por TASA -- si la tasa de
                            filas sin datos no cambio, ESTABLE, aunque el conteo absoluto si cambie
                            (por ejemplo 1/10 vs 10/100, ambas 10%: nunca se presenta como deterioro). */}
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              "rounded px-2 py-0.5 text-xs font-medium " +
                              ESTILO_DIRECCION[analisisCobertura.variacionTasaSinDatos.direccion]
                            }
                          >
                            Tasa de filas sin datos: {ETIQUETA_DIRECCION[analisisCobertura.variacionTasaSinDatos.direccion]}
                          </span>
                          <span className="text-xs text-slate-600">
                            {analisisCobertura.variacionTasaSinDatos.deltaAbsoluto >= 0 ? "+" : ""}
                            {(analisisCobertura.variacionTasaSinDatos.deltaAbsoluto * 100).toFixed(1)} puntos
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          Conteos actuales (contexto, no decide la dirección): {resultado.resumen.conErrores} con errores ·{" "}
                          {resultado.resumen.valor + resultado.resumen.ceroReal} válidas · {resultado.resumen.sinDatos} sin
                          datos sobre {resultado.resumen.total} filas en total.
                        </p>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-slate-500">Descomposición del cambio</p>
                    {analisisCobertura.causasObservables.length === 0 ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Información insuficiente: no hay una importación anterior comparable con la que calcular los
                        cambios.
                      </p>
                    ) : (
                      <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                        {analisisCobertura.causasObservables.map((causa, indice) => (
                          <li key={indice}>{causa}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="text-slate-500">Recomendación</p>
                    {analisisCobertura.recomendacion === null ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Información insuficiente: no hay una comparación posible contra la importación anterior.
                      </p>
                    ) : (
                      <div className="mt-1 flex flex-col gap-1">
                        <span
                          className={
                            "self-start rounded px-2 py-0.5 text-xs font-medium " +
                            ESTILO_PRIORIDAD[analisisCobertura.recomendacion.prioridad]
                          }
                        >
                          {ETIQUETA_PRIORIDAD[analisisCobertura.recomendacion.prioridad]}
                        </span>
                        <span className="text-xs text-slate-600">{analisisCobertura.recomendacion.texto}</span>
                      </div>
                    )}
                  </div>

                  {/* Correccion de ronda de revision (bloqueante 4): el
                      historial siempre se muestra -- solo el formulario
                      de alta se condiciona a una recomendacion actual de
                      prioridad ALTA/MEDIA. Ver el comentario equivalente
                      en DetalleObservacionKpi.tsx. resultado.ruleVersion
                      no nulo esta garantizado en la practica cuando SI
                      hay recomendacion (solo UNICA produce una
                      comparacion posible), pero se valida explicitamente
                      en vez de forzar el tipo con "!" -- defensivo, sin
                      costo real. */}
                  <AccionesDecisionKpi
                    origen={{ tipo: "IMPORTACION_CSV", importacionCsvId: importacion.id }}
                    recomendacionActual={
                      analisisCobertura.siguienteAccionPropuesta && analisisCobertura.recomendacion && resultado.ruleVersion
                        ? {
                            prioridad: analisisCobertura.recomendacion.prioridad,
                            ruleVersion: resultado.ruleVersion,
                            descripcionSugerida: analisisCobertura.siguienteAccionPropuesta,
                          }
                        : null
                    }
                    usuarios={usuariosEmpresa}
                  />
                </div>
              )
            )}
          </div>

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
