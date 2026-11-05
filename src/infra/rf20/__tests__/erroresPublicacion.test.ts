import { describe, expect, it } from "vitest";
import { esViolacionIndiceParcialPublicacion } from "../erroresPublicacion";

/**
 * Construye la forma REAL observada (calibracion empirica de esta
 * correccion) para un fallo de $queryRaw/$executeRaw envuelto por
 * Prisma: code:"P2010" + meta.driverAdapterError.cause. No incluye
 * message/detail/hint -- no hace falta para probar la funcion, y asi
 * el test tambien documenta que la funcion nunca deberia necesitarlos.
 */
function errorRealQueryRaw(opciones: {
  kind?: string;
  originalCode?: string;
  fields?: unknown;
  sinConstraint?: boolean;
}) {
  const { kind = "UniqueConstraintViolation", originalCode = "23505", fields, sinConstraint = false } = opciones;
  return {
    code: "P2010",
    meta: {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: sinConstraint
          ? { kind, originalCode }
          : { kind, originalCode, constraint: { fields } },
      },
    },
  };
}

describe("esViolacionIndiceParcialPublicacion", () => {
  it("reconoce la forma REAL observada ($queryRaw, P2010 + driverAdapterError.cause) para el indice parcial (codigo)", () => {
    expect(esViolacionIndiceParcialPublicacion(errorRealQueryRaw({ fields: ["codigo"] }))).toBe(true);
  });

  it("rechaza la forma real cuando las columnas son las de la restriccion ordinaria (codigo, numero)", () => {
    expect(esViolacionIndiceParcialPublicacion(errorRealQueryRaw({ fields: ["codigo", "numero"] }))).toBe(false);
  });

  it("rechaza la forma real si falta por completo el campo constraint (Postgres sin DETAIL, p.ej. log_error_verbosity=terse)", () => {
    expect(esViolacionIndiceParcialPublicacion(errorRealQueryRaw({ sinConstraint: true }))).toBe(false);
  });

  it("rechaza la forma real si el SQLSTATE original no es 23505", () => {
    expect(
      esViolacionIndiceParcialPublicacion(errorRealQueryRaw({ originalCode: "23503", fields: ["codigo"] })),
    ).toBe(false);
  });

  it("rechaza la forma real si kind no es UniqueConstraintViolation", () => {
    expect(
      esViolacionIndiceParcialPublicacion(errorRealQueryRaw({ kind: "ForeignKeyConstraintViolation", fields: ["codigo"] })),
    ).toBe(false);
  });

  it("conserva compatibilidad con la forma clasica P2002 (API estructurada) para el indice parcial", () => {
    expect(esViolacionIndiceParcialPublicacion({ code: "P2002", meta: { constraint: { fields: ["codigo"] } } })).toBe(true);
  });

  it("rechaza la forma clasica P2002 cuando las columnas no coinciden", () => {
    expect(esViolacionIndiceParcialPublicacion({ code: "P2002", meta: { constraint: { fields: ["codigo", "numero"] } } })).toBe(
      false,
    );
  });

  it("rechaza un codigo P2002 sin meta.constraint.fields en absoluto", () => {
    expect(esViolacionIndiceParcialPublicacion({ code: "P2002", meta: {} })).toBe(false);
    expect(esViolacionIndiceParcialPublicacion({ code: "P2002" })).toBe(false);
  });

  it("rechaza un error de Prisma totalmente ajeno (p.ej. P2003, violacion de FK por la API estructurada)", () => {
    expect(esViolacionIndiceParcialPublicacion({ code: "P2003", meta: { constraint: { fields: ["codigo"] } } })).toBe(false);
  });

  it("rechaza un error con code P2010 cuyo meta no tiene driverAdapterError (otra causa de 'Raw query failed')", () => {
    expect(esViolacionIndiceParcialPublicacion({ code: "P2010", meta: {} })).toBe(false);
    expect(esViolacionIndiceParcialPublicacion({ code: "P2010" })).toBe(false);
  });

  it("rechaza entradas que no son un objeto de error reconocible", () => {
    expect(esViolacionIndiceParcialPublicacion(null)).toBe(false);
    expect(esViolacionIndiceParcialPublicacion(undefined)).toBe(false);
    expect(esViolacionIndiceParcialPublicacion("P2002")).toBe(false);
    expect(esViolacionIndiceParcialPublicacion(new Error("otro error cualquiera"))).toBe(false);
  });
});
