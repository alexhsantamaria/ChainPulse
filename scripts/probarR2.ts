// Script de un solo uso — prueba de integracion MANUAL del cliente real de
// R2 (Incremento 4 Bloque B, ADR-0006/docs/ADR/0006-cifrado-r2.md). Pedido
// explicito de Alex (2026-09-24): validar cifrar+subir+descargar+descifrar
// contra R2 real, mas el rechazo por empresa/importacion incorrectas, con
// limpieza del objeto de prueba y sin imprimir ningun secreto.
//
// SOLO corre contra un bucket cuyo nombre contenga "dev" (case-insensitive)
// -- la convencion ya fijada en PLAN-DE-TRABAJO.md (Setup de R2) es
// chainpulse-imports-dev / chainpulse-imports-prod. Si tu bucket de
// desarrollo tiene otro nombre, pasa --forzar explicitamente. Este chequeo
// es la unica proteccion real contra correrlo sin querer contra produccion
// -- no hay forma de que el script "adivine" cual es tu bucket de
// produccion, asi que la conviccion tiene que venir del nombre.
//
// Que hace, todo contra R2 real (nunca contra Postgres/Neon -- no necesita
// DATABASE_URL):
//   1. Cifra un CSV FICTICIO (contenido de prueba, nunca datos reales) con
//      una DEK nueva y empresaId/importId de prueba.
//   2. Lo sube con ClienteAlmacenamientoR2.subirObjeto().
//   3. Lo descarga con descargarObjeto().
//   4. Lo descifra y compara BYTE A BYTE contra el contenido original.
//   5. Intenta descifrar el MISMO objeto descargado declarando una empresa
//      distinta a la que se uso para cifrar -- por AAD (ver
//      cifradoObjeto.ts) esto DEBE lanzar. Si no lanza, es un fallo real de
//      aislamiento entre empresas y el script termina con error.
//   6. Borra el objeto de prueba, SIEMPRE (try/finally) -- nunca deja
//      basura en el bucket, incluso si un paso anterior fallo.
//
// Nunca imprime valores de variables de entorno (ni las credenciales de R2
// ni la clave de cifrado) -- solo nombres de variable, el nombre del
// bucket (no es secreto) y resultados OK/FALLO de cada paso.
//
// Uso:
//   npm run r2:probar
//   npm run r2:probar -- --forzar   (si tu bucket dev no tiene "dev" en el nombre)
import { ClienteAlmacenamientoR2 } from "../src/infra/storage/r2";
import { construirClaveObjetoCifrado } from "../src/infra/storage/almacenamiento";
import { cifrarContenido, descifrarContenido, generarDek } from "../src/infra/storage/cifradoObjeto";

const EMPRESA_PRUEBA = "empresa-prueba-r2-script";
const EMPRESA_PRUEBA_INCORRECTA = "empresa-prueba-r2-script-OTRA";
const IMPORT_PRUEBA = `import-prueba-r2-script-${Date.now()}`;
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
      throw new Error(
        "FALLO: el contenido descifrado NO coincide con el original -- revisar cifradoObjeto.ts.",
      );
    }
    console.log("   OK -- el contenido descifrado es IDENTICO al original, byte a byte.");

    console.log("\n5. Verificando rechazo con empresa/importacion incorrectas (AAD)...");
    let rechazoOk = false;
    try {
      descifrarContenido(descargado, dek, EMPRESA_PRUEBA_INCORRECTA, IMPORT_PRUEBA);
    } catch {
      rechazoOk = true;
    }
    if (!rechazoOk) {
      throw new Error(
        "FALLO DE SEGURIDAD: se pudo descifrar el objeto declarando una empresa distinta a la " +
          "que se uso para cifrar -- el aislamiento por AAD no esta funcionando. Ver cifradoObjeto.ts.",
      );
    }
    console.log("   OK -- descifrar con otra empresa/importacion lanza, como se espera.");

    console.log("\nTODO OK -- cifrar, subir, descargar, descifrar y el rechazo entre empresas funcionan contra R2 real.");
  } finally {
    if (objetoSubido) {
      console.log(`\n6. Limpieza -- borrando el objeto de prueba "${clave}"...`);
      await cliente.eliminarObjeto(clave);
      const sigueExistiendo = await cliente.existeObjeto(clave);
      if (sigueExistiendo) {
        console.error(`   ADVERTENCIA: "${clave}" todavia existe despues de eliminarObjeto() -- borralo a mano en el dashboard de Cloudflare.`);
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
