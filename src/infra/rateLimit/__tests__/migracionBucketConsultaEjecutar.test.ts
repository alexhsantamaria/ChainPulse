// Pruebas -- verificacion ESTATICA (sin base, sin red, sin conexion) de
// la migracion 20261117100000_incremento5_pr1_enum_bucket_consulta_ejecutar
// (Incremento 5 PR1) -- mismo patron que
// infra/prisma/__tests__/reconstruccionRlsAuthGrants.test.ts: la
// migracion es SQL puro, se lee como TEXTO y se verifican invariantes
// estructurales con aserciones de texto, nunca ejecutandola.
//
// IMPORTANTE -- lo que esta prueba NO cubre: no reconstruye ninguna
// base real ni verifica que ALTER TYPE ... ADD VALUE efectivamente
// aplique sin errores contra Postgres -- eso depende de una conexion
// real (Neon, rama temporal) y queda, a proposito, como parte del
// protocolo de validacion manual (Windows/Neon-temp-branch) de este
// PR1, nunca ejecutado automaticamente aca. Esta prueba solo evita el
// drift mas comun y silencioso: que prisma/schema.prisma y el archivo
// de migracion queden desincronizados (ej. alguien cambia el nombre
// del valor del enum en un lado y se olvida del otro).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUTA_MIGRACION = join(
  __dirname,
  "../../../../prisma/migrations/20261117100000_incremento5_pr1_enum_bucket_consulta_ejecutar/migration.sql",
);
const RUTA_SCHEMA = join(__dirname, "../../../../prisma/schema.prisma");

function sinLineasDeComentarioSql(texto: string): string {
  return texto
    .split("\n")
    .filter((linea) => !linea.trim().startsWith("--"))
    .join("\n");
}

function lineasEfectivas(texto: string): string[] {
  return sinLineasDeComentarioSql(texto)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

describe("migracion 20261117100000_incremento5_pr1_enum_bucket_consulta_ejecutar (estatico)", () => {
  const sql = readFileSync(RUTA_MIGRACION, "utf8");

  it("envuelve la migracion con BEGIN;/COMMIT; explicitos -- BEGIN; es la primera instruccion efectiva y COMMIT; la ultima", () => {
    const lineas = lineasEfectivas(sql);
    expect(lineas[0]).toBe("BEGIN;");
    expect(lineas[lineas.length - 1]).toBe("COMMIT;");
  });

  it("el ALCANCE EXACTO de esta migracion es UNICAMENTE un ALTER TYPE ADD VALUE -- una sola instruccion efectiva entre BEGIN y COMMIT", () => {
    const lineas = lineasEfectivas(sql);
    // BEGIN; + 1 instruccion + COMMIT; = 3 lineas efectivas, nunca mas.
    expect(lineas).toHaveLength(3);
    expect(lineas[1]).toBe(`ALTER TYPE "BucketLimiteTasa" ADD VALUE 'CONSULTA_EJECUTAR';`);
  });

  it("nunca toca tablas, constraints, funciones ni grants -- solo ALTER TYPE sobre BucketLimiteTasa", () => {
    const sqlSinComentarios = sinLineasDeComentarioSql(sql);
    expect(/CREATE\s+TABLE/i.test(sqlSinComentarios)).toBe(false);
    expect(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sqlSinComentarios)).toBe(false);
    expect(/GRANT\b/i.test(sqlSinComentarios)).toBe(false);
    expect(/ALTER\s+TABLE/i.test(sqlSinComentarios)).toBe(false);
  });

  it("nunca usa CONCURRENTLY ni ningun comando prohibido dentro de un bloque de transaccion", () => {
    const sqlSinComentarios = sinLineasDeComentarioSql(sql);
    const prohibidos = [/CONCURRENTLY/i, /\bVACUUM\b/i, /ALTER\s+SYSTEM/i, /CREATE\s+DATABASE/i, /DROP\s+DATABASE/i];
    for (const patron of prohibidos) {
      expect(patron.test(sqlSinComentarios)).toBe(false);
    }
  });

  it("documenta la secuencia obligatoria de despliegue (migracion -> verificar enum -> codigo) -- mismo criterio que RF24", () => {
    expect(sql).toMatch(/SECUENCIA OBLIGATORIA DE DESPLIEGUE/);
    expect(sql).toMatch(/CONSULTA_EJECUTAR/);
  });

  it("declara explicitamente que NO fue ejecutada contra ningun destino durante esta fase", () => {
    expect(sql).toMatch(/NO EJECUTADA/);
  });
});

describe("prisma/schema.prisma <-> migracion -- sincronizados (sin drift)", () => {
  const schema = readFileSync(RUTA_SCHEMA, "utf8");

  it("el enum BucketLimiteTasa en schema.prisma incluye CONSULTA_EJECUTAR", () => {
    const bloqueEnum = schema.match(/enum BucketLimiteTasa \{[^}]*\}/s)?.[0] ?? "";
    expect(bloqueEnum).toContain("CONSULTA_EJECUTAR");
  });

  it("el comentario de CONSULTA_EJECUTAR en schema.prisma referencia el nombre EXACTO de la carpeta de esta migracion (evita drift si alguno de los dos se renombra)", () => {
    const bloqueEnum = schema.match(/enum BucketLimiteTasa \{[^}]*\}/s)?.[0] ?? "";
    expect(bloqueEnum).toContain("20261117100000_incremento5_pr1_enum_bucket_consulta_ejecutar");
  });

  it("CONSULTA_EJECUTAR aparece UNA SOLA VEZ como VALOR del enum (sin duplicados por un merge/copy-paste accidental -- distinto de LIMITE_CONSULTA_EJECUTAR, que aparece solo en el comentario)", () => {
    const bloqueEnum = schema.match(/enum BucketLimiteTasa \{[^}]*\}/s)?.[0] ?? "";
    const lineasValor = bloqueEnum
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l === "CONSULTA_EJECUTAR" || l.startsWith("CONSULTA_EJECUTAR ") || l.startsWith("CONSULTA_EJECUTAR//"));
    expect(lineasValor).toHaveLength(1);
  });
});
