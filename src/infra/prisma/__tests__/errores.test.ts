// Pruebas unitarias DIRECTAS de diagnosticoLecturaSeguro() (sin DB, sin
// Prisma real -- este modulo es JavaScript puro, duck-typing sobre
// `unknown`). Corrección de Alex (2026-11-07, antes del staging): no
// basta con probar, a traves de la pagina, que el logger recibe la
// estructura esperada para UN caso -- hacen falta pruebas directas del
// helper con secretos colocados especificamente en cada una de las 4
// ubicaciones donde un error real podria traerlos (constructor.name,
// code, cause.kind, meta.driverAdapterError.cause.kind), para confirmar
// que CADA una, por separado y todas juntas, cae a un valor seguro en
// vez de propagarse.
import { describe, expect, it } from "vitest";
import { codigoErrorPrisma, diagnosticoLecturaSeguro, esViolacionUnica } from "../errores";

describe("diagnosticoLecturaSeguro -- casos conocidos (pasan tal cual, por ser EXACTAMENTE un valor de la allowlist)", () => {
  it("nombreClase conocido (DriverAdapterError) + codigo con formato de Prisma -- ambos pasan", () => {
    const err = { constructor: { name: "DriverAdapterError" }, code: "P2010" };
    expect(diagnosticoLecturaSeguro(err)).toEqual({ nombreClase: "DriverAdapterError", codigo: "P2010" });
  });

  it("nombreClase conocido (PrismaClientKnownRequestError) sin codigo -- codigo null, nunca undefined expuesto como otra cosa", () => {
    const err = { constructor: { name: "PrismaClientKnownRequestError" } };
    expect(diagnosticoLecturaSeguro(err)).toEqual({ nombreClase: "PrismaClientKnownRequestError", codigo: null });
  });

  it("codigo con formato SQLSTATE (5 caracteres) -- tambien pasa, aunque no sea un codigo de Prisma", () => {
    const err = { constructor: { name: "Error" }, code: "28000" };
    expect(diagnosticoLecturaSeguro(err)).toEqual({ nombreClase: "Error", codigo: "28000" });
  });

  it("codigo que no coincide con ningun formato conocido -- null, nunca el valor crudo", () => {
    const err = { constructor: { name: "Error" }, code: "mi-codigo-interno-no-estandar" };
    expect(diagnosticoLecturaSeguro(err).codigo).toBeNull();
  });

  it("nombreClase que no esta en la lista cerrada -- ERROR_DESCONOCIDO, nunca el valor crudo (aunque sea un nombre de clase real y legitimo)", () => {
    const err = { constructor: { name: "AlgunaOtraClaseLegitimaQueNoEstaEnLaLista" } };
    expect(diagnosticoLecturaSeguro(err).nombreClase).toBe("ERROR_DESCONOCIDO");
  });

  it("nombreClase mas largo que el limite estricto -- ERROR_DESCONOCIDO sin siquiera comparar contra la lista", () => {
    const err = { constructor: { name: "A".repeat(500) } };
    expect(diagnosticoLecturaSeguro(err).nombreClase).toBe("ERROR_DESCONOCIDO");
  });

  it("sin error (undefined, null, string, numero) -- nunca revienta, siempre el fallback seguro", () => {
    expect(diagnosticoLecturaSeguro(undefined)).toEqual({ nombreClase: "ERROR_DESCONOCIDO", codigo: null });
    expect(diagnosticoLecturaSeguro(null)).toEqual({ nombreClase: "ERROR_DESCONOCIDO", codigo: null });
    expect(diagnosticoLecturaSeguro("un string cualquiera")).toEqual({ nombreClase: "ERROR_DESCONOCIDO", codigo: null });
    expect(diagnosticoLecturaSeguro(42)).toEqual({ nombreClase: "ERROR_DESCONOCIDO", codigo: null });
  });

  it("el campo tipo/kind ya no existe en el diagnostico (eliminado -- no hay lista estable de kind conocida)", () => {
    const err = { constructor: { name: "DriverAdapterError" }, cause: { kind: "postgres" } };
    const diagnostico = diagnosticoLecturaSeguro(err);
    expect(Object.keys(diagnostico).sort()).toEqual(["codigo", "nombreClase"]);
  });
});

describe("diagnosticoLecturaSeguro -- secretos en cada ubicacion NUNCA llegan al diagnostico", () => {
  const SECRETO = "password-secreta";

  it("secreto en constructor.name -- cae a ERROR_DESCONOCIDO, el secreto nunca aparece", () => {
    const err = { constructor: { name: SECRETO } };
    const diagnostico = diagnosticoLecturaSeguro(err);
    expect(diagnostico.nombreClase).toBe("ERROR_DESCONOCIDO");
    expect(JSON.stringify(diagnostico)).not.toContain(SECRETO);
  });

  it("secreto en code -- cae a null (no tiene el formato de un codigo conocido), el secreto nunca aparece", () => {
    const err = { constructor: { name: "Error" }, code: `postgresql://usuario:${SECRETO}@host/base` };
    const diagnostico = diagnosticoLecturaSeguro(err);
    expect(diagnostico.codigo).toBeNull();
    expect(JSON.stringify(diagnostico)).not.toContain(SECRETO);
  });

  it("secreto en cause.kind (forma DIRECTA -- el error ya lanzado ES un DriverAdapterError sin envolver) -- el campo tipo ya no existe, el secreto nunca aparece", () => {
    const err = { constructor: { name: "DriverAdapterError" }, cause: { kind: SECRETO } };
    const diagnostico = diagnosticoLecturaSeguro(err);
    expect(diagnostico).toEqual({ nombreClase: "DriverAdapterError", codigo: null });
    expect(Object.keys(diagnostico)).not.toContain("tipo");
    expect(JSON.stringify(diagnostico)).not.toContain(SECRETO);
  });

  it("secreto en meta.driverAdapterError.cause.kind (forma ENVUELTA -- fallo de consulta cruda, P2010) -- mismo resultado, el secreto nunca aparece", () => {
    const err = {
      constructor: { name: "PrismaClientKnownRequestError" },
      code: "P2010",
      meta: { driverAdapterError: { cause: { kind: SECRETO } } },
    };
    const diagnostico = diagnosticoLecturaSeguro(err);
    expect(diagnostico).toEqual({ nombreClase: "PrismaClientKnownRequestError", codigo: "P2010" });
    expect(Object.keys(diagnostico)).not.toContain("tipo");
    expect(JSON.stringify(diagnostico)).not.toContain(SECRETO);
  });

  it("el mismo secreto en las 4 ubicaciones A LA VEZ -- ninguna aparece, el diagnostico cae al fallback seguro", () => {
    const err = {
      constructor: { name: SECRETO },
      code: SECRETO,
      cause: { kind: SECRETO },
      meta: { driverAdapterError: { cause: { kind: SECRETO } } },
    };
    const diagnostico = diagnosticoLecturaSeguro(err);
    expect(diagnostico).toEqual({ nombreClase: "ERROR_DESCONOCIDO", codigo: null });
    expect(JSON.stringify(diagnostico)).not.toContain(SECRETO);
  });

  it("4 secretos DISTINTOS a la vez, uno por ubicacion (constructor.name, code, cause.kind, meta...cause.kind) -- ninguno aparece", () => {
    const err = {
      constructor: { name: "password-secreta-en-nombre" },
      code: "password-secreta-en-codigo",
      cause: { kind: "password-secreta-en-cause-kind" },
      meta: { driverAdapterError: { cause: { kind: "password-secreta-en-meta-kind" } } },
    };
    const diagnostico = diagnosticoLecturaSeguro(err);
    expect(diagnostico).toEqual({ nombreClase: "ERROR_DESCONOCIDO", codigo: null });
    const volcado = JSON.stringify(diagnostico);
    expect(volcado).not.toContain("password-secreta");
  });
});

// Las funciones ya existentes de este archivo no cambiaron -- se
// reutilizaron tal cual en diagnosticoLecturaSeguro() (codigoErrorPrisma)
// sin duplicar su logica. Una prueba minima de que siguen intactas.
describe("codigoErrorPrisma / esViolacionUnica -- sin cambios, reutilizadas tal cual", () => {
  it("codigoErrorPrisma lee err.code con el mismo duck-typing de siempre", () => {
    expect(codigoErrorPrisma({ code: "P2002" })).toBe("P2002");
    expect(codigoErrorPrisma({})).toBeUndefined();
    expect(codigoErrorPrisma(undefined)).toBeUndefined();
  });

  it("esViolacionUnica sigue siendo true unicamente para P2002", () => {
    expect(esViolacionUnica({ code: "P2002" })).toBe(true);
    expect(esViolacionUnica({ code: "P2010" })).toBe(false);
  });
});
