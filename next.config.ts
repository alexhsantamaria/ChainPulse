// Configuracion — ajustes de Next.js para el proyecto.
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // CORRECCION (Alex, 2026-10-08, incidente real en produccion): el login
  // fallaba en POST /api/auth/callback/credentials con
  // "ENOENT: no such file or directory, open
  // '/var/task/node_modules/.prisma/client/query_compiler_bg.wasm'"
  // durante prisma.$queryRaw(). Cuenta, password, MFA, migraciones y el
  // smoke test del rol chainpulse_app ya estaban confirmados correctos --
  // el problema NUNCA fue de credenciales/datos, sino de que ese archivo
  // nunca llega al bundle de la funcion serverless desplegada en Vercel.
  //
  // CAUSA RAIZ: prisma/schema.prisma usa engineType="client" (ADR-0003,
  // adenda ARM64 -- motor sin binario Rust nativo, necesario porque el
  // query engine nativo no existe para Windows ARM64). Ese motor compila
  // las consultas via un query COMPILER en WebAssembly
  // (query_compiler_bg.wasm, generado por `prisma generate` dentro de
  // node_modules/.prisma/client/), que el cliente carga de forma dinamica
  // en tiempo de ejecucion -- no mediante un `import`/`require` estatico
  // que Next.js pueda rastrear. Next.js usa @vercel/nft para inferir, por
  // analisis estatico, que archivos de node_modules necesita cada funcion
  // serverless; un archivo cargado dinamicamente (nunca importado de forma
  // estatica) puede quedar afuera del bundle aunque exista en disco
  // durante el build -- exactamente la causa documentada, para el caso
  // general de archivos .wasm, en vercel/next.js#32612 (issue cerrada como
  // "not planned": Next.js no lo resuelve de forma automatica para
  // ningun .wasm cargado dinamicamente).
  //
  // CORRECCION: outputFileTracingIncludes (clave estable de nivel
  // superior en next.config.ts desde Next.js 15 -- confirmado contra la
  // documentacion oficial vigente para la version instalada, next@15.5.26:
  // https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output
  // -- nunca bajo "experimental", que es la ubicacion antigua/obsoleta).
  // La clave "/*" ("target all routes", segun esa misma documentacion)
  // fuerza la inclusion para TODAS las funciones serverless, no solo la
  // ruta de login: cualquier otra ruta de la API que use Prisma
  // (eslabones, ciclos, cadenas, conexiones, mfa, el cron de
  // /api/internal/jobs/run, etc.) comparte el MISMO cliente generado y
  // quedaria expuesta al mismo ENOENT en cuanto ejecutara su primera
  // consulta real. El patron incluye el directorio COMPLETO
  // "node_modules/.prisma/client/**/*" -- nunca solo
  // "query_compiler_bg.wasm" por nombre -- porque ese directorio generado
  // por `prisma generate` tambien contiene otros artefactos que el
  // cliente puede necesitar en tiempo de ejecucion (el propio
  // query_compiler_bg.wasm, el codigo generado del cliente, metadatos del
  // schema) y fijar un solo nombre de archivo es fragil ante cualquier
  // cambio futuro de Prisma en como organiza esos artefactos. El propio
  // paquete "@prisma/client" no necesita esta regla: se importa de forma
  // estatica (src/infra/prisma/client.ts) y @vercel/nft ya lo rastrea
  // correctamente por ese import.
  //
  // Verificacion: scripts/verificarTrazadoPrismaWasm.ts (ejecutar despues
  // de `next build`, antes de promover un deploy de Preview a produccion)
  // confirma que el .nft.json de cada ruta que empaqueta Prisma incluye
  // efectivamente query_compiler_bg.wasm -- ver ese archivo para el
  // detalle y para que falla (con el nombre exacto de la ruta afectada) si
  // esta correccion alguna vez deja de aplicarse.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/.prisma/client/**/*"],
  },
};

export default withSentryConfig(nextConfig, {
  // org/project/authToken quedan sin valor hasta que exista CI
  // (PLAN-DE-TRABAJO.md Seccion 18.1.B: SENTRY_AUTH_TOKEN se difiere).
  // Sin authToken el plugin no sube sourcemaps y no falla el build --
  // se activa solo con agregar las 3 variables, sin tocar este archivo.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: false,
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: false,
  },
});
