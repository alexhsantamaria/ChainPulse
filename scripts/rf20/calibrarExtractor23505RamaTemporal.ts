// RF20 §7.10 — Calibracion del extractor de 23505 (src/infra/rf20/
// erroresPublicacion.ts) EXCLUSIVAMENTE sobre una rama temporal de Neon,
// con el rol neondb_owner, bajo DOBLE autorizacion explicita, nunca con
// la credencial de aplicacion.
//
// *** PENDIENTE DE AUTORIZACION -- NO SE EJECUTA COMO PARTE DE ESTE PR,
// NI DE NINGUNA REVISION AUTOMATIZADA. Este archivo se entrega preparado
// para que Alex lo corra manualmente, desde su clon con red real a
// Neon, el dia que decida autorizar esta calibracion puntualmente. ***
//
// CORREGIDO (ronda de calibracion que motivo esta correccion): la
// version anterior de este script reportaba code==="P2002" vs
// "DISTINTO_DE_P2002" y leia fields desde meta.constraint.fields --
// ambas colisiones reales resultaron "DISTINTO_DE_P2002" con
// fields=null, confirmando que esa forma asumida nunca aplica a
// $queryRaw (ver erroresPublicacion.ts para el analisis completo).
// Ahora este script: (a) nunca imprime mas que la estructura SEGURA del
// error (ver volcarEstructuraSeguraError.ts -- jamas mensaje SQL,
// consulta, parametros ni credenciales), y (b) en vez de reimplementar
// una comparacion paralela a esViolacionIndiceParcialPublicacion(), la
// IMPORTA y la llama directamente contra los dos errores reales
// capturados -- asi la calibracion prueba la funcion real, no una copia
// que podria desincronizarse de ella.
//
// Por que hace falta insertar DIRECTO en cuestionario_versiones (sin
// pasar por crear_cuestionario_version()): esa funcion SECURITY DEFINER
// jamas deja que dos filas compartan (codigo, numero) -- el
// pg_advisory_xact_lock(hashtext(codigo)) serializa cualquier intento
// concurrente -- asi que no hay forma de disparar la colision real
// 23505 de @@unique([codigo, numero]) pasando por la ruta gobernada.
// chainpulse_app tampoco tiene INSERT directo sobre la tabla (§4.1) --
// de ahi la credencial neondb_owner.
//
// Reutiliza, sin modificarla, la infraestructura generica ya fusionada
// en src/infra/pruebaRevocacion/ (mismo modulo que ya usa
// scripts/rf20RamaTemporalNeonRunbook.ts para RF20): construirClientePrueba,
// resumenUrl, destinoConfirmado, exigirEntornoConfirmado,
// verificarRolConexionAdministrativa. NO se reutiliza
// desconectarClientePrueba() de ese mismo modulo para la desconexion
// final -- esa funcion es deliberadamente best-effort y muda (nunca
// senaliza si la desconexion fallo, por diseno, para otros scripts que
// no necesitan saberlo); ESTE script si necesita saberlo (ver
// desconectarConSenalDeFallo() mas abajo, ronda de revision que exige
// codigo de salida distinto de cero si la desconexion falla).
//
// Variables de entorno exigidas (ninguna tiene valor por defecto; el
// script aborta ANTES de conectarse a nada si falta cualquiera):
//   DATABASE_URL                            -- credencial de aplicacion (chainpulse_app), SOLO para comparar su destino contra el administrativo (nunca se usa para leer ni escribir).
//   DATABASE_URL_NEONDB_OWNER_RAMA_TEMPORAL  -- credencial neondb_owner de la RAMA TEMPORAL (nunca produccion).
//   NEON_RAMA_TEMPORAL_HOST_CONFIRMADO       -- hostname exacto de la rama temporal, confirmado a mano (mismo nombre ya usado por rf20RamaTemporalNeonRunbook.ts).
//   NEON_PRODUCCION_HOST_BLOQUEADO           -- hostname exacto de produccion, para poder rechazar explicitamente si coincide.
//   ENTORNO_PRUEBA_CONFIRMADO                -- destinoConfirmado() exacto del destino administrativo resuelto (host:puerto/base?schema=esquema).
//   AUTORIZO_RF20_CALIBRACION_EXTRACTOR_23505 = "si" -- SEGUNDA autorizacion, distinta de ENTORNO_PRUEBA_CONFIRMADO, especifica de esta accion (nunca se reutiliza AUTORIZO_RF20_RAMA_TEMPORAL de otro script).
//
// Uso (solo cuando Alex decida correrlo):
//   DATABASE_URL=... DATABASE_URL_NEONDB_OWNER_RAMA_TEMPORAL=... \
//   NEON_RAMA_TEMPORAL_HOST_CONFIRMADO=... NEON_PRODUCCION_HOST_BLOQUEADO=... \
//   ENTORNO_PRUEBA_CONFIRMADO=... AUTORIZO_RF20_CALIBRACION_EXTRACTOR_23505=si \
//     npx tsx scripts/rf20/calibrarExtractor23505RamaTemporal.ts
import "../_cargarEnv";
import { generarCuid } from "../../src/infra/ids/cuid";
import { etiquetaSegura } from "../../src/infra/auth/etiquetaErrorSegura";
import { logError } from "../../src/infra/log";
import { esViolacionIndiceParcialPublicacion } from "../../src/infra/rf20/erroresPublicacion";
import { volcarEstructuraSeguraError } from "../../src/infra/rf20/volcarEstructuraSeguraError";
import { type ClientePrueba, construirClientePrueba } from "../../src/infra/pruebaRevocacion/clientePrueba";
import {
  ROL_ADMIN_ESPERADO,
  destinoConfirmado,
  exigirEntornoConfirmado,
  resumenUrl,
  verificarDestinoEfectivo,
  verificarRolConexionAdministrativa,
} from "../../src/infra/pruebaRevocacion/destinoPrueba";

// Documentado en §7.9 -- SOLO para la comparacion diagnostica de
// camposRealesObservados() mas abajo (confirmar que la calibracion
// disparo la restriccion esperada en cada paso). Nunca se usa para
// decidir el veredicto de la funcion bajo prueba: ese veredicto viene
// EXCLUSIVAMENTE de llamar a esViolacionIndiceParcialPublicacion() real,
// importada arriba.
const CAMPOS_UNIQUE_CODIGO_NUMERO = ["codigo", "numero"];
const CAMPOS_INDICE_PARCIAL_PUBLICACION = ["codigo"];

function normalizarHostNeon(host: string): string {
  return host.toLowerCase().replace("-pooler.", ".");
}

/**
 * Mismo criterio de aislamiento que exigirAislamiento() en
 * rf20RamaTemporalNeonRunbook.ts (no exportado desde ahi -- se repite
 * aqui, deliberadamente, como una funcion local pequeña y auditable, en
 * vez de depender de un detalle interno de otro script).
 */
function exigirAislamientoRamaTemporal(host: string): void {
  const temporal = process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO;
  const produccion = process.env.NEON_PRODUCCION_HOST_BLOQUEADO;
  if (!temporal) throw new Error("HOST_TEMPORAL_NO_CONFIRMADO");
  if (temporal !== host) throw new Error("HOST_TEMPORAL_NO_COINCIDE");
  if (!produccion) throw new Error("HOST_PRODUCCION_NO_DECLARADO");
  if (normalizarHostNeon(host) === normalizarHostNeon(produccion)) throw new Error("DESTINO_ES_PRODUCCION");
  if (host.toLowerCase().includes("-pooler.")) throw new Error("CONEXION_TEMPORAL_DEBE_SER_DIRECTA");
}

function exigirSegundaAutorizacion(): void {
  if (process.env.AUTORIZO_RF20_CALIBRACION_EXTRACTOR_23505 !== "si") {
    throw new Error("AUTORIZACION_CALIBRACION_FALTANTE");
  }
}

function camposCoincidenDiagnostico(recibidos: unknown, esperados: string[]): boolean {
  if (!Array.isArray(recibidos) || !recibidos.every((c) => typeof c === "string")) return false;
  return JSON.stringify([...recibidos].sort()) === JSON.stringify([...esperados].sort());
}

/**
 * SOLO para el mensaje diagnostico (requisito §7.9: confirmar que la
 * calibracion disparo la restriccion esperada) -- lee la forma REAL
 * ($queryRaw -> meta.driverAdapterError.cause.constraint.fields) a
 * traves del volcado seguro, nunca accediendo al error crudo
 * directamente. Null si esa ruta no esta presente (p.ej. porque el
 * error observado tuviera, en el futuro, la forma clasica P2002 --
 * ese caso ya queda cubierto por esViolacionIndiceParcialPublicacion()
 * en el veredicto real, mas abajo).
 */
function camposRealesObservados(error: unknown): string[] | null {
  return volcarEstructuraSeguraError(error).meta?.driverAdapterError?.causa?.constraint?.fields ?? null;
}

export async function filaCalibracionSiguePresente(cliente: ClientePrueba, id: string): Promise<boolean> {
  const filas = await cliente.$queryRaw<{ existe: number }[]>`
    SELECT 1 AS existe FROM public.cuestionario_versiones WHERE id = ${id} LIMIT 1
  `;
  return Array.isArray(filas) && filas.length > 0;
}

/**
 * Requisito §7.10.5 -- endurecer la limpieza con VERIFICACION por ID:
 * nunca asume que el DELETE tuvo exito solo porque no lanzo (p.ej. un
 * proxy/pooler que confirma antes de aplicar, o una desconexion a
 * mitad de la operacion). DELETE y verificacion van en su propio
 * try/catch cada uno -- un fallo en cualquiera de los dos no debe
 * tapar el resultado real de la calibracion, ya impreso antes de
 * llegar aqui -- y se reintenta hasta `intentosMaximos` veces (mismo
 * patron ya validado para la limpieza de actores de prueba en el
 * arnes E2E de esta misma iniciativa). Nunca lanza: devuelve
 * true/false para que el caller decida como reportarlo -- el caller
 * (main(), mas abajo) exige ademas que un false deje el script con un
 * codigo de salida distinto de cero: nunca debe poder terminar
 * exitosamente dejando una fila de calibracion sin eliminacion
 * confirmada.
 *
 * `delayMs` (ultimo parametro, con el mismo default de siempre) existe
 * SOLO para que las pruebas unitarias de abajo puedan correr sin
 * esperar los reintentos reales -- nunca se pasa un valor distinto del
 * default en el uso real del script.
 */
export async function borrarFilaCalibracionConVerificacion(
  cliente: ClientePrueba,
  id: string,
  intentosMaximos = 3,
  delayMs = 100,
): Promise<boolean> {
  for (let intento = 1; intento <= intentosMaximos; intento++) {
    try {
      await cliente.$executeRaw`DELETE FROM public.cuestionario_versiones WHERE id = ${id}`;
    } catch {
      // No se asume fallo definitivo todavia -- la verificacion de abajo decide.
    }
    try {
      const siguePresente = await filaCalibracionSiguePresente(cliente, id);
      if (!siguePresente) return true;
    } catch {
      // Tampoco se asume exito -- se reintenta igual que si el DELETE hubiera fallado.
    }
    if (intento < intentosMaximos) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

/**
 * Desconexion del cliente administrativo (neondb_owner), en su PROPIO
 * try/catch, independiente de la limpieza de filas de arriba.
 *
 * Deliberadamente NO se reutiliza desconectarClientePrueba()
 * (src/infra/pruebaRevocacion/clientePrueba.ts): esa funcion es
 * best-effort y muda a proposito -- nunca lanza, nunca devuelve una
 * senal de si la desconexion fallo -- por diseno, pensada para
 * scripts donde un fallo de desconexion nunca debe afectar el codigo
 * de salida. ESTE script si necesita saberlo (ronda de revision: "su
 * fallo debe producir codigo distinto de cero sin ocultar el
 * resultado de calibracion"), asi que se repite aqui, deliberadamente,
 * la misma logica de logging seguro que usa esa funcion (logError()
 * con un STRING FIJO como "error", nunca el objeto de error crudo --
 * que podria traer la cadena de conexion), pero devolviendo
 * true/false en vez de tragarse el resultado.
 */
export async function desconectarConSenalDeFallo(cliente: ClientePrueba, contexto: string): Promise<boolean> {
  try {
    await cliente.$disconnect();
    return true;
  } catch {
    logError(contexto, "ERROR_DESCONEXION_CLIENTE");
    return false;
  }
}

async function main() {
  const databaseUrlApp = process.env.DATABASE_URL;
  const databaseUrlAdmin = process.env.DATABASE_URL_NEONDB_OWNER_RAMA_TEMPORAL;
  if (!databaseUrlApp) throw new Error("FALTA_DATABASE_URL");
  if (!databaseUrlAdmin) throw new Error("FALTA_DATABASE_URL_NEONDB_OWNER_RAMA_TEMPORAL");

  // Paso 1 -- mismo destino (host/puerto/base) entre la credencial de
  // aplicacion y la administrativa, y ese destino es una rama temporal,
  // nunca la principal.
  const destinoApp = resumenUrl("DATABASE_URL", databaseUrlApp);
  const destinoAdmin = resumenUrl("DATABASE_URL_NEONDB_OWNER_RAMA_TEMPORAL", databaseUrlAdmin);
  if (destinoApp.host !== destinoAdmin.host || destinoApp.puerto !== destinoAdmin.puerto || destinoApp.base !== destinoAdmin.base) {
    throw new Error("DESTINOS_NO_COINCIDEN_ENTRE_CREDENCIALES");
  }
  exigirAislamientoRamaTemporal(destinoAdmin.host);

  // Paso 2 -- confirmacion explicita del destino exacto (infra generica
  // ya fusionada, sin modificar).
  exigirEntornoConfirmado(destinoAdmin);

  // Paso 3 -- segunda autorizacion, DISTINTA de ENTORNO_PRUEBA_CONFIRMADO,
  // especifica de esta accion.
  exigirSegundaAutorizacion();

  console.log(`Destino confirmado: ${destinoConfirmado(destinoAdmin)} (rama temporal -- nunca produccion).`);
  console.log("Las dos autorizaciones (destino + accion especifica) y el aislamiento de produccion ya se verificaron. Conectando con neondb_owner...");

  // Paso 4 -- conectar EXCLUSIVAMENTE con neondb_owner.
  const cliente = construirClientePrueba(databaseUrlAdmin, "calibrarExtractor23505");
  const idsInsertados: string[] = [];
  try {
    const veredicto = await verificarRolConexionAdministrativa(cliente, "calibrarExtractor23505", ROL_ADMIN_ESPERADO);
    verificarDestinoEfectivo(veredicto, destinoAdmin, "calibrarExtractor23505");
    console.log(`Rol efectivo confirmado: ${veredicto.usuarioActual} (esperado: ${ROL_ADMIN_ESPERADO}).`);

    const codigoBase = `rf20-calibracion-extractor-${Date.now()}`;

    // Paso 5a -- colision real de @@unique([codigo, numero]): dos filas,
    // mismo codigo Y mismo numero. INSERT crudo, sin pasar por ninguna
    // funcion SECURITY DEFINER.
    const idA1 = generarCuid();
    idsInsertados.push(idA1);
    await cliente.$executeRaw`
      INSERT INTO public.cuestionario_versiones (id, codigo, numero, estado)
      VALUES (${idA1}, ${codigoBase}, 1, 'BORRADOR')
    `;
    let errorCodigoNumero: unknown = null;
    try {
      const idA2 = generarCuid();
      idsInsertados.push(idA2);
      await cliente.$executeRaw`
        INSERT INTO public.cuestionario_versiones (id, codigo, numero, estado)
        VALUES (${idA2}, ${codigoBase}, 1, 'BORRADOR')
      `;
      throw new Error("COLISION_CODIGO_NUMERO_NO_SE_DISPARO");
    } catch (err) {
      if (err instanceof Error && err.message === "COLISION_CODIGO_NUMERO_NO_SE_DISPARO") throw err;
      errorCodigoNumero = err;
    }

    // Paso 5b -- colision real del indice parcial
    // uq_cuestionario_version_publicada: dos filas, mismo codigo,
    // estado='PUBLICADA', numero DISTINTO (para no volver a disparar la
    // colision del paso 5a).
    const idB1 = generarCuid();
    idsInsertados.push(idB1);
    await cliente.$executeRaw`
      INSERT INTO public.cuestionario_versiones (id, codigo, numero, estado)
      VALUES (${idB1}, ${codigoBase}, 2, 'PUBLICADA')
    `;
    let errorIndiceParcial: unknown = null;
    try {
      const idB2 = generarCuid();
      idsInsertados.push(idB2);
      await cliente.$executeRaw`
        INSERT INTO public.cuestionario_versiones (id, codigo, numero, estado)
        VALUES (${idB2}, ${codigoBase}, 3, 'PUBLICADA')
      `;
      throw new Error("COLISION_INDICE_PARCIAL_NO_SE_DISPARO");
    } catch (err) {
      if (err instanceof Error && err.message === "COLISION_INDICE_PARCIAL_NO_SE_DISPARO") throw err;
      errorIndiceParcial = err;
    }

    // Paso 6 -- comparar contra lo documentado en §7.9, explicitamente,
    // y reportar EXCLUSIVAMENTE la estructura segura de cada error
    // (nunca mensaje SQL, consulta, parametros ni credenciales --
    // ver volcarEstructuraSeguraError.ts).
    console.log("");
    console.log("=== Resultado de la calibracion ===");
    console.log("(La estructura impresa abajo es un volcado SEGURO por allowlist -- nunca incluye message/detail/hint/consulta/parametros.)");

    const camposA = camposRealesObservados(errorCodigoNumero);
    const formaEsperadaA = camposCoincidenDiagnostico(camposA, CAMPOS_UNIQUE_CODIGO_NUMERO);
    const veredictoA = esViolacionIndiceParcialPublicacion(errorCodigoNumero);
    console.log("");
    console.log("--- (codigo, numero) -- restriccion ORDINARIA, no el indice parcial ---");
    console.log(`Estructura segura: ${JSON.stringify(volcarEstructuraSeguraError(errorCodigoNumero))}`);
    console.log(
      `Forma observada ${formaEsperadaA ? "COINCIDE" : "NO COINCIDE"} con la documentada en §7.9 para esta restriccion (fields=${JSON.stringify(camposA)}).`,
    );
    console.log(
      `esViolacionIndiceParcialPublicacion() devuelve ${veredictoA} -- esperado FALSE (esta NO es la colision del indice parcial) -- ${
        veredictoA === false ? "CORRECTO" : "INCORRECTO: revisar erroresPublicacion.ts, esta esperando distinguir esta restriccion de la del indice parcial"
      }.`,
    );

    const camposB = camposRealesObservados(errorIndiceParcial);
    const formaEsperadaB = camposCoincidenDiagnostico(camposB, CAMPOS_INDICE_PARCIAL_PUBLICACION);
    const veredictoB = esViolacionIndiceParcialPublicacion(errorIndiceParcial);
    console.log("");
    console.log("--- indice parcial uq_cuestionario_version_publicada (codigo) ---");
    console.log(`Estructura segura: ${JSON.stringify(volcarEstructuraSeguraError(errorIndiceParcial))}`);
    console.log(
      `Forma observada ${formaEsperadaB ? "COINCIDE" : "NO COINCIDE"} con la documentada en §7.9 para esta restriccion (fields=${JSON.stringify(camposB)}).`,
    );
    console.log(
      `esViolacionIndiceParcialPublicacion() devuelve ${veredictoB} -- esperado TRUE -- ${
        veredictoB === true ? "CORRECTO" : "INCORRECTO: revisar erroresPublicacion.ts, no esta reconociendo la colision real del indice parcial"
      }.`,
    );

    if (!formaEsperadaA || !formaEsperadaB || veredictoA !== false || veredictoB !== true) {
      process.exitCode = 1;
    }
  } finally {
    // Paso 7 (implicito) -- nunca toca la rama principal: esto corre
    // exclusivamente contra la rama temporal ya verificada arriba.
    // Limpieza de las filas de calibracion, CON verificacion por ID
    // (requisito §7.10.5) -- ver borrarFilaCalibracionConVerificacion().
    // Un fallo aqui no debe tapar el resultado real ya impreso arriba.
    const idsNoConfirmados: string[] = [];
    for (const id of idsInsertados) {
      const borradaYConfirmada = await borrarFilaCalibracionConVerificacion(cliente, id);
      if (!borradaYConfirmada) idsNoConfirmados.push(id);
    }
    if (idsNoConfirmados.length > 0) {
      console.error(
        `No se pudo CONFIRMAR por ID la eliminacion de ${idsNoConfirmados.length} fila(s) de calibracion tras los reintentos -- revisar manualmente en la rama temporal. IDs: ${idsNoConfirmados.join(", ")}`,
      );
      // Ronda de revision: nunca debe terminar exitosamente dejando
      // filas de calibracion sin eliminacion confirmada -- un codigo
      // de salida en 0 se leeria como "todo quedo limpio".
      process.exitCode = 1;
    } else if (idsInsertados.length > 0) {
      console.log(`Limpieza confirmada por ID para las ${idsInsertados.length} filas de calibracion insertadas.`);
    }

    // Desconexion -- en su PROPIO try/catch, independiente de la
    // limpieza de arriba (ver desconectarConSenalDeFallo()). Un fallo
    // aqui tampoco debe tapar ni reemplazar el resultado de la
    // calibracion ni el de la limpieza, ya impresos arriba -- pero SI
    // debe dejar el script con un codigo de salida distinto de cero.
    const desconexionConfirmada = await desconectarConSenalDeFallo(cliente, "calibrarExtractor23505");
    if (!desconexionConfirmada) {
      console.error(
        "No se pudo confirmar la desconexion del cliente administrativo (neondb_owner) -- revisar manualmente si la conexion quedo abierta en la rama temporal.",
      );
      process.exitCode = 1;
    }
  }
}

// Guard (mismo patron ya establecido en
// scripts/rf19/restablecer-mfa-plataforma-mantenimiento.ts): este
// archivo ahora exporta funciones para las pruebas focalizadas de
// scripts/rf20/__tests__/, y un import de ES modules ejecuta el cuerpo
// entero del modulo -- sin este guard, cada corrida de pruebas
// dispararia main() de verdad (exigiria DATABASE_URL/etc. por
// variables de entorno inexistentes en la corrida de pruebas, y
// llamaria a process.exit(1) de verdad). Vitest define
// process.env.VITEST="true" automaticamente; fuera de pruebas
// (invocacion real con `npx tsx`) esa variable nunca existe, asi que
// el comportamiento de produccion de este script no cambia en nada.
if (process.env.VITEST !== "true") {
  main().catch((err) => {
    console.error(`Calibracion abortada -- ${etiquetaSegura(err)}. No se registró el detalle crudo del error.`);
    process.exit(1);
  });
}
