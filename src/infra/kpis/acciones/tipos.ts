// Infraestructura (dominio puro) -- tipos de AccionDecisionKpi escritos a
// mano, NUNCA importados desde "@prisma/client" para este modelo.
//
// Motivo (decision de diseno explicita para este PR, ver el reporte de
// entrega): el cliente de Prisma instalado en este Mac se genero ANTES
// de que este PR agregara AccionDecisionKpi a prisma/schema.prisma --
// "prisma generate" no puede correr en este entorno (bloqueo de red a
// binaries.prisma.sh, mismo motivo ya documentado en
// src/infra/prisma/tenantClient.ts) y esta sesion tiene prohibido
// ejecutar Prisma contra Neon o cualquier otro flujo de Prisma. Eso
// significa que `@prisma/client` no sabe nada de este modelo todavia.
// Para que esto NO agregue diagnosticos nuevos de typecheck sobre el
// baseline ya conocido (24, ver claude/pr2-incremento4-ronda*.md), TODO
// el codigo de este PR trabaja contra estos tipos hand-rolled -- mismo
// patron que PuntoObservacionKpi/PuntoResumenCobertura en
// analisisDecision.ts -- y el unico punto de contacto real con
// tenantClient() (servicio.ts) usa una interfaz minima
// (ClienteConAccionesDecisionKpi) en vez de "any" suelto, para conservar
// el chequeo de tipos en todo lo demas. Corre "npm run prisma:generate"
// una vez con acceso de red real (Windows) y volve a "tsc --noEmit" --
// en ese punto esta interfaz puede reemplazarse por el tipo generado real
// sin cambiar ninguna otra firma de este archivo.

export type EstadoAccionKpi = "PENDIENTE" | "EN_PROGRESO" | "COMPLETADA" | "DESCARTADA";

const ESTADOS_TERMINALES: readonly EstadoAccionKpi[] = ["COMPLETADA", "DESCARTADA"];

export function esEstadoTerminal(estado: EstadoAccionKpi): boolean {
  return ESTADOS_TERMINALES.includes(estado);
}

// Mismos 3 valores que PrioridadRecomendacion en analisisDecision.ts --
// tipo separado (no reutiliza ese import) porque este archivo nunca debe
// depender de analisisDecision.ts ni viceversa (capas distintas: motor de
// analisis vs. persistencia de la accion que un humano decide registrar a
// partir de ese analisis). Los valores deben coincidir siempre con el
// enum PrioridadRecomendacionKpi de prisma/schema.prisma.
export type PrioridadRecomendacionAccionKpi = "ALTA" | "MEDIA" | "BAJA";

export type OrigenAccionKpi =
  | { tipo: "OBSERVACION_KPI"; observacionKpiId: string }
  | { tipo: "IMPORTACION_CSV"; importacionCsvId: string };

/** Funcion pura: extrae los dos ids "planos" (observacionKpiId /
 * importacionCsvId, cada uno string|null segun cual de los 2 casos de
 * OrigenAccionKpi aplique) que la fila persistida necesita (ver
 * AccionDecisionKpiFila arriba, que guarda ambas columnas por separado
 * en vez de la union discriminada -- asi lo exige el CHECK de Postgres
 * chk_accion_decision_kpi_un_origen). Reemplaza los 2 ternarios
 * redundantes que antes vivian inline en
 * crearAccionDecisionKpi() (servicio.ts) -- misma logica, un solo lugar.
 * Tercer corte de PR-A, ver
 * diseno-pr-a-tercer-corte-acciones-origen-2026-11-23.md.
 *
 * Correccion de la revision del PR #40: los 2 ternarios independientes
 * se reemplazan por un `switch` exhaustivo sobre `origen.tipo`, sin
 * `default` que silencie una variante futura -- la rama final verifica
 * en tiempo de compilacion que `origen` ya es `never` (mismo espiritu
 * que `nuncaOcurre()` en src/domain/queries/tipos.ts, reimplementado
 * aca en vez de importado para no acoplar este modulo, deliberadamente
 * independiente -- ver la nota de cabecera del archivo -- al dominio de
 * consultas). Si alguna vez se agrega un 3er caso a `OrigenAccionKpi`
 * sin agregar su `case` aca, esto deja de compilar en vez de devolver
 * silenciosamente `{observacionKpiId: null, importacionCsvId: null}`. */
export function idsDeOrigenAccionKpi(origen: OrigenAccionKpi): {
  observacionKpiId: string | null;
  importacionCsvId: string | null;
} {
  switch (origen.tipo) {
    case "OBSERVACION_KPI":
      return { observacionKpiId: origen.observacionKpiId, importacionCsvId: null };
    case "IMPORTACION_CSV":
      return { observacionKpiId: null, importacionCsvId: origen.importacionCsvId };
    default: {
      const origenNuncaVisto: never = origen;
      throw new Error(
        `idsDeOrigenAccionKpi: variante de OrigenAccionKpi no manejada: ${JSON.stringify(origenNuncaVisto)}`,
      );
    }
  }
}

/** Forma de una fila ya persistida, tal como la devuelve Postgres (fechas
 * ya como Date, nunca string -- Prisma las deserializa asi). */
export interface AccionDecisionKpiFila {
  id: string;
  empresaId: string;
  cadenaId: string;
  observacionKpiId: string | null;
  importacionCsvId: string | null;
  ruleVersionOrigen: string;
  prioridadOrigen: PrioridadRecomendacionAccionKpi;
  descripcionAccion: string;
  responsableId: string;
  fechaObjetivo: Date;
  estado: EstadoAccionKpi;
  creadaPorId: string;
  finalizadaEn: Date | null;
  finalizadaPorId: string | null;
  createdAt: Date;
  // Fecha de auditoria pura -- correccion de ronda de revision (3ra
  // vuelta): ya NO forma parte del control de concurrencia (ver
  // `version` abajo); Prisma sigue actualizandola sola via @updatedAt
  // en cada UPDATE, pero actualizarAccionDecisionKpi() ya no la lee
  // para decidir nada.
  updatedAt: Date;
  // Control de concurrencia optimista (ver actualizarAccionDecisionKpi()
  // en servicio.ts) -- arranca en 1 (@default(1) en prisma/schema.prisma),
  // se incrementa en 1 en cada actualizacion exitosa. Reemplaza el
  // intento anterior de usar `updatedAt` para esto: una columna entera
  // dedicada no tiene la ventana de colision de un timestamp con
  // precision de milisegundo.
  version: number;
}

/** `ruleVersionOrigen` y `prioridadOrigen` NO forman parte de este tipo
 * a proposito -- correccion de ronda de revision (ver el reporte de
 * entrega, "bloqueantes corregidos", punto 1): ANTES se aceptaban como
 * input del llamador (el cliente los mandaba en el body del POST, con
 * los mismos valores que la UI le habia sugerido) y el servidor
 * confiaba en ellos sin volver a calcularlos -- un body manipulado a
 * mano podia declarar `prioridadOrigen: "ALTA"` para un origen que en
 * realidad no amerita ninguna accion, o una `ruleVersionOrigen`
 * arbitraria que no coincide con la version real del origen. Ahora
 * `crearAccionDecisionKpi()` los deriva el mismo SIEMPRE, volviendo a
 * ejecutar el mismo analisis que ya corre en la pagina (ver
 * derivarOrigenActual.ts) -- quitarlos de este tipo (en vez de solo
 * "ignorarlos si vienen") hace que sea un error de COMPILACION, no solo
 * de runtime, que algun llamador futuro intente pasarlos. */
export interface DatosCrearAccionDecisionKpi {
  empresaId: string;
  origen: OrigenAccionKpi;
  descripcionAccion: string;
  responsableId: string;
  fechaObjetivo: Date;
  creadaPorId: string;
}

export interface DatosActualizarAccionDecisionKpi {
  estado?: EstadoAccionKpi;
  responsableId?: string;
  fechaObjetivo?: Date;
  descripcionAccion?: string;
  // Solo relevante cuando `estado` pasa a un estado terminal -- quien la
  // cierra. Ignorado en cualquier otro cambio.
  finalizadaPorId?: string;
}

export type ResultadoValidacion = { valido: true; errores: readonly [] } | { valido: false; errores: string[] };

/** Lo minimo que la validacion de tenant-consistencia necesita de cada
 * referencia cruzada (responsable/creadaPor/finalizadaPor) -- nunca el
 * modelo completo. */
export interface RefConEmpresa {
  empresaId: string;
}

/** Idem, para el origen (observacionKpi/importacionCsv) -- ademas
 * necesita cadenaId, porque tenantClient() no filtra por cadena (ver
 * validacion.ts para el razonamiento completo). */
export interface RefConEmpresaYCadena {
  empresaId: string;
  cadenaId: string;
}

/** Interfaz minima del delegado `accionDecisionKpi` que servicio.ts
 * necesita de un TenantPrismaClient -- ver la nota de cabecera de este
 * archivo. Cualquier metodo que servicio.ts no use (delete, count,
 * groupBy, etc.) se agrega aca cuando haga falta, nunca se reemplaza por
 * "any" generico. */
export interface ClienteConAccionesDecisionKpi {
  accionDecisionKpi: {
    create(args: { data: Record<string, unknown> }): Promise<AccionDecisionKpiFila>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AccionDecisionKpiFila>;
    // `updateMany` (no `update`) para la transicion de estado -- ver
    // actualizarAccionDecisionKpi() en servicio.ts (correccion de ronda
    // de revision, punto 3, mas 2 vueltas de correccion mas sobre el
    // mismo punto): el `where` incluye `estado` Y `version`, ambos
    // leidos en el mismo request (ademas de `id`), para que el UPDATE
    // solo aplique si NADIE escribio sobre esta fila entre el
    // findUnique() de ese request y este update -- ni un cambio de
    // `estado` (cierre concurrente) ni una edicion de cualquier otro
    // campo (que incrementa `version` igual, sin tocar `estado`).
    // Postgres serializa 2 UPDATE concurrentes sobre la misma fila, asi
    // que el segundo en aplicar ve el `version` YA incrementado del
    // primero y su WHERE deja de matchear (count: 0), en vez de
    // pisarlo. Historial de este punto: `estado` solo detectaba
    // cierres concurrentes pero no ediciones concurrentes que no
    // cambian `estado`; se probo `updatedAt` para eso, pero su
    // precision TIMESTAMP(3) deja una ventana de colision real dentro
    // del mismo milisegundo -- `version` (columna entera dedicada,
    // incrementada SIEMPRE en `data`, ver `{ increment: 1 }` mas abajo)
    // no tiene esa ventana. `count` es el numero de filas que
    // matchearon el `where` (0 o 1 -- `id` ya es unico).
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    findUnique(args: { where: { id: string } }): Promise<AccionDecisionKpiFila | null>;
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
    }): Promise<AccionDecisionKpiFila[]>;
  };
}
