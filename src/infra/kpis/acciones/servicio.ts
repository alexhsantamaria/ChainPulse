// Infraestructura -- capa de servicio de AccionDecisionKpi: validacion
// de aplicacion (validacion.ts, SIEMPRE antes de persistir) + acceso a
// datos via tenantClient() (RNF1, capa 1 -- mismo aislamiento de tenant
// que el resto del esquema). Ninguna ruta API debe llamar a Prisma
// directamente para este modelo -- siempre a traves de estas funciones,
// para que "un solo origen"/consistencia de tenant/consistencia de
// finalizacion corran SIEMPRE, nunca solo en algunos puntos de entrada.
//
// Tipos (ver la nota de cabecera de tipos.ts): `tenantClient(...)` no
// conoce todavia el modelo `accionDecisionKpi` en los tipos generados de
// @prisma/client (prisma generate no pudo correr en este entorno). En vez
// de "any" suelto, se define una interfaz minima
// (ClienteConAccionesDecisionKpi, en tipos.ts) con exactamente los 4
// metodos que este archivo necesita, y se intersecta una sola vez por
// funcion -- el resto de las llamadas de este archivo contra modelos que
// SI existen hoy (usuario, observacionKpi, importacionCsv) conservan el
// chequeo de tipos normal de TenantPrismaClient, sin perder cobertura ahi.
import type { TenantPrismaClient } from "../../prisma/tenantClient";
import {
  validarAccionModificable,
  validarFinalizacionConsistente,
  validarOrigenUnico,
  validarTenantConsistente,
  validarTransicionEstado,
} from "./validacion";
import {
  esEstadoTerminal,
  type AccionDecisionKpiFila,
  type ClienteConAccionesDecisionKpi,
  type DatosActualizarAccionDecisionKpi,
  type DatosCrearAccionDecisionKpi,
  type EstadoAccionKpi,
} from "./tipos";
// Correccion de ronda de revision (bloqueante 1) -- ver el comentario de
// cabecera de derivarOrigenActual.ts: ruleVersionOrigen/prioridadOrigen
// ya NO se aceptan como input de crearAccionDecisionKpi(), se derivan
// SIEMPRE aca, volviendo a correr el mismo analisis que la pagina.
import { derivarOrigenActualAccionKpi } from "./derivarOrigenActual";

export type ResultadoServicioAccion<T> =
  | { ok: true; datos: T }
  | { ok: false; error: string; detalle?: string[] };

function conAcciones(cliente: TenantPrismaClient): ClienteConAccionesDecisionKpi {
  return cliente as unknown as ClienteConAccionesDecisionKpi;
}

/** Crea una AccionDecisionKpi nueva. `cadenaId` nunca se acepta como
 * input del llamador -- se deriva SIEMPRE del origen ya persistido
 * (observacionKpi.cadenaId / importacionCsv.cadenaId), para que sea
 * imposible declarar una cadena distinta de la real del origen (en vez
 * de aceptarla y despues rechazarla en la validacion de tenant).
 *
 * Correccion de ronda de revision (bloqueante 1): `ruleVersionOrigen` y
 * `prioridadOrigen` TAMPOCO se aceptan como input -- ni `datos` los
 * admite a nivel de tipos (ver DatosCrearAccionDecisionKpi en tipos.ts)
 * -- se derivan SIEMPRE aca llamando a derivarOrigenActualAccionKpi(),
 * que vuelve a correr el mismo analisis que la pagina (ver el
 * comentario de cabecera de ese archivo). Si el origen no existe, o si
 * el analisis actual no sugiere ninguna accion, la creacion se rechaza
 * -- nunca se inventa ni se confia en un valor declarado por el
 * llamador. */
export async function crearAccionDecisionKpi(
  cliente: TenantPrismaClient,
  datos: DatosCrearAccionDecisionKpi,
): Promise<ResultadoServicioAccion<AccionDecisionKpiFila>> {
  const observacionKpiId = datos.origen.tipo === "OBSERVACION_KPI" ? datos.origen.observacionKpiId : null;
  const importacionCsvId = datos.origen.tipo === "IMPORTACION_CSV" ? datos.origen.importacionCsvId : null;

  const validacionOrigen = validarOrigenUnico(observacionKpiId, importacionCsvId);
  if (!validacionOrigen.valido) {
    return { ok: false, error: "ORIGEN_INVALIDO", detalle: validacionOrigen.errores };
  }

  const [responsable, creadaPor, derivacionOrigen] = await Promise.all([
    cliente.usuario.findUnique({ where: { id: datos.responsableId }, select: { id: true, empresaId: true } }),
    cliente.usuario.findUnique({ where: { id: datos.creadaPorId }, select: { id: true, empresaId: true } }),
    derivarOrigenActualAccionKpi(cliente, datos.origen),
  ]);

  if (!responsable) return { ok: false, error: "RESPONSABLE_INEXISTENTE" };
  if (!creadaPor) return { ok: false, error: "CREADOR_INEXISTENTE" };
  if (!derivacionOrigen.ok) {
    return { ok: false, error: derivacionOrigen.error };
  }

  const origenRef = { empresaId: derivacionOrigen.empresaId, cadenaId: derivacionOrigen.cadenaId };

  const validacionTenant = validarTenantConsistente({
    accion: { empresaId: datos.empresaId, cadenaId: origenRef.cadenaId },
    responsable,
    creadaPor,
    origen: origenRef,
  });
  if (!validacionTenant.valido) {
    return { ok: false, error: "TENANT_INCONSISTENTE", detalle: validacionTenant.errores };
  }

  const fila = await conAcciones(cliente).accionDecisionKpi.create({
    data: {
      empresaId: datos.empresaId,
      cadenaId: origenRef.cadenaId,
      observacionKpiId,
      importacionCsvId,
      ruleVersionOrigen: derivacionOrigen.ruleVersionOrigen,
      prioridadOrigen: derivacionOrigen.prioridadOrigen,
      descripcionAccion: datos.descripcionAccion,
      responsableId: datos.responsableId,
      fechaObjetivo: datos.fechaObjetivo,
      creadaPorId: datos.creadaPorId,
    },
  });

  return { ok: true, datos: fila };
}

/** Actualiza una AccionDecisionKpi existente -- estado, responsable,
 * fecha objetivo y/o descripcion. El pasaje a un estado terminal
 * (COMPLETADA/DESCARTADA) completa finalizadaEn/finalizadaPorId en la
 * MISMA llamada (nunca en 2 pasos separados, para que nunca exista una
 * fila intermedia "terminal sin finalizar" -- ver
 * validarFinalizacionConsistente()).
 *
 * Correccion de ronda de revision, 2 bloqueantes:
 *
 * (2) INMUTABILIDAD TOTAL de una accion ya finalizada -- el bug real
 *     que esto corrige: antes, un PATCH que NO declaraba `estado` (asi
 *     que `estadoNuevo` terminaba siendo el MISMO que `actual.estado`)
 *     pero SI cambiaba `responsableId`/`fechaObjetivo`/`descripcionAccion`
 *     pasaba `validarTransicionEstado()` sin que nada lo rechazara --
 *     esa funcion solo compara estadoActual/estadoNuevo, nunca mira los
 *     demas campos. `validarAccionModificable()` (validacion.ts) se
 *     corre PRIMERO, antes de leer ningun otro campo del body: una vez
 *     terminal, NINGUN cambio es posible, sin excepcion.
 *
 * (3) TRANSICION ATOMICA/CONDICIONAL -- el bug real que esto corrige:
 *     el patron anterior era "leer con findUnique(), decidir en
 *     memoria, escribir con update({where:{id}})" -- un TOCTOU
 *     (time-of-check-to-time-of-use) clasico. Si 2 PATCH llegaban casi
 *     simultaneos sobre la MISMA accion PENDIENTE (2 cierres
 *     concurrentes), ambos leian PENDIENTE, ambos pasaban la
 *     validacion, y ambos escribian -- el segundo en aplicar pisaba al
 *     primero sin que nadie lo notara (silent overwrite, posiblemente
 *     con un `estado`/`finalizadaPorId` distinto). Ahora el UPDATE es
 *     `updateMany({where:{id, estado: actual.estado}, ...})`: Postgres
 *     SIEMPRE serializa 2 UPDATE concurrentes sobre la misma fila (toma
 *     el lock de fila antes de evaluar el WHERE) -- el segundo, al
 *     aplicar DESPUES de que el primero ya commiteo, ve el `estado` YA
 *     distinto y su WHERE deja de matchear (`count: 0`), en vez de
 *     pisarlo. `count === 0` se reporta como ACCION_MODIFICADA_CONCURRENTEMENTE,
 *     nunca como un exito silencioso.
 *
 *     Correccion de ronda de revision (2da vuelta) -- `estado` SOLO en
 *     el WHERE no alcanza: detecta un cambio de estado, pero 2 ediciones
 *     concurrentes que NINGUNA cambia `estado` (ej. una cambia
 *     `responsableId`, la otra `fechaObjetivo`, ambas sobre la misma
 *     PENDIENTE) seguian pudiendo pisarse -- el `estado` almacenado no
 *     cambia entre una y otra, asi que el WHERE de la 2da seguia
 *     matcheando (`count: 1`), sobrescribiendo en silencio el cambio de
 *     la 1ra con datos derivados de su propia foto YA VIEJA (el mismo
 *     lost update que el punto (3) ya resolvia para cierres, pero sin
 *     cubrir ediciones que no tocan `estado`).
 *
 *     Correccion de ronda de revision (3ra vuelta, mismo punto) -- la
 *     2da vuelta agrego `updatedAt: actual.updatedAt` al WHERE, pero
 *     `updatedAt` es TIMESTAMP(3) (precision de milisegundo): 2
 *     escrituras que cayeran dentro del MISMO milisegundo no se
 *     distinguirian por ese mecanismo -- una ventana real, aunque mucho
 *     mas angosta que el hueco que la 2da vuelta ya habia cerrado. Se
 *     reemplaza por una columna dedicada, `version Int @default(1)`
 *     (prisma/schema.prisma), sin ninguna ventana de precision: el
 *     WHERE exige `version: actual.version` (en vez de `updatedAt`) y
 *     el UPDATE la incrementa en 1 con `version: { increment: 1 }`
 *     (nunca escribiendo un numero leido en memoria -- `{ increment: 1 }`
 *     es atomico en el propio UPDATE de Postgres, no una resta de 2
 *     lecturas). `updatedAt` se conserva sin ningun cambio como fecha
 *     de auditoria (Prisma sigue poniendola sola via `@updatedAt`), ya
 *     no se lee para decidir nada aca. */
export async function actualizarAccionDecisionKpi(
  cliente: TenantPrismaClient,
  id: string,
  cambios: DatosActualizarAccionDecisionKpi,
): Promise<ResultadoServicioAccion<AccionDecisionKpiFila>> {
  const accionesCliente = conAcciones(cliente);
  const actual = await accionesCliente.accionDecisionKpi.findUnique({ where: { id } });
  if (!actual) return { ok: false, error: "ACCION_INEXISTENTE" };

  const validacionModificable = validarAccionModificable(actual.estado);
  if (!validacionModificable.valido) {
    return { ok: false, error: "ACCION_FINALIZADA_INMUTABLE", detalle: validacionModificable.errores };
  }

  const estadoNuevo: EstadoAccionKpi = cambios.estado ?? actual.estado;

  // Defensa en profundidad -- con el guard de arriba, `actual.estado`
  // NUNCA es terminal en este punto, asi que esta validacion siempre da
  // ok() hoy (su unica rama de rechazo exige que estadoActual sea
  // terminal). Se conserva por si en el futuro se agrega un nuevo
  // estado terminal o una transicion restringida entre no-terminales --
  // y porque es la MISMA funcion que ya usa estadosSiguientesPosibles()
  // en la UI, sin otra copia que pueda divergir.
  const validacionTransicion = validarTransicionEstado(actual.estado, estadoNuevo);
  if (!validacionTransicion.valido) {
    return { ok: false, error: "TRANSICION_INVALIDA", detalle: validacionTransicion.errores };
  }

  const pasaATerminal = esEstadoTerminal(estadoNuevo);
  // `actual.estado` ya se sabe no-terminal (guard de arriba), asi que
  // `actual.finalizadaEn`/`actual.finalizadaPorId` son siempre null por
  // el invariante de validarFinalizacionConsistente() -- no hace falta
  // leerlos para la rama "sigue sin ser terminal".
  const finalizadaEn = pasaATerminal ? new Date() : null;
  const finalizadaPorId = pasaATerminal ? cambios.finalizadaPorId ?? null : null;

  if (pasaATerminal && !finalizadaPorId) {
    return {
      ok: false,
      error: "FALTA_FINALIZADA_POR",
      detalle: ["Pasar a un estado terminal exige finalizadaPorId (quien la cierra)."],
    };
  }

  const validacionFinalizacion = validarFinalizacionConsistente(estadoNuevo, finalizadaEn, finalizadaPorId);
  if (!validacionFinalizacion.valido) {
    return { ok: false, error: "FINALIZACION_INCONSISTENTE", detalle: validacionFinalizacion.errores };
  }

  // finalizadaPor y el nuevo responsable (si cambia) deben pertenecer a
  // la misma empresa que la accion -- mismo eje de defensa en
  // profundidad que crearAccionDecisionKpi(), ver validarTenantConsistente.
  if (pasaATerminal && finalizadaPorId) {
    const finalizadaPor = await cliente.usuario.findUnique({ where: { id: finalizadaPorId }, select: { id: true, empresaId: true } });
    if (!finalizadaPor) return { ok: false, error: "FINALIZADOR_INEXISTENTE" };
    if (finalizadaPor.empresaId !== actual.empresaId) {
      return {
        ok: false,
        error: "TENANT_INCONSISTENTE",
        detalle: ["Quien finaliza la accion debe pertenecer a la misma empresa que la accion."],
      };
    }
  }

  let nuevoResponsableId = actual.responsableId;
  if (cambios.responsableId && cambios.responsableId !== actual.responsableId) {
    const responsable = await cliente.usuario.findUnique({ where: { id: cambios.responsableId }, select: { id: true, empresaId: true } });
    if (!responsable) return { ok: false, error: "RESPONSABLE_INEXISTENTE" };
    if (responsable.empresaId !== actual.empresaId) {
      return {
        ok: false,
        error: "TENANT_INCONSISTENTE",
        detalle: ["El nuevo responsable debe pertenecer a la misma empresa que la accion."],
      };
    }
    nuevoResponsableId = cambios.responsableId;
  }

  // (3) UPDATE condicional -- `estado: actual.estado` Y `version:
  // actual.version` en el WHERE, ademas de `id`. `count === 0`
  // significa que, entre el findUnique() de arriba y este update, otro
  // proceso YA escribio sobre esta misma fila (haya cambiado `estado` o
  // no) -- la escritura NUNCA se aplica sobre una foto vieja. Solo
  // `estado` en el WHERE detectaba cierres concurrentes, pero dejaba
  // pasar 2 ediciones concurrentes que no tocan `estado` (lost update);
  // `version` (incrementada en CUALQUIER UPDATE exitoso, ver `data` mas
  // abajo) cierra ese hueco sin la ventana de precision de milisegundo
  // que `updatedAt` tenia (correccion de ronda de revision, 3ra vuelta
  // sobre este mismo punto).
  const resultadoUpdate = await accionesCliente.accionDecisionKpi.updateMany({
    where: { id, estado: actual.estado, version: actual.version },
    data: {
      estado: estadoNuevo,
      responsableId: nuevoResponsableId,
      fechaObjetivo: cambios.fechaObjetivo ?? actual.fechaObjetivo,
      descripcionAccion: cambios.descripcionAccion ?? actual.descripcionAccion,
      finalizadaEn,
      finalizadaPorId,
      // Incremento atomico de Postgres (nunca `actual.version + 1`
      // calculado en memoria -- eso reintroduciria el mismo TOCTOU que
      // esta transicion entera existe para evitar). `updatedAt` NO se
      // declara aca: Prisma la sigue poniendo sola via `@updatedAt` en
      // cada UPDATE, ahora solo como fecha de auditoria.
      version: { increment: 1 },
    },
  });

  if (resultadoUpdate.count === 0) {
    return {
      ok: false,
      error: "ACCION_MODIFICADA_CONCURRENTEMENTE",
      detalle: ["Otro proceso ya modificó el estado de esta acción -- recargá la página e intentá de nuevo."],
    };
  }

  const fila = await accionesCliente.accionDecisionKpi.findUnique({ where: { id } });
  if (!fila) {
    // Defensivo -- `id` ya existia hace un instante (el findUnique() de
    // arriba y el updateMany() de recien asi lo confirman); solo
    // llegaria aca si algo borrara la fila entre el updateMany() y este
    // findUnique(), una ventana de tiempo minima que este modelo no
    // expone hoy (sin flujo de borrado -- ver AccionDecisionKpi en
    // prisma/schema.prisma).
    return { ok: false, error: "ACCION_INEXISTENTE" };
  }

  return { ok: true, datos: fila };
}

/** Historial completo de acciones de UN origen (observacion de KPI o
 * importacion de Cobertura), mas antigua primero -- es la "historia" que
 * la UI muestra debajo del formulario de alta. */
export async function listarAccionesPorOrigen(
  cliente: TenantPrismaClient,
  origen: { observacionKpiId: string } | { importacionCsvId: string },
): Promise<AccionDecisionKpiFila[]> {
  const where = "observacionKpiId" in origen ? { observacionKpiId: origen.observacionKpiId } : { importacionCsvId: origen.importacionCsvId };
  return conAcciones(cliente).accionDecisionKpi.findMany({ where, orderBy: { createdAt: "asc" } });
}
