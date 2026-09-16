// Prueba las funciones puras de huella.ts (truncarVentanaBucket,
// hashHuellaOrigen), separadas a proposito de registrarIntento()
// (limiteTasa.ts), que ejecuta un UPSERT real contra Postgres y no se
// puede ejercitar sin red hacia Neon en este entorno de desarrollo — mismo
// limite documentado en src/infra/auth/__tests__/recuperacion.test.ts.
// registrarIntento() queda como candidato de prueba de integracion.
import { beforeEach, describe, expect, it } from "vitest";

describe("truncarVentanaBucket", () => {
  it("con la granularidad por defecto (15 min), trunca al inicio del bucket de 15 minutos (UTC)", async () => {
    const { truncarVentanaBucket } = await import("../huella");
    const fecha = new Date("2026-09-16T14:37:52.123Z");
    const truncada = truncarVentanaBucket(fecha);
    expect(truncada.toISOString()).toBe("2026-09-16T14:30:00.000Z");
  });

  it("dos fechas en el mismo bucket de 15 minutos truncan al mismo valor (misma fila de LimiteTasa)", async () => {
    const { truncarVentanaBucket } = await import("../huella");
    const a = truncarVentanaBucket(new Date("2026-09-16T14:30:00.000Z"));
    const b = truncarVentanaBucket(new Date("2026-09-16T14:44:59.999Z"));
    expect(a.getTime()).toBe(b.getTime());
  });

  it("dos fechas en buckets de 15 minutos distintos truncan a valores distintos", async () => {
    const { truncarVentanaBucket } = await import("../huella");
    const a = truncarVentanaBucket(new Date("2026-09-16T14:44:59.999Z"));
    const b = truncarVentanaBucket(new Date("2026-09-16T14:45:00.000Z"));
    expect(a.getTime()).not.toBe(b.getTime());
  });

  it("acepta una granularidad distinta por parametro (compatibilidad con la ventana vieja de 60 min)", async () => {
    const { truncarVentanaBucket } = await import("../huella");
    const truncada = truncarVentanaBucket(new Date("2026-09-16T14:37:52.123Z"), 60);
    expect(truncada.toISOString()).toBe("2026-09-16T14:00:00.000Z");
  });
});

describe("hashHuellaOrigen", () => {
  beforeEach(() => {
    delete process.env.HUELLA_ORIGEN_SALT;
  });

  it("lanza si HUELLA_ORIGEN_SALT no esta configurado (nunca hashea sin salto)", async () => {
    const { hashHuellaOrigen } = await import("../huella");
    expect(() => hashHuellaOrigen("203.0.113.4")).toThrow(/HUELLA_ORIGEN_SALT/);
  });

  it("el mismo valor con el mismo salto produce siempre el mismo hash", async () => {
    process.env.HUELLA_ORIGEN_SALT = "salto-de-pruebas-no-es-real";
    const { hashHuellaOrigen } = await import("../huella");
    expect(hashHuellaOrigen("203.0.113.4")).toBe(hashHuellaOrigen("203.0.113.4"));
  });

  it("nunca contiene el valor crudo (no es un hash reversible visible a simple vista)", async () => {
    process.env.HUELLA_ORIGEN_SALT = "salto-de-pruebas-no-es-real";
    const { hashHuellaOrigen } = await import("../huella");
    const hash = hashHuellaOrigen("203.0.113.4");
    expect(hash).not.toContain("203.0.113.4");
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // sha256 en hex
  });

  it("un salto distinto produce un hash distinto para el mismo valor", async () => {
    const { hashHuellaOrigen } = await import("../huella");
    process.env.HUELLA_ORIGEN_SALT = "salto-A";
    const hashA = hashHuellaOrigen("203.0.113.4");
    process.env.HUELLA_ORIGEN_SALT = "salto-B";
    const hashB = hashHuellaOrigen("203.0.113.4");
    expect(hashA).not.toBe(hashB);
  });
});
