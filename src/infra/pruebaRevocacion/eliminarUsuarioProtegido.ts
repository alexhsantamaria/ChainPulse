// Infraestructura (solo para orquestarValidacion.ts, Escenario C) --
// punto 2 de la tercera correccion de Alex (2026-10-04): "Implementá
// protección concurrente explícita para comprobación y borrado, tanto
// en limpieza como en el escenario A3. Estar dentro de una transacción
// sin más no demuestra esa protección. Documentá el mecanismo
// elegido..." -- y CORREGIDO en la cuarta correccion (revision de la
// version d): el rol usado y el alcance real de la proteccion SERIALIZABLE.
//
// =====================================================================
// PARTE 1 -- POR QUE EL ROL IMPORTA (bug real encontrado en la version
// d, no hipotetico): esta funcion usaba prismaApp (DATABASE_URL, rol
// chainpulse_app) para TODO, incluido el chequeo de cascada cruzado de
// empresa que agrega importacionCsv.confirmadaPorId a la segunda
// categoria de relacionesCascada.ts ("incluso si la importación
// pertenece a otra empresa"). Eso es exactamente lo que Row-Level
// Security de Postgres oculta: confirmado leyendo las migraciones
// reales (prisma/migrations/20260924040000_.../migration.sql, linea
// 168-170):
//
//   ALTER TABLE "importaciones_csv" ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY tenant_isolation_importaciones_csv ON "importaciones_csv"
//     USING ("empresaId" = current_setting('app.tenant_id', true));
//
// Sin WITH CHECK explicito, esa misma condicion USING se aplica a TODAS
// las operaciones (SELECT incluido) para cualquier rol sujeto a RLS. Y
// "sujeto a RLS" es exactamente chainpulse_app: ninguna migracion de
// este repo declara FORCE ROW LEVEL SECURITY, asi que por default de
// Postgres el DUEÑO de la tabla queda EXENTO de sus propias politicas --
// y el dueño real es neondb_owner, no chainpulse_app: prisma/schema.prisma
// fija `directUrl = env("SEED_DATABASE_URL")` (neondb_owner) para que
// "prisma migrate deploy" cree las tablas con ESE rol como dueño, y cada
// migracion que agrega una tabla nueva otorga GRANT explicito a
// chainpulse_app aparte (confirmado: `GRANT SELECT, INSERT, UPDATE,
// DELETE ON "importaciones_csv", ... TO chainpulse_app;` en la misma
// migracion) -- un dueño nunca necesita que se le otorgue permiso sobre
// su propia tabla, so ese GRANT es la prueba de que chainpulse_app NO es
// el dueño.
//
// Consecuencia real: si esta funcion corre por chainpulse_app y fija
// app.tenant_id a la empresa de prueba (lo que hacia la version anterior
// para replicar la RLS de tenantClient()), CUALQUIER importacionCsv de
// OTRA empresa que referencie al usuario via confirmadaPorId queda
// INVISIBLE para el COUNT() del chequeo de cascada -- exactamente el
// caso cross-tenant que ese chequeo existe para atrapar. Fijar
// app.tenant_id a otro valor, o no fijarlo, NO soluciona nada: sin
// BYPASSRLS/ser-dueño, ninguna sesion de chainpulse_app puede ver mas
// alla de lo que la politica permite -- no hay forma de "ampliar" RLS
// desde el lado del cliente para un rol restringido.
//
// LA CORRECCION: esta funcion corre ahora por el rol ADMIN
// (SEED_DATABASE_URL/neondb_owner, dueño de las tablas) -- el MISMO rol
// que ya usa limpiarPruebaRevocacionAislada.ts/orquestarLimpieza.ts para
// este chequeo (que por eso SIEMPRE fue correcto en ese sentido: nunca
// tuvo este bug). Al ser el dueño, bypassea RLS por completo -- ya no
// hace falta replicar set_config('app.tenant_id', ...) para nada (se
// elimino esa llamada): no cambia que filas ve el dueño, y mantenerla
// hubiera sido confuso (sugiere que RLS todavia importa aca, cuando ya
// no).
//
// =====================================================================
// PARTE 2 -- EL MECANISMO DE PROTECCION CONCURRENTE, Y SU ALCANCE REAL
// (corregido -- la version anterior de este comentario sobrestimaba la
// garantia; Alex, revision de la version d: "esa garantía necesita
// justificación y validación específica").
//
// El nivel de aislamiento DEFAULT de Postgres es READ COMMITTED. Ahi,
// cada SENTENCIA dentro de una transaccion ve una instantanea fresca,
// pero eso NO protege una secuencia "leer para decidir, despues actuar"
// dentro de la MISMA transaccion frente a una transaccion CONCURRENTE
// que confirma algo entre el chequeo y el borrado.
//
// El mecanismo elegido es aislamiento SERIALIZABLE, que en Postgres
// activa SSI (Serializable Snapshot Isolation). CITA TEXTUAL de la
// documentacion oficial (postgresql.org/docs/current/transaction-iso.html,
// seccion 13.2.3, verificada 2026-10-04): "The guarantee that any set of
// successfully committed concurrent Serializable transactions will have
// the same effect as if they were run one at a time means that if you
// can demonstrate that a single transaction, as written, will do the
// right thing when run by itself, you can have confidence that it will
// do the right thing in any mix of Serializable transactions [...] or it
// will not successfully commit."
//
// La garantia esta explicitamente acotada a "any mix of SERIALIZABLE
// transactions" -- NO a "cualquier transaccion concurrente sin importar
// su nivel de aislamiento", como afirmaba (mal) la version anterior de
// este comentario. La razon tecnica: Postgres solo registra locks de
// prediccion (SIReadLock, visibles en pg_locks) para transacciones que
// corren a nivel SERIALIZABLE -- una transaccion READ COMMITTED o
// REPEATABLE READ nunca toma esos locks sobre lo que lee, asi que sus
// lecturas quedan invisibles para la deteccion de ciclos de SSI. Un
// ciclo detectable de dos transacciones (el patron de "write skew" de
// esta funcion: A lee X, B lee Y, B escribe X, A escribe Y) necesita que
// AMBOS lados tengan una lectura trackeada por SIReadLock -- es decir,
// que AMBAS transacciones corran SERIALIZABLE. Si una de las dos corre a
// un nivel mas bajo, el borde de conflicto que depende de SU lectura
// nunca se registra, el ciclo nunca se cierra, y Postgres no aborta
// nada.
//
// Por que esto importa ACA, especificamente: el escritor concurrente
// "real" mas probable contra el mismo usuario/importacion de prueba es
// otra operacion de la app corriendo por tenantClient() (ver
// src/infra/prisma/tenantClient.ts) -- y tenantClient() abre su
// transaccion con TX_OPTIONS_NEON (src/infra/prisma/tenantScope.ts),
// que fija maxWait/timeout pero NUNCA isolationLevel, asi que corre al
// default de Postgres: READ COMMITTED. Confirmado leyendo ambos archivos
// -- no es una suposicion.
//
// ALCANCE REAL de esta proteccion, honesto:
//   - SI protege: dos corridas CONCURRENTES de esta MISMA herramienta
//     (dos invocaciones de eliminarUsuarioConProteccionConcurrente(), o
//     esta funcion contra limpiarPruebaRevocacionAislada.ts corriendo al
//     mismo tiempo) -- ambos lados corren SERIALIZABLE, el ciclo SI se
//     puede detectar y Postgres aborta uno de los dos con
//     serialization_failure (40001).
//   - NO protege, por si sola, contra una escritura REAL concurrente de
//     la app via tenantClient() (p. ej. alguien confirmando una
//     importacion real mientras esto corre) -- esa transaccion es READ
//     COMMITTED, no deja lectura trackeada, y el ciclo nunca se cierra:
//     esta funcion podria borrar al usuario de prueba sin que Postgres
//     avise nada, aunque el chequeo de cascada (ahora correcto gracias
//     al rol admin) SI haya visto 0 filas en el instante en que corrio.
//   - La mitigacion real para ese segundo caso es OPERATIVA, no de
//     aislamiento: esta herramienta solo corre contra un destino
//     explicitamente confirmado como entorno de prueba
//     (exigirEntornoConfirmado/verificarDestinoEfectivo) -- el unico
//     trafico "real" de tenantClient() que deberia existir ahi es de
//     OTRAS pruebas, nunca produccion. Sigue siendo una ventana de
//     riesgo real si ese entorno de prueba recibe trafico concurrente de
//     otro tipo (p. ej. otra persona probando la app a mano contra la
//     misma base) -- esta correccion NO cierra esa ventana, la deja
//     documentada en vez de darla por resuelta.
//
// Nota sobre reintentos: un serialization_failure real (cuando SI se
// detecta) es una senal de EXITO del mecanismo, no un bug -- la
// transaccion en conflicto simplemente no se aplico. Esta version NO
// implementa un reintento automatico (fuera de alcance); se propaga como
// el mismo codigo fijo que cualquier otro fallo de esta transaccion,
// dejando el manifiesto intacto para que quien corrio la validacion
// decida si reintentar.
//
// Por que no tenantClient(): tenantClient() envuelve CADA llamada
// individual en su PROPIA transaccion de Prisma separada
// ($allOperations hace su propio $transaction por operacion) -- no hay
// forma de pedirle que la cascada y el borrado compartan una. Esta
// funcion usa en cambio un PrismaClient crudo (admin, construido via
// construirClientePrueba) y abre su propia $transaction SERIALIZABLE
// explicita.
import { logError } from "../log";
import { verificarSinDatosRelacionadosInesperados } from "./relacionesCascada";
import type { ClientePrueba } from "./clientePrueba";

// "Serializable" como string literal, NUNCA Prisma.TransactionIsolation
// Level.Serializable: ese enum lo genera "prisma generate" a partir del
// schema, y esta sesion no puede correrlo (red bloqueada -- misma nota
// que en tenantClient.ts). Confirmado (node -e) que en este entorno
// "@prisma/client" sin generar expone Prisma.TransactionIsolationLevel
// como undefined -- usar el string evita ese riesgo por completo. Es
// ademas exactamente el mismo valor en runtime: el enum generado por
// Prisma para TransactionIsolationLevel mapea cada clave a si misma
// como string ({ Serializable: "Serializable", ... }), nunca a un
// valor numerico u opaco, asi que no hay perdida de fidelidad.
export const NIVEL_AISLAMIENTO_SERIALIZABLE = "Serializable" as const;

export interface ClienteEliminarUsuarioProtegido {
  // No generica a proposito: esta funcion siempre usa la transaccion
  // para un efecto (Promise<void>), nunca para devolver un valor --
  // mantenerla simple evita problemas de varianza al tipar los mocks de
  // las pruebas (y los de orquestarValidacion.ts, que reusa este mismo
  // cliente). Debe ser el cliente ADMIN (SEED_DATABASE_URL/neondb_owner)
  // -- ver la PARTE 1 del comentario de cabecera: nunca el cliente app,
  // que por RLS no puede ver referencias de otra empresa.
  $transaction(
    fn: (tx: ClientePrueba) => Promise<void>,
    opciones: { isolationLevel: typeof NIVEL_AISLAMIENTO_SERIALIZABLE },
  ): Promise<void>;
}

/**
 * Borra UN usuario de prueba (Escenario C: A3) con proteccion EXPLICITA
 * frente a cambios concurrentes -- ver el comentario de cabecera de este
 * archivo para el mecanismo completo (rol admin para que el chequeo de
 * cascada vea referencias de otra empresa a pesar de RLS; SERIALIZABLE
 * para la proteccion concurrente, y su alcance real).
 */
export async function eliminarUsuarioConProteccionConcurrente(
  clienteAdmin: ClienteEliminarUsuarioProtegido,
  empresaId: string,
  usuarioId: string,
  contexto: string,
): Promise<void> {
  try {
    await clienteAdmin.$transaction(
      async (tx) => {
        // Sin set_config('app.tenant_id', ...) a proposito: el cliente
        // ADMIN bypassea RLS por ser dueño de las tablas (ver PARTE 1) --
        // fijar esa variable de sesion no cambiaria nada para este rol,
        // y mantenerla hubiera sugerido (de forma incorrecta) que RLS
        // sigue acotando lo que esta transaccion puede ver.
        await verificarSinDatosRelacionadosInesperados(tx, empresaId, [usuarioId], contexto);

        const resultado = await tx.usuario.deleteMany({ where: { id: usuarioId, empresaId } });
        if (resultado.count !== 1) {
          throw new Error("USUARIO_NO_ENCONTRADO_AL_BORRAR");
        }
      },
      { isolationLevel: NIVEL_AISLAMIENTO_SERIALIZABLE },
    );
  } catch {
    // catch SIN binding -- mismo criterio que orquestarLimpieza.ts:
    // CUALQUIER fallo dentro de esta transaccion (cascada encontrada, el
    // usuario ya no estaba, un serialization_failure real de Postgres,
    // un error de conexion) se colapsa en UN codigo fijo. Se pierde la
    // distincion entre esos casos aca, pero es exactamente el mismo
    // trade-off ya aceptado para ERROR_TRANSACCION_LIMPIEZA -- el
    // detalle real queda en el log de Postgres del lado del servidor,
    // nunca en lo que este proceso imprime o relanza.
    logError(contexto, "ERROR_ELIMINACION_PROTEGIDA_ESCENARIO_C");
    throw new Error("ERROR_ELIMINACION_PROTEGIDA_ESCENARIO_C");
  }
}
