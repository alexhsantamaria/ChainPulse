// Script de mantenimiento -- SOLO LECTURA sobre el filesystem de build de
// Next.js (.next/server). Nunca se conecta a ninguna base de datos, a
// Vercel, ni a ningun servicio de red.
//
// Verificador del artefacto de produccion (Alex, 2026-10-08, incidente
// real: el login fallaba en POST /api/auth/callback/credentials con
// "ENOENT: no such file or directory, open
// '/var/task/node_modules/.prisma/client/query_compiler_bg.wasm'" durante
// prisma.$queryRaw() -- cuenta, password, MFA, migraciones y el smoke
// test del rol chainpulse_app ya estaban confirmados correctos; el
// problema nunca fue de credenciales ni de datos, sino de que ese
// archivo nunca llegaba al bundle de la funcion serverless desplegada en
// Vercel. Ver el comentario de cabecera de "outputFileTracingIncludes" en
// next.config.ts para el diagnostico completo de la causa raiz).
//
// Corre DESPUES de `npm run build` (local, o dentro de un deploy de
// Preview que se pueda inspeccionar/reconstruir localmente) y ANTES de
// promover ese build a produccion -- exactamente el paso de confirmacion
// que esta ronda pide antes de actualizar produccion.
//
// QUE VERIFICA, EXACTAMENTE: recorre cada archivo *.nft.json bajo
// .next/server -- el "trace" de Output File Tracing que Next.js genera
// por cada funcion serverless (ver "How it Works" en
// https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output:
// @vercel/nft analiza estaticamente import/require/fs para decidir que
// archivos empaquetar, y Vercel copia exactamente los archivos listados
// en ese .nft.json al bundle final de cada funcion -- por eso leer el
// .nft.json es un proxy fiel de "que archivos van a parar al Lambda
// real", sin necesitar `vercel build` ni un deploy real). Para cada ruta
// cuyo .nft.json ya hace referencia a ".prisma/client" o "@prisma/client"
// (es decir, cualquier funcion serverless que efectivamente empaqueta
// Prisma), exige que ESE MISMO .nft.json tambien incluya
// "query_compiler_bg.wasm" -- si no lo incluye, esa ruta quedaria
// expuesta al mismo ENOENT que ya ocurrio en produccion. Nunca asume que
// basta con que next.config.ts DECLARE la regla de inclusion: vuelve a
// leer el artefacto real que `next build` efectivamente produjo -- mismo
// criterio "verificar, nunca asumir" que ya usa el resto del repositorio
// (verificarDriftReconstruccion.ts, verificarObservacionesCobertura.ts).
//
// No requiere ninguna variable de entorno ni conexion de red/base de
// datos -- solo lee .next/server, generado localmente por
// `npm run build`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_NEXT_SERVER = join(process.cwd(), ".next", "server");
const ARCHIVO_CRITICO = "query_compiler_bg.wasm";
// Cualquiera de estos dos substrings en un path de .nft.json indica que
// esa ruta empaqueta Prisma -- ".prisma/client" es el directorio
// generado por `prisma generate` (donde vive query_compiler_bg.wasm);
// "@prisma/client" es el paquete npm que src/infra/prisma/client.ts
// importa de forma estatica.
const MARCADORES_PRISMA = [".prisma/client", "@prisma/client"];

interface ResultadoRuta {
  nftPath: string;
  usaPrisma: boolean;
  incluyeArchivoCritico: boolean;
}

function listarNftJsonRecursivo(dir: string): string[] {
  const resultado: string[] = [];
  let entradas: string[];
  try {
    entradas = readdirSync(dir);
  } catch {
    return resultado;
  }
  for (const entrada of entradas) {
    const ruta = join(dir, entrada);
    const info = statSync(ruta);
    if (info.isDirectory()) {
      resultado.push(...listarNftJsonRecursivo(ruta));
    } else if (entrada.endsWith(".nft.json")) {
      resultado.push(ruta);
    }
  }
  return resultado;
}

function analizarNftJson(rutaNft: string): ResultadoRuta {
  const contenido = JSON.parse(readFileSync(rutaNft, "utf8")) as { files?: string[] };
  const archivos = contenido.files ?? [];
  const usaPrisma = archivos.some((f) => MARCADORES_PRISMA.some((marcador) => f.includes(marcador)));
  const incluyeArchivoCritico = archivos.some((f) => f.endsWith(ARCHIVO_CRITICO));
  return { nftPath: rutaNft, usaPrisma, incluyeArchivoCritico };
}

function main(): void {
  let archivosNft: string[];
  try {
    archivosNft = listarNftJsonRecursivo(RAIZ_NEXT_SERVER);
  } catch (err) {
    console.error(`No se pudo leer ${RAIZ_NEXT_SERVER} -- correr "npm run build" primero.`, err);
    process.exit(1);
    return;
  }

  if (archivosNft.length === 0) {
    console.error(
      `No se encontro ningun archivo .nft.json bajo ${RAIZ_NEXT_SERVER} -- correr "npm run build" primero (este script verifica el artefacto YA construido, nunca construye nada).`,
    );
    process.exit(1);
    return;
  }

  const resultados = archivosNft.map(analizarNftJson);
  const queUsanPrisma = resultados.filter((r) => r.usaPrisma);
  const faltantes = queUsanPrisma.filter((r) => !r.incluyeArchivoCritico);

  console.log(`Rutas con trace generado: ${resultados.length}. Rutas que empaquetan Prisma: ${queUsanPrisma.length}.`);
  for (const r of queUsanPrisma) {
    console.log(`  [${r.incluyeArchivoCritico ? "OK" : "FALTA"}] ${relative(process.cwd(), r.nftPath)}`);
  }

  if (faltantes.length > 0) {
    console.error(
      `\nARTEFACTO_PRISMA_WASM_FALTANTE: ${faltantes.length} ruta(s) empaquetan Prisma pero su .nft.json NO incluye "${ARCHIVO_CRITICO}" -- quedarian expuestas al mismo ENOENT que fallo en produccion. Revisar "outputFileTracingIncludes" en next.config.ts.`,
    );
    for (const r of faltantes) {
      console.error(`  - ${relative(process.cwd(), r.nftPath)}`);
    }
    process.exit(1);
    return;
  }

  if (queUsanPrisma.length === 0) {
    console.error(
      `ARTEFACTO_PRISMA_WASM_SIN_MUESTRA: ningun .nft.json referencia Prisma -- el build podria no haber generado las rutas de API esperadas (confirmar que "next build" corrio completo), o el marcador de deteccion (".prisma/client"/"@prisma/client") dejo de aparecer en los paths relativos que @vercel/nft produce. Con 0 rutas de muestra no se puede confirmar nada -- investigar antes de confiar en este resultado.`,
    );
    process.exit(1);
    return;
  }

  console.log(
    `\nSin artefactos de Prisma faltantes -- las ${queUsanPrisma.length} ruta(s) que empaquetan Prisma incluyen "${ARCHIVO_CRITICO}" en su trace.`,
  );
}

main();
