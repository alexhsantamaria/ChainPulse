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
// desconectarClientePrueba, resumenUrl, destinoConfirmado,
// exigirEntornoConfirmado, verificarRolConexionAdministrativa,
// ROL_ADMIN_ESPERADO.
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
import { construirClientePrueba, desconectarClientePrueba } from "../../src/infra/pruebaRevocacion/clientePrueba";
import {
  ROL_ADMIN_ESPERADO,
  destinoConfirmado,
  exigirEntornoConfirmado,
  resumenUrl,
  verificarDestinoEfectivo,
  verificarRolConexionAdministrativa,
} from "../../src/infra/pruebaRevocacion/destinoPrueba";

// Forma esperada, documentada en §7.9 -- la UNICA fuente de verdad es
// src/infra/rf20/erroresPublicacion.ts; estas dos constantes se repiten
// aqui SOLO como el valor contra el que se compara, nunca para
// reimplementar la deteccion real.
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

function camposCoinciden(recibidos: unknown, esperados: string[]): boolean {
  if (!Array.isArray(recibidos) || !recibidos.every((c) => typeof c === "string")) return false;
  return JSON.stringify([...recibidos].sort()) === JSON.stringify([...esperados].sort());
}

function extraerCampos(error: unknown): unknown {
  return (error as { meta?: { constraint?: { fields?: unknown } } })?.meta?.constraint?.fields;
}

function esP2002(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "P2002";
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

    // Paso 6 -- comparar contra lo documentado en §7.9, explicitamente.
    console.log("");
    console.log("=== Resultado de la calibracion ===");

    const campos1 = extraerCampos(errorCodigoNumero);
    const ok1 = esP2002(errorCodigoNumero) && camposCoinciden(campos1, CAMPOS_UNIQUE_CODIGO_NUMERO);
    console.log(
      `(codigo, numero): code=${esP2002(errorCodigoNumero) ? "P2002" : "DISTINTO_DE_P2002"} fields=${JSON.stringify(campos1 ?? null)} -- ${
        ok1 ? "COINCIDE con §7.9" : "NO COINCIDE con §7.9 -- revisar erroresPublicacion.ts antes de confiar en el extractor"
      }`,
    );

    const campos2 = extraerCampos(errorIndiceParcial);
    const ok2 = esP2002(errorIndiceParcial) && camposCoinciden(campos2, CAMPOS_INDICE_PARCIAL_PUBLICACION);
    console.log(
      `indice parcial (codigo): code=${esP2002(errorIndiceParcial) ? "P2002" : "DISTINTO_DE_P2002"} fields=${JSON.stringify(campos2 ?? null)} -- ${
        ok2 ? "COINCIDE con §7.9" : "NO COINCIDE con §7.9 -- revisar erroresPublicacion.ts antes de confiar en el extractor"
      }`,
    );

    if (!ok1 || !ok2) {
      process.exitCode = 1;
    }
  } finally {
    // Paso 7 (implicito) -- nunca toca la rama principal: esto corre
    // exclusivamente contra la rama temporal ya verificada arriba.
    // Limpieza best-effort de las filas de calibracion -- un fallo aqui
    // no debe tapar el resultado real ya impreso.
    for (const id of idsInsertados) {
      try {
        await cliente.$executeRaw`DELETE FROM public.cuestionario_versiones WHERE id = ${id}`;
      } catch {
        console.error(`No se pudo limpiar la fila de calibracion ${id} -- revisar manualmente en la rama temporal.`);
      }
    }
    await desconectarClientePrueba(cliente, "calibrarExtractor23505");
  }
}

main().catch((err) => {
  console.error(`Calibracion abortada -- ${etiquetaSegura(err)}. No se registró el detalle crudo del error.`);
  process.exit(1);
});
