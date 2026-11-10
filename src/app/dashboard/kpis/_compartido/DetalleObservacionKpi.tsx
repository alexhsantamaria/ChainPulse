// Componente (servidor) -- detalle duradero de UNA ObservacionKpi ya
// persistida. Incremento 4 PR1 (Alex, 2026-11-06): compartido por OTIF y
// Fill Rate (los unicos 2 codigos habilitados, ver esCodigoConDetalleHabilitado()
// en src/infra/kpis/estadoVisualizacion.ts) para no duplicar la consulta
// ni el render entre kpis/otif/observaciones/[id]/page.tsx y
// kpis/fill-rate/observaciones/[id]/page.tsx -- cada uno es un wrapper de
// unas pocas lineas que solo fija `codigo`.
//
// Carpeta con guion bajo (mismo patron ya usado en este repo por
// src/app/plataforma/_mfa): Next.js App Router no la trata como un
// segmento de ruta, asi que este archivo nunca queda expuesto como
// pagina propia.
//
// Reutiliza exactamente lo mismo que ya usan kpis/otif/page.tsx y
// kpis/fill-rate/page.tsx -- requireAdminOrRedirect() (mismo rol exigido
// que el historial del que viene el enlace) y tenantClient() (mismo
// aislamiento de tenant, capa 1 RNF1) -- no se agrega ningun mecanismo de
// autorizacion o de alcance de tenant nuevo.
//
// Incremento 4 PR2 (Alex, 2026-11-09): agrega la seccion "Analisis y
// decision" -- tendencia, comparacion contra el periodo anterior, causas
// observables y una recomendacion priorizada (ver src/infra/kpis/
// analisisDecision.ts para el motor puro y el porque de cada decision de
// diseno). La consulta nueva (historico de periodos anteriores de la
// MISMA cadena+definicionKpi) va en su propio try/catch -- mismo
// criterio de "un fallo de LECTURA nunca tira abajo toda la pagina" ya
// aplicado en PR1 a cobertura/importaciones/[id]/page.tsx: el detalle
// principal (formula/valor/numerador/denominador) ya quedo resuelto
// arriba y sigue mostrandose aunque el historico falle.
//
// RONDA 2 (Alex, 2026-11-09): se agrega ruleVersion al select del
// historico y al punto actual -- generarAnalisisObservacionKpi() excluye
// por su cuenta cualquier periodo historico de una ruleVersion distinta
// (nunca se compara contra un motor de calculo diferente). Se renombra
// "Tendencia" a "Evolucion reciente" y "Causas observables" a
// "Descomposicion del cambio" (no se implemento ningun metodo real de
// deteccion de tendencia, ver src/infra/kpis/analisisDecision.ts). El
// texto sobre la migracion de esquema se sustituye por un mensaje
// generico de roadmap -- la propuesta de esquema sigue sin construirse ni
// ejecutarse (ver el reporte de PR2, seccion "Decisiones pendientes").
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdminOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { diagnosticoLecturaSeguro } from "@/infra/prisma/errores";
import { clasificarValorObservacionKpi, esCodigoConDetalleHabilitado } from "@/infra/kpis/estadoVisualizacion";
import {
  generarAnalisisObservacionKpi,
  type PuntoObservacionKpi,
  type MotivoInformacionInsuficiente,
} from "@/infra/kpis/analisisDecision";

type CodigoHabilitado = "OTIF" | "FILL_RATE";

const RUTA_HISTORIAL: Record<CodigoHabilitado, string> = {
  OTIF: "/dashboard/kpis/otif",
  FILL_RATE: "/dashboard/kpis/fill-rate",
};

const ETIQUETA_ESTADO_DATO: Record<string, string> = {
  DECLARADO: "Declarado",
  INFERIDO: "Inferido",
  VERIFICADO: "Verificado",
};

// Tope de periodos anteriores a traer para la tendencia -- mismo
// criterio que LIMITE_FILAS_TABLA en cobertura/importaciones/[id]/
// page.tsx: un numero fijo, documentado, no "todo el historico".
const LIMITE_HISTORICO = 12;

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

// RONDA 3 (Alex, 2026-11-09, punto 2): el mensaje de "informacion
// insuficiente" ahora distingue POR QUE, en vez de un texto generico
// unico -- "no existe periodo anterior" (SIN_HISTORICO) es una situacion
// MUY distinta de "existe, pero es de otra version de calculo"
// (RULE_VERSION_INCOMPATIBLE). Se usa el MISMO motivo para la seccion de
// "Evolucion reciente" y la de "Comparacion" porque, en este dominio, la
// unica causa que afecta a AMBAS a la vez es la incompatibilidad de
// ruleVersion (ver generarAnalisisObservacionKpi() -- un historico
// filtrado por version vacia deja ambas secciones sin datos por igual);
// SIN_DATOS_PERIODO_ANTERIOR solo afecta a la comparacion (la evolucion
// reciente puede seguir siendo suficiente con otros puntos, ver la
// prueba "tendencia y comparacion son independientes" del modulo).
const MENSAJE_INSUFICIENTE_POR_MOTIVO: Partial<Record<NonNullable<MotivoInformacionInsuficiente>, string>> = {
  RULE_VERSION_INCOMPATIBLE:
    "Información insuficiente: los períodos anteriores usan otra versión de cálculo y no son comparables.",
  SIN_DATOS_PERIODO_ANTERIOR: "Información insuficiente: el período anterior no tiene un valor declarado para comparar.",
};
const MENSAJE_EVOLUCION_POR_DEFECTO =
  "Información insuficiente: todavía no hay suficientes períodos con dato para mostrar una evolución reciente.";
const MENSAJE_COMPARACION_POR_DEFECTO = "Información insuficiente: no hay un período anterior con dato para comparar.";

function mensajeInsuficiente(motivo: MotivoInformacionInsuficiente, porDefecto: string): string {
  return (motivo && MENSAJE_INSUFICIENTE_POR_MOTIVO[motivo]) ?? porDefecto;
}

function formatearFechaHora(fecha: Date): string {
  return fecha.toLocaleString("es-PE", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatearFecha(fecha: Date): string {
  return fecha.toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit" });
}

// `unidad` viene de DefinicionKpi.unidad -- hoy siempre "%" para OTIF y
// Fill Rate (ver prisma/seedDefinicionesKpi.ts), pero esta funcion no lo
// asume: si unidad no es "%", muestra el numero crudo con la unidad al
// lado, para que un futuro KPI con otra unidad (ej. "días") no quede mal
// formateado por accidente.
function formatearValorConUnidad(valor: number, unidad: string): string {
  if (unidad === "%") return `${(valor * 100).toFixed(1)}%`;
  return `${valor.toFixed(2)} ${unidad}`;
}

// Mismo criterio que formatearValorConUnidad -- si la unidad no es "%"
// no se asume nada, se muestra la diferencia cruda con la unidad al
// lado.
function formatearDeltaConUnidad(deltaAbsoluto: number, unidad: string): string {
  if (unidad === "%") {
    const puntos = deltaAbsoluto * 100;
    const signo = puntos >= 0 ? "+" : "";
    return `${signo}${puntos.toFixed(1)} puntos`;
  }
  const signo = deltaAbsoluto >= 0 ? "+" : "";
  return `${signo}${deltaAbsoluto.toFixed(2)} ${unidad}`;
}

// Historico de periodos ANTERIORES al actual, misma cadena+definicionKpi
// -- orden cronologico ascendente (lo que espera generarAnalisisObservacionKpi()).
// Pedido en su propio try/catch por el llamador, no aca -- esta funcion
// se mantiene "ingenua" (deja que el error se propague), igual criterio
// que cargarResultadoImportacionCobertura() en PR1.
async function cargarHistoricoObservacionesKpi(
  client: ReturnType<typeof tenantClient>,
  cadenaId: string,
  definicionKpiId: string,
  periodoInicioActual: Date,
): Promise<PuntoObservacionKpi[]> {
  const historico = await client.observacionKpi.findMany({
    where: { cadenaId, definicionKpiId, periodoInicio: { lt: periodoInicioActual } },
    orderBy: { periodoInicio: "desc" },
    take: LIMITE_HISTORICO,
    select: { id: true, periodoInicio: true, periodoFin: true, valor: true, numerador: true, denominador: true, ruleVersion: true },
  });
  return [...historico].reverse();
}

export default async function DetalleObservacionKpi({ codigo, id }: { codigo: CodigoHabilitado; id: string }) {
  if (!esCodigoConDetalleHabilitado(codigo)) {
    // Defensivo -- hoy solo los 2 wrappers de OTIF/Fill Rate llaman a
    // este componente con un codigo fijo en el propio codigo fuente, asi
    // que esto nunca deberia dispararse en producción; existe para que un
    // futuro wrapper de uno de los 7 KPIs sin flujo completo no quede
    // expuesto por accidente antes de construirle su propia pagina.
    notFound();
  }

  const sesion = await requireAdminOrRedirect();
  const client = tenantClient(sesion.empresaId);

  // findFirst (no findUnique) a proposito: permite combinar el id con el
  // filtro de `definicionKpi.codigo` en el mismo WHERE sin pelear con la
  // restriccion de Prisma de que un findUnique solo acepte columnas de
  // una clave unica real -- el aislamiento de tenant lo sigue agregando
  // tenantClient() (injectTenantFilter, src/infra/prisma/tenantScope.ts)
  // exactamente igual que en cualquier otra consulta de este archivo, sin
  // ningun mecanismo nuevo.
  const observacion = await client.observacionKpi.findFirst({
    where: { id, definicionKpi: { codigo } },
    include: {
      cadena: { select: { nombre: true } },
      definicionKpi: { select: { nombre: true, formula: true, unidad: true } },
    },
  });

  if (!observacion) {
    notFound();
  }

  const estadoVisual = clasificarValorObservacionKpi(observacion.valor);
  const unidad = observacion.definicionKpi.unidad;

  let historico: PuntoObservacionKpi[] = [];
  let errorLecturaHistorico = false;
  try {
    historico = await cargarHistoricoObservacionesKpi(client, observacion.cadenaId, observacion.definicionKpiId, observacion.periodoInicio);
  } catch (error) {
    // Mismo ALLOWLIST ya reutilizado en PR1/PR2 (diagnosticoLecturaSeguro(),
    // src/infra/prisma/errores.ts) -- nunca el objeto `error` completo ni
    // su message/stack/query/params/detail/hint.
    const diagnostico = diagnosticoLecturaSeguro(error);
    console.error("KPI_HISTORICO_LECTURA_FALLIDA", {
      observacionId: id,
      nombreClase: diagnostico.nombreClase,
      codigo: diagnostico.codigo,
    });
    errorLecturaHistorico = true;
  }

  const puntoActual: PuntoObservacionKpi = {
    id: observacion.id,
    periodoInicio: observacion.periodoInicio,
    periodoFin: observacion.periodoFin,
    valor: observacion.valor,
    numerador: observacion.numerador,
    denominador: observacion.denominador,
    ruleVersion: observacion.ruleVersion,
  };

  const analisis = errorLecturaHistorico ? null : generarAnalisisObservacionKpi(puntoActual, historico);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href={RUTA_HISTORIAL[codigo]} className="text-sm text-slate-500 underline">
          ← Volver a {observacion.definicionKpi.nombre}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {observacion.definicionKpi.nombre} — {observacion.cadena.nombre}
        </h1>
        <p className="text-sm text-slate-600">
          {formatearFecha(observacion.periodoInicio)} – {formatearFecha(observacion.periodoFin)}
        </p>
      </div>

      <div className="rounded border border-slate-200 p-4">
        <p className="text-sm text-slate-500">Fórmula</p>
        <p className="text-sm">{observacion.definicionKpi.formula}</p>
      </div>

      <div className="rounded border border-slate-200 p-4">
        <p className="text-sm text-slate-500">Valor</p>
        {estadoVisual === "SIN_DATOS" ? (
          <>
            <p className="text-3xl font-semibold text-slate-400">--</p>
            <p className="mt-2 text-xs text-amber-700">
              Sin datos suficientes: no hubo ninguna fila evaluable al confirmar esta observación. No es un valor de
              cero -- es la ausencia de un resultado calculable.
            </p>
          </>
        ) : (
          <>
            <p className="text-3xl font-semibold">{formatearValorConUnidad(observacion.valor as number, unidad)}</p>
            {estadoVisual === "CERO_REAL" && (
              <p className="mt-2 text-xs text-amber-700">
                Este valor es 0 porque ninguna fila evaluada cumplió el criterio del KPI en este período -- es un
                resultado real, no una ausencia de datos.
              </p>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded border border-slate-200 p-4">
          <p className="text-sm text-slate-500">Numerador</p>
          <p className="text-lg">{observacion.numerador === null ? "--" : observacion.numerador}</p>
        </div>
        <div className="rounded border border-slate-200 p-4">
          <p className="text-sm text-slate-500">Denominador</p>
          <p className="text-lg">{observacion.denominador === null ? "--" : observacion.denominador}</p>
        </div>
      </div>

      <div className="rounded border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
        Filas evaluadas/excluidas y las advertencias del cálculo no están disponibles aquí: esos datos solo existen
        de forma transitoria durante la previsualización y la confirmación (no se persisten en esta tabla hoy).
        Verlos de forma duradera requeriría agregar esas columnas al esquema -- fuera del alcance de este cambio, sin
        una migración autorizada.
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-slate-500">Estado del dato</p>
          <p>{ETIQUETA_ESTADO_DATO[observacion.estado] ?? observacion.estado}</p>
        </div>
        <div>
          <p className="text-slate-500">Fuente</p>
          <p>{observacion.fuente}</p>
        </div>
        <div>
          <p className="text-slate-500">Declarada el</p>
          <p>{formatearFechaHora(observacion.createdAt)}</p>
        </div>
        <div>
          <p className="text-slate-500">Versión de regla</p>
          <p>{observacion.ruleVersion}</p>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Esta observación se calculó y persistió de forma síncrona al confirmarla -- no existe, para este KPI, un paso
        de procesamiento asíncrono separado (sin cola de trabajos de por medio), así que no aplican aquí los estados
        de &quot;procesamiento pendiente&quot; ni &quot;procesamiento con errores&quot;.
      </p>

      <div className="rounded border border-slate-200 p-4">
        <h2 className="mb-3 font-medium">Análisis y decisión</h2>

        {errorLecturaHistorico ? (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">No se pudo cargar el análisis histórico. Intenta nuevamente.</p>
            <a
              href={`${RUTA_HISTORIAL[codigo]}/observaciones/${id}`}
              className="mt-2 inline-block rounded border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 underline"
            >
              Reintentar
            </a>
          </div>
        ) : (
          analisis && (
            <div className="flex flex-col gap-4 text-sm">
              <div>
                <p className="text-slate-500">
                  Evolución reciente ({analisis.tendencia.length} período{analisis.tendencia.length === 1 ? "" : "s"})
                </p>
                {analisis.tendenciaInformacionInsuficiente ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {mensajeInsuficiente(analisis.motivoInformacionInsuficiente, MENSAJE_EVOLUCION_POR_DEFECTO)}
                  </p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-slate-600">
                    {analisis.tendencia.map((punto) => (
                      <li key={punto.id}>
                        {formatearFecha(punto.periodoInicio)} – {formatearFecha(punto.periodoFin)}:{" "}
                        {punto.valor === null ? "sin datos" : formatearValorConUnidad(punto.valor, unidad)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-slate-500">Comparación contra el período anterior</p>
                {analisis.comparacionInformacionInsuficiente || analisis.variacion === null ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {mensajeInsuficiente(analisis.motivoInformacionInsuficiente, MENSAJE_COMPARACION_POR_DEFECTO)}
                  </p>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <span className={"rounded px-2 py-0.5 text-xs font-medium " + ESTILO_DIRECCION[analisis.variacion.direccion]}>
                      {ETIQUETA_DIRECCION[analisis.variacion.direccion]}
                    </span>
                    <span className="text-xs text-slate-600">{formatearDeltaConUnidad(analisis.variacion.deltaAbsoluto, unidad)}</span>
                  </div>
                )}
              </div>

              <div>
                <p className="text-slate-500">Descomposición del cambio</p>
                {analisis.causasInformacionInsuficiente ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Información insuficiente: el numerador o el denominador no están disponibles en alguno de los 2
                    períodos para descomponer la variación.
                  </p>
                ) : (
                  <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                    {analisis.causasObservables.map((causa, indice) => (
                      <li key={indice}>{causa}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-slate-500">Recomendación</p>
                {analisis.recomendacion === null ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Información insuficiente: no hay una comparación posible contra el período anterior.
                  </p>
                ) : (
                  <div className="mt-1 flex flex-col gap-1">
                    <span
                      className={
                        "self-start rounded px-2 py-0.5 text-xs font-medium " + ESTILO_PRIORIDAD[analisis.recomendacion.prioridad]
                      }
                    >
                      {ETIQUETA_PRIORIDAD[analisis.recomendacion.prioridad]}
                    </span>
                    <span className="text-xs text-slate-600">{analisis.recomendacion.texto}</span>
                  </div>
                )}
              </div>

              {analisis.siguienteAccionPropuesta && (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <p className="font-medium">Siguiente acción propuesta</p>
                  <p className="mt-1">{analisis.siguienteAccionPropuesta}</p>
                  <p className="mt-2 text-amber-700">
                    El registro y seguimiento de acciones estará disponible en una próxima versión.
                  </p>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </main>
  );
}
