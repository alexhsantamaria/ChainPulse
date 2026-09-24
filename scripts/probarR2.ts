import "./_cargarEnv";
// Script de un solo uso — prueba de integracion MANUAL del cliente real de
// R2 (Incremento 4 Bloque B, ADR-0006/docs/ADR/0006-cifrado-r2.md). Pedido
// explicito de Alex (2026-09-24): validar cifrar+subir+descargar+descifrar
// contra R2 real, mas el rechazo por empresa/importacion incorrectas, con
// limpieza del objeto de prueba y sin imprimir ningun secreto. Ampliado el
// mismo dia (segunda ronda, tras la primera corrida exitosa en Windows)
// para validar tambien la CLAVE MAESTRA configurada de verdad
// (R2_ENCRYPTION_KEY_ACTIVA/_ID) envolviendo/desenvolviendo la DEK real, y
// para probar el rechazo por importId incorrecto como caso SEPARADO del de
// empresaId incorrecto (antes solo se probaba empresa).
//
// SOLO corre contra un bucket cuyo nombre contenga "dev" (case-insensitive)
// -- la convencion ya fijada en PLAN-DE-TRABAJO.md (Setup de R2) es
// chainpulse-imports-dev / chainpulse-imports-prod. Si tu bucket de
// desarrollo tiene otro nombre, pasa --forzar explicitamente.
//
// Que hace, todo contra R2 real (nunca contra Postgres/Neon -- no necesita
// DATABASE_URL):
//   1. Cifra un CSV FICTICIO (contenido de prueba, nunca datos reales) con
//      una DEK nueva y empresaId/importId de prueba.
//   2. Lo sube con ClienteAlmacenamientoR2.subirObjeto().
//   3. Lo descarga con descargarObjeto().
//   4. Lo descifra y compara BYTE A BYTE contra el contenido original.
//   5. Intenta descifrar el MISMO objeto declarando una EMPRESA distinta a
//      la que se uso para cifrar -- por AAD (ver cifradoObjeto.ts) esto
//      DEBE lanzar.
//   6. Intenta descifrar el MISMO objeto declarando un IMPORTID distinto
//      (misma empresa correcta) -- tambien DEBE lanzar, caso separado del
//      punto 5: antes solo se probaba empresa, la importacion incorrecta
//      con empresa correcta no estaba cubierta contra R2 real.
//   7. Lee la clave maestra ACTIVA configurada de verdad
//      (R2_ENCRYPTION_KEY_ACTIVA/_ID, obtenerClaveMaestraActiva()) --
//      falla con un mensaje claro si no esta configurada, en vez de un
//      error críptico mas abajo.
//   8. Envuelve la DEK real (la misma que cifro el contenido en el paso 1)
//      con esa clave maestra real, la desenvuelve, y confirma que es
//      BYTE A BYTE igual a la DEK original -- valida que el envoltorio de
//      produccion (no un caso de prueba aislado) funciona de punta a
//      punta.
//   9. Igual que 5/6 pero sobre el ENVOLTORIO de la DEK: desenvolver
//      declarando empresa o importId incorrectos debe lanzar.
//  10. Borra el objeto de prueba, SIEMPRE (try/finally) -- nunca deja
//      basura en el bucket, incluso si un paso anterior fallo.
//
// Nunca imprime valores de variables de entorno (ni las credenciales de R2
// ni la clave de cifrado) -- solo nombres de variable, el id de la clave
// maestra activa (no es secreto, es un identificador elegido por Alex), el
// nombre del bucket (no es secreto) y resultados OK/FALLO de cada paso.
//
// Uso:
//   npm run r2:probar
//   npm run r2:probar -- --forzar   (si tu bucket dev no tiene "dev" en el nombre)
import { ClienteAlmacenamientoR2 } from "../src/infra/storage/r2";
import { construirClaveObjetoCifrado } from "../src/infra/storage/almacenamiento";
import {
  cifrarContenido,
  descifrarContenido,
  desenvolverDek,
  envolverDek,
  generarDek,
  obtenerClaveMaestraActiva,
} from "../src/infra/storage/cifradoObjeto";

const EMPRESA_PRUEBA = "empresa-prueba-r2-script";
const EMPRESA_PRUEBA_INCORRECTA = "empresa-prueba-r2-script-OTRA";
const IMPORT_PRUEBA = `import-prueba-r2-script-${Date.now()}`;
const IMPORT_PRUEBA_INCORRECTO = `${IMPORT_PRUEBA}-OTRO`;
const CONTENIDO_ORIGINAL = Buffer.from(
  "sku,ubicacion,fechaCorte,inventarioDisponible\nPRUEBA-001,LIMA-DEPOSITO-01,2026-09-24,42\n",
  "utf8",
);

function verificarNoEsProduccion(): void {
  const bucket = process.env.R2_BUCKET_NAME || "(no configurado)";
  const forzar = process.argv.includes("--forzar");
  console.log(`Bucket objetivo: "${bucket}"`);
  if (!forzar && !bucket.toLowerCase().includes("dev")) {
    console.error(
      `\nNegado a correr: "${bucket}" no contiene "dev" en el nombre (convencion de ` +
        `PLAN-DE-TRABAJO.md: chainpulse-imports-dev / chainpulse-imports-prod). ` +
        `Este script escribe y borra un objeto real -- si este es tu bucket de desarrollo ` +
        `con otro nombre, corre de nuevo con --forzar. Si es el bucket de produccion, ` +
        `configura R2_BUCKET_NAME con el bucket de desarrollo antes de correr esto.`,
    );
    process.exit(1);
  }
}

/** Verifica que una operacion lance -- usado para los 4 casos de rechazo
 * (empresa/importId incorrectos, sobre contenido y sobre el envoltorio de
 * la DEK). Si NO lanza, es un fallo real de aislamiento, no una simple
 * advertencia -- corta el script con error. */
async function verificarQueLance(etiqueta: string, operacion: () => unknown): Promise<void> {
  let lanzo = false;
  try {
    operacion();
  } catch {
    lanzo = true;
  }
  if (!lanzo) {
    throw new Error(
      `FALLO DE SEGURIDAD (${etiqueta}): la operacion NO lanzo cuando debia -- el aislamiento por AAD no esta funcionando. Ver cifradoObjeto.ts.`,
    );
  }
  console.log(`   OK -- ${etiqueta} lanza, como se espera.`);
}

async function main() {
  verificarNoEsProduccion();

  const cliente = new ClienteAlmacenamientoR2();
  const clave = construirClaveObjetoCifrado(EMPRESA_PRUEBA, IMPORT_PRUEBA);
  let objetoSubido = false;

  try {
    console.log(`\n1. Cifrando CSV ficticio (${CONTENIDO_ORIGINAL.length} bytes)...`);
    const dek = generarDek();
    const cifrado = cifrarContenido(CONTENIDO_ORIGINAL, dek, EMPRESA_PRUEBA, IMPORT_PRUEBA);
    console.log(`   OK -- ${cifrado.length} bytes cifrados (iv+ciphertext+authTag).`);

    console.log(`\n2. Subiendo a R2 en "${clave}"...`);
    await cliente.subirObjeto(clave, cifrado);
    objetoSubido = true;
    console.log("   OK -- subido.");

    console.log("\n3. Descargando de R2...");
    const descargado = await cliente.descargarObjeto(clave);
    console.log(`   OK -- ${descargado.length} bytes descargados.`);

    console.log("\n4. Descifrando y comparando contra el contenido original...");
    const descifrado = descifrarContenido(descargado, dek, EMPRESA_PRUEBA, IMPORT_PRUEBA);
    if (!descifrado.equals(CONTENIDO_ORIGINAL)) {
      throw new Error("FALLO: el contenido descifrado NO coincide con el original -- revisar cifradoObjeto.ts.");
    }
    console.log("   OK -- el contenido descifrado es IDENTICO al original, byte a byte.");

    console.log("\n5. Verificando rechazo del CONTENIDO por empresa incorrecta...");
    await verificarQueLance("descifrar contenido con empresa incorrecta", () =>
      descifrarContenido(descargado, dek, EMPRESA_PRUEBA_INCORRECTA, IMPORT_PRUEBA),
    );

    console.log("\n6. Verificando rechazo del CONTENIDO por importId incorrecto (empresa correcta)...");
    await verificarQueLance("descifrar contenido con importId incorrecto", () =>
      descifrarContenido(descargado, dek, EMPRESA_PRUEBA, IMPORT_PRUEBA_INCORRECTO),
    );

    console.log("\n7. Leyendo la clave maestra ACTIVA configurada (R2_ENCRYPTION_KEY_ACTIVA/_ID)...");
    const claveActiva = obtenerClaveMaestraActiva();
    console.log(`   OK -- clave activa con id "${claveActiva.id}" (el valor de la clave nunca se imprime).`);

    console.log("\n8. Envolviendo/desenvolviendo la DEK real con la clave maestra activa...");
    const envuelta = envolverDek(dek, claveActiva.clave, EMPRESA_PRUEBA, IMPORT_PRUEBA);
    const dekDesenvuelta = desenvolverDek(envuelta, claveActiva.clave, EMPRESA_PRUEBA, IMPORT_PRUEBA);
    if (!dekDesenvuelta.equals(dek)) {
      throw new Error("FALLO: la DEK desenvuelta NO coincide con la original -- revisar envolverDek/desenvolverDek.");
    }
    console.log("   OK -- la DEK desenvuelta con la clave maestra activa es IDENTICA a la original.");

    console.log("\n9. Verificando rechazo del ENVOLTORIO de la DEK por empresa/importId incorrectos...");
    await verificarQueLance("desenvolver DEK con empresa incorrecta", () =>
      desenvolverDek(envuelta, claveActiva.clave, EMPRESA_PRUEBA_INCORRECTA, IMPORT_PRUEBA),
    );
    await verificarQueLance("desenvolver DEK con importId incorrecto", () =>
      desenvolverDek(envuelta, claveActiva.clave, EMPRESA_PRUEBA, IMPORT_PRUEBA_INCORRECTO),
    );

    console.log(
      "\nTODO OK -- cifrar, subir, descargar, descifrar, el envoltorio de la DEK con la clave maestra activa, y los 4 rechazos (contenido y DEK, por empresa e importId) funcionan contra R2 real.",
    );
  } finally {
    if (objetoSubido) {
      console.log(`\n10. Limpieza -- borrando el objeto de prueba "${clave}"...`);
      await cliente.eliminarObjeto(clave);
      const sigueExistiendo = await cliente.existeObjeto(clave);
      if (sigueExistiendo) {
        console.error(
          `   ADVERTENCIA: "${clave}" todavia existe despues de eliminarObjeto() -- borralo a mano en el dashboard de Cloudflare.`,
        );
      } else {
        console.log("   OK -- objeto de prueba eliminado, el bucket queda limpio.");
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error("\nFALLO:", err);
  process.exit(1);
});
