import { describe, expect, it } from "vitest";
import { volcarEstructuraSeguraError } from "../volcarEstructuraSeguraError";

// Valores "trampa": si cualquiera de estos aparece en algun punto del
// volcado (incluso anidado), el allowlist tiene una fuga. Se eligen
// cadenas inconfundibles para que un `includes` sobre el JSON completo
// del resultado sea una verificacion confiable.
const MENSAJE_SQL_TRAMPA = "MENSAJE_SQL_SECRETO_NUNCA_DEBE_APARECER";
const DETAIL_TRAMPA = "DETAIL_CON_VALORES_DE_FILA_NUNCA_DEBE_APARECER";
const HINT_TRAMPA = "HINT_NUNCA_DEBE_APARECER";
const ORIGINAL_MESSAGE_TRAMPA = "ORIGINAL_MESSAGE_CON_SQL_NUNCA_DEBE_APARECER";

function contieneAlgunaTrampa(resultado: unknown): boolean {
  const json = JSON.stringify(resultado);
  return [MENSAJE_SQL_TRAMPA, DETAIL_TRAMPA, HINT_TRAMPA, ORIGINAL_MESSAGE_TRAMPA].some((trampa) => json.includes(trampa));
}

function construirErrorRealCompleto() {
  class DriverAdapterError extends Error {
    override cause: unknown;
    constructor(cause: unknown) {
      super(ORIGINAL_MESSAGE_TRAMPA);
      this.name = "DriverAdapterError";
      this.cause = cause;
    }
  }

  class PrismaClientKnownRequestError extends Error {
    code: string;
    meta: unknown;
    constructor() {
      super(MENSAJE_SQL_TRAMPA);
      this.name = "PrismaClientKnownRequestError";
      this.code = "P2010";
      this.meta = {
        driverAdapterError: new DriverAdapterError({
          kind: "UniqueConstraintViolation",
          originalCode: "23505",
          originalMessage: ORIGINAL_MESSAGE_TRAMPA,
          constraint: { fields: ["codigo"] },
        }),
      };
    }
  }

  return new PrismaClientKnownRequestError();
}

describe("volcarEstructuraSeguraError", () => {
  it("extrae la estructura segura completa de la forma real observada ($queryRaw, P2010 + driverAdapterError.cause)", () => {
    const resultado = volcarEstructuraSeguraError(construirErrorRealCompleto());
    expect(resultado.tipo).toBe("PrismaClientKnownRequestError");
    expect(resultado.name).toBe("PrismaClientKnownRequestError");
    expect(resultado.code).toBe("P2010");
    expect(resultado.meta?.driverAdapterError?.tipo).toBe("DriverAdapterError");
    expect(resultado.meta?.driverAdapterError?.name).toBe("DriverAdapterError");
    expect(resultado.meta?.driverAdapterError?.causa?.kind).toBe("UniqueConstraintViolation");
    expect(resultado.meta?.driverAdapterError?.causa?.originalCode).toBe("23505");
    expect(resultado.meta?.driverAdapterError?.causa?.constraint?.fields).toEqual(["codigo"]);
  });

  it("nunca incluye message/detail/hint/originalMessage en el volcado, aunque el error de entrada los tenga", () => {
    const resultado = volcarEstructuraSeguraError(construirErrorRealCompleto());
    expect(contieneAlgunaTrampa(resultado)).toBe(false);
  });

  it("nunca incluye detail/hint/message aunque esten presentes como propiedades propias directas del error", () => {
    const error = construirErrorRealCompleto() as unknown as Record<string, unknown>;
    error.detail = DETAIL_TRAMPA;
    error.hint = HINT_TRAMPA;
    const resultado = volcarEstructuraSeguraError(error);
    expect(contieneAlgunaTrampa(resultado)).toBe(false);
    // Los NOMBRES de esas claves si pueden listarse (son solo nombres,
    // nunca valores) -- confirma que el allowlist filtra por campo, no
    // por ocultar que la clave existe.
    expect(resultado.clavesPropias).toContain("detail");
    expect(resultado.clavesPropias).toContain("hint");
  });

  it("devuelve una estructura vacia y segura para entradas que no son objetos de error", () => {
    expect(volcarEstructuraSeguraError(null)).toEqual({ tipo: null, name: null, clavesPropias: [], code: null, meta: null });
    expect(volcarEstructuraSeguraError(undefined)).toEqual({ tipo: null, name: null, clavesPropias: [], code: null, meta: null });
    expect(volcarEstructuraSeguraError("texto cualquiera")).toEqual({
      tipo: null,
      name: null,
      clavesPropias: [],
      code: null,
      meta: null,
    });
  });

  it("maneja con seguridad un meta sin driverAdapterError (otra causa de P2010, o ausencia total)", () => {
    const resultado = volcarEstructuraSeguraError({ code: "P2010", meta: { otraCosa: true } });
    expect(resultado.code).toBe("P2010");
    expect(resultado.meta?.driverAdapterError).toBeNull();
    expect(resultado.meta?.clavesPropias).toEqual(["otraCosa"]);
  });

  it("maneja con seguridad una causa sin constraint (Postgres sin DETAIL)", () => {
    const resultado = volcarEstructuraSeguraError({
      code: "P2010",
      meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation", originalCode: "23505" } } },
    });
    expect(resultado.meta?.driverAdapterError?.causa?.constraint).toBeNull();
  });

  it("nunca lanza, incluso si una propiedad del error es un getter que lanza al leerla", () => {
    const errorHostil = {};
    Object.defineProperty(errorHostil, "code", {
      enumerable: true,
      get() {
        throw new Error("getter hostil");
      },
    });
    expect(() => volcarEstructuraSeguraError(errorHostil)).not.toThrow();
    const resultado = volcarEstructuraSeguraError(errorHostil);
    expect(resultado).toEqual({ tipo: null, name: null, clavesPropias: [], code: null, meta: null });
  });

  it("reconoce tambien la forma clasica P2002 (API estructurada) con meta.constraint.fields", () => {
    const resultado = volcarEstructuraSeguraError({ code: "P2002", meta: { constraint: { fields: ["codigo"] } } });
    expect(resultado.code).toBe("P2002");
    // meta.constraint (forma P2002) no es meta.driverAdapterError (forma
    // $queryRaw) -- esta funcion solo entiende la segunda forma dentro
    // de "meta"; el volcado de la primera queda solo como clavesPropias,
    // que es intencional: el volcado seguro no reimplementa la logica de
    // esViolacionIndiceParcialPublicacion(), solo expone la estructura.
    expect(resultado.meta?.clavesPropias).toEqual(["constraint"]);
    expect(resultado.meta?.driverAdapterError).toBeNull();
  });
});
