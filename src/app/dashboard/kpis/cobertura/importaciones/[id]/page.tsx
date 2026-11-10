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
import {
  generarAnalisisImportacionCobertura,
  type PuntoResumenCobertura,
  type MotivoInformacionInsuficiente,
  type EstadoVersionCobertura,
} from "@/infra/kpis/analisisDecision";

// Tope de filas que se muestran en la tabla -- una importacion puede
// traer miles de filas y esta pagina no agrega paginacion todavia (fuera
// del alcance de PR1, que pide "resultado visible", no un visor general
// de CSV). El resumen de arriba (resumirFilasCobertura) SIEMPRE cuenta
// sobre el total real via groupBy/count, nunca sobre las filas mostradas
// -- nunca se "miente" el resumen por el tope de la tabla.
const LIMITE_FILAS_TABLA = 500;

// Tope de importaciones PROCESADA anteriores a traer para el analisis de
// tendencia -- mismo criterio que LIMITE_FILAS_TABLA: un numero fijo,
// documentado, no "todo el historico". Mas bajo que el de OTIF/Fill Rate
// (12) porque una importacion de Cobertura suele ser un lote completo,
// no un periodo corto -- 6 lotes anteriores alcanza para una tendencia
// util sin pedir un historico enorme.
const LIMITE_HISTORICO_COBERTURA = 6;

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
async function cargarResultadoImportacionCobertura(
  client: ReturnType<typeof tenantClient>,
  importId: string,
): Promise<ResultadoImportacionCobertura> {
  const [porEstadoBruto, calculadaConCeroDias, rangoFechaCorte, filas] = await Promise.all([
    // RONDA 2 (punto 4): se agrega "ruleVersion" al `by` de este MISMO
    // groupBy (ya existente) para derivar la version de regla de esta
    // importacion sin una consulta nueva -- ver el reduce de abajo.
    client.observacionCobertura.groupBy({ by: ["estado", "ruleVersion"], where: { importId }, _count: { _all: true } }),
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
  // RONDA 2 (punto 4): mismo groupBy, ahora agrupado tambien por
  // ruleVersion -- se acumulan los conteos por estado (idéntico a
  // antes, sumando entre versiones si las hubiera) Y se juntan las
  // ruleVersion distintas vistas, para derivar una version unica (o
  // detectar mezcla) sin pedir nada nuevo.
  const versionesVistas = new Set<string>();
  for (const grupo of porEstadoBruto as Array<{
    estado: EstadoObservacionCobertura;
    ruleVersion: string;
    _count: { _all: number };
  }>) {
    porEstado[grupo.estado] = (porEstado[grupo.estado] ?? 0) + grupo._count._all;
    totalFilasPersistidas += grupo._count._all;
    versionesVistas.add(grupo.ruleVersion);
  }
  // RONDA 4, punto 1: estado explicito -- antes se colapsaba "0
  // versiones vistas" (SIN_FILAS) y "2+ versiones vistas" (MEZCLADA) en
  // el mismo `ruleVersion = null`, lo cual escondia que una importacion
  // ACTUAL sin filas terminara mostrando VERSION_MEZCLADA en vez de
  // TOTAL_CERO (ver analisisDecision.ts).
  const estadoVersion: EstadoVersionCobertura =
    versionesVistas.size === 0 ? "SIN_FILAS" : versionesVistas.size === 1 ? "UNICA" : "MEZCLADA";
  // Solo no-null cuando estadoVersion === "UNICA".
  const ruleVersion = estadoVersion === "UNICA" ? [...versionesVistas][0] ?? null : null;

  return {
    resumen: resumirFilasCobertura(porEstado, calculadaConCeroDias),
    totalFilasPersistidas,
    rangoFechaCorte: { min: rangoFechaCorte._min.fechaCorte, max: rangoFechaCorte._max.fechaCorte },
    estadoVersion,
    ruleVersion,
    filas,
  };
}

// Historico de importaciones PROCESADA anteriores (misma cadena), con el
// resumen por categoria de cada una -- para "Analisis y decision" (PR2).
// NUNCA calcula un promedio de dias de cobertura entre SKU (ver el
// comentario de cabecera de analisisDecision.ts) -- solo los conteos que
// ya produce resumirFilasCobertura(), exactamente igual que el resultado
// de la importacion actual.
//
// 2 consultas SIEMPRE, sin importar cuantas importaciones historicas
// haya (nunca N+1): un groupBy agrupado por (importId, estado) y otro
// agrupado por importId (para aislar CALCULADA+coberturaDias=0, igual
// separacion que ya hace cargarResultadoImportacionCobertura con su
// count() filtrado) -- ambos sobre TODOS los importIds del lote a la
// vez. Si no hay ninguna importacion historica, ninguna de las 2 se
// ejecuta (early return) -- mismo criterio de "no consultar lo que no
// hace falta" que el resto de este archivo.
//
// Orden cronologico: se usa `confirmadaEn` (garantizado no nulo por el
// filtro estado=CONFIRMADA + procesadaEn no nulo, ver el invariante
// documentado en EstadoImportacion de prisma/schema.prisma), no
// `periodoReferenciaConsumoInicio` -- ese campo puede faltar en
// importaciones antiguas sin el, y mezclar "con periodo declarado" y
// "sin el" en un mismo orderBy con nulls habria sido mas complejidad de
// la que justifica esta simplificacion deliberada.
async function cargarHistoricoResumenCobertura(
  client: ReturnType<typeof tenantClient>,
  cadenaId: string,
  importIdActual: string,
  // RONDA 2 (Alex, 2026-11-09, punto 1): `confirmadaEn` de la
  // importacion ACTUAL -- el historico se limita a importaciones
  // ESTRICTAMENTE anteriores a esta fecha (nunca a importaciones
  // posteriores, aunque por algun motivo existieran). Si la actual no
  // tiene esta fecha (defensivo -- no deberia ocurrir para una
  // importacion PROCESADA, ver el invariante de EstadoImportacion en
  // prisma/schema.prisma), no hay ancla temporal valida: se devuelve []
  // SIN ejecutar ninguna consulta, informacion insuficiente.
  confirmadaEnActual: Date | null,
): Promise<PuntoResumenCobertura[]> {
  if (confirmadaEnActual === null) {
    return [];
  }

  const importaciones = await client.importacionCsv.findMany({
    where: {
      cadenaId,
      definicionKpi: { codigo: "COBERTURA" },
      estado: "CONFIRMADA",
      procesadaEn: { not: null },
      id: { not: importIdActual },
      // RONDA 2, punto 1: estrictamente anterior, nunca <=  -- 2
      // importaciones no pueden "atarse" y nunca se compara contra una
      // importacion posterior a la actual.
      confirmadaEn: { lt: confirmadaEnActual },
    },
    orderBy: { confirmadaEn: "desc" },
    take: LIMITE_HISTORICO_COBERTURA,
    select: { id: true, periodoReferenciaConsumoInicio: true, periodoReferenciaConsumoFin: true },
  });

  if (importaciones.length === 0) {
    return [];
  }

  const importIds = importaciones.map((imp: { id: string }) => imp.id);

  const [porEstadoBruto, calculadaConCeroDiasBruto] = await Promise.all([
    // RONDA 2 (punto 4): se agrega "ruleVersion" al `by` de este MISMO
    // groupBy (ya existente) para derivar, por importId, su version de
    // regla SIN una consulta nueva -- igual tecnica que en
    // cargarResultadoImportacionCobertura() de arriba.
    client.observacionCobertura.groupBy({
      by: ["importId", "estado", "ruleVersion"],
      where: { importId: { in: importIds } },
      _count: { _all: true },
    }),
    client.observacionCobertura.groupBy({
      by: ["importId"],
      where: { importId: { in: importIds }, estado: "CALCULADA", coberturaDias: 0 },
      _count: { _all: true },
    }),
  ]);

  const porImportEstado = new Map<string, Partial<Record<EstadoObservacionCobertura, number>>>();
  const versionesPorImport = new Map<string, Set<string>>();
  for (const grupo of porEstadoBruto as Array<{
    importId: string | null;
    estado: EstadoObservacionCobertura;
    ruleVersion: string;
    _count: { _all: number };
  }>) {
    if (!grupo.importId) continue;
    const actual = porImportEstado.get(grupo.importId) ?? {};
    actual[grupo.estado] = (actual[grupo.estado] ?? 0) + grupo._count._all;
    porImportEstado.set(grupo.importId, actual);
    const versiones = versionesPorImport.get(grupo.importId) ?? new Set<string>();
    versiones.add(grupo.ruleVersion);
    versionesPorImport.set(grupo.importId, versiones);
  }
  // RONDA 4, punto 1: estado explicito por importId -- mismo criterio
  // que estadoVersion en cargarResultadoImportacionCobertura() de
  // arriba (SIN_FILAS/UNICA/MEZCLADA en vez de colapsar "0 filas" y
  // "mezclada" al mismo null). Un importId que nunca aparecio en
  // `versionesPorImport` (0 filas) no tiene entrada en el Map -- se
  // trata como SIN_FILAS mas abajo, al leerlo con `.get(...) ??`.
  const estadoVersionPorImport = new Map<string, EstadoVersionCobertura>();
  const ruleVersionPorImport = new Map<string, string | null>();
  for (const [importId, versiones] of versionesPorImport) {
    const estado: EstadoVersionCobertura = versiones.size === 1 ? "UNICA" : "MEZCLADA";
    estadoVersionPorImport.set(importId, estado);
    ruleVersionPorImport.set(importId, estado === "UNICA" ? [...versiones][0] ?? null : null);
  }

  const ceroDiasPorImport = new Map<string, number>();
  for (const grupo of calculadaConCeroDiasBruto as Array<{ importId: string | null; _count: { _all: number } }>) {
    if (!grupo.importId) continue;
    ceroDiasPorImport.set(grupo.importId, grupo._count._all);
  }

  // La consulta de arriba vino en orden desc (mas reciente primero) --
  // generarAnalisisImportacionCobertura() espera orden cronologico
  // ascendente, mismo criterio que cargarHistoricoObservacionesKpi() en
  // DetalleObservacionKpi.tsx.
  const importacionesAscendente = [...importaciones].reverse();

  return importacionesAscendente.map((imp: { id: string; periodoReferenciaConsumoInicio: Date | null; periodoReferenciaConsumoFin: Date | null }) => ({
    importId: imp.id,
    periodoReferencia: { inicio: imp.periodoReferenciaConsumoInicio, fin: imp.periodoReferenciaConsumoFin },
    resumen: resumirFilasCobertura(porImportEstado.get(imp.id) ?? {}, ceroDiasPorImport.get(imp.id) ?? 0),
    // RONDA 4, punto 1: sin entrada en el Map == 0 filas == SIN_FILAS.
    estadoVersion: estadoVersionPorImport.get(imp.id) ?? "SIN_FILAS",
    ruleVersion: ruleVersionPorImport.get(imp.id) ?? null,
  }));
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

                  {analisisCobertura.siguienteAccionPropuesta && (
                    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      <p className="font-medium">Siguiente acción propuesta</p>
                      <p className="mt-1">{analisisCobertura.siguienteAccionPropuesta}</p>
                      <p className="mt-2 text-amber-700">
                        El registro y seguimiento de acciones estará disponible en una próxima versión.
                      </p>
                    </div>
                  )}
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
