// Pruebas -- guardaRamaTemporalRendimiento.ts (Incremento 5 PR4). Todo
// PURO (variables de entorno + parseo de URL) -- sin Prisma ni red,
// espia console.error (logError, dentro de exigirEntornoConfirmado) para
// que la salida de prueba quede limpia.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exigirDestinoRendimientoSeguro,
  exigirHostDeRamaTemporalRendimiento,
  normalizarHostNeon,
  resumenUrlConSsl,
} from "../guardaRamaTemporalRendimiento";

const URL_TEMPORAL = "postgres://user:pass@ep-temporal-xyz.us-east-2.aws.neon.tech:5432/chainpulse?schema=public&sslmode=require";
const URL_TEMPORAL_POOLER = "postgres://user:pass@ep-temporal-xyz-pooler.us-east-2.aws.neon.tech:5432/chainpulse?schema=public&sslmode=require";
const URL_PRODUCCION = "postgres://user:pass@ep-produccion-abc.us-east-2.aws.neon.tech:5432/chainpulse?schema=public&sslmode=require";

const ENV_KEYS = [
  "NEON_RAMA_TEMPORAL_HOST_CONFIRMADO",
  "NEON_PRODUCCION_HOST_BLOQUEADO",
  "AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL",
  "ENTORNO_PRUEBA_CONFIRMADO",
] as const;
const envOriginal: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const clave of ENV_KEYS) {
    envOriginal[clave] = process.env[clave];
    delete process.env[clave];
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const clave of ENV_KEYS) {
    if (envOriginal[clave] === undefined) delete process.env[clave];
    else process.env[clave] = envOriginal[clave];
  }
});

describe("normalizarHostNeon()", () => {
  it("quita el sufijo '-pooler.' para que la variante pooler y la directa del mismo host se comparen iguales", () => {
    expect(normalizarHostNeon("ep-temporal-xyz-pooler.us-east-2.aws.neon.tech")).toBe(normalizarHostNeon("ep-temporal-xyz.us-east-2.aws.neon.tech"));
  });

  it("minusculiza (comparacion case-insensitive de hostnames)", () => {
    expect(normalizarHostNeon("EP-Temporal-XYZ.US-EAST-2.AWS.NEON.TECH")).toBe("ep-temporal-xyz.us-east-2.aws.neon.tech");
  });
});

describe("resumenUrlConSsl()", () => {
  it("extrae host y sslmode de la URL, ademas de lo que ya resumenUrl() extrae", () => {
    const destino = resumenUrlConSsl("SEED_DATABASE_URL", URL_TEMPORAL);
    expect(destino.host).toBe("ep-temporal-xyz.us-east-2.aws.neon.tech");
    expect(destino.sslmode).toBe("require");
    expect(destino.base).toBe("chainpulse");
  });

  it("sslmode ausente en la URL -> null (nunca una cadena vacia ni 'undefined')", () => {
    const destino = resumenUrlConSsl("SEED_DATABASE_URL", "postgres://u:p@host:5432/db");
    expect(destino.sslmode).toBeNull();
  });
});

describe("exigirHostDeRamaTemporalRendimiento()", () => {
  const HOST_TEMPORAL = "ep-temporal-xyz.us-east-2.aws.neon.tech";
  const HOST_PRODUCCION = "ep-produccion-abc.us-east-2.aws.neon.tech";

  function fijarEnvValido(): void {
    process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO = HOST_TEMPORAL;
    process.env.NEON_PRODUCCION_HOST_BLOQUEADO = HOST_PRODUCCION;
    process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL = "si";
  }

  it("todo correcto -- no lanza", () => {
    fijarEnvValido();
    expect(() => exigirHostDeRamaTemporalRendimiento(HOST_TEMPORAL, "require")).not.toThrow();
  });

  it("falta NEON_RAMA_TEMPORAL_HOST_CONFIRMADO -- HOST_TEMPORAL_NO_CONFIRMADO", () => {
    process.env.NEON_PRODUCCION_HOST_BLOQUEADO = HOST_PRODUCCION;
    process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL = "si";
    expect(() => exigirHostDeRamaTemporalRendimiento(HOST_TEMPORAL, "require")).toThrow("HOST_TEMPORAL_NO_CONFIRMADO");
  });

  it("el host confirmado NO coincide con el host efectivo -- HOST_TEMPORAL_NO_CONFIRMADO (nunca confia en un host distinto al que de verdad se va a usar)", () => {
    fijarEnvValido();
    expect(() => exigirHostDeRamaTemporalRendimiento("otro-host.neon.tech", "require")).toThrow("HOST_TEMPORAL_NO_CONFIRMADO");
  });

  it("falta NEON_PRODUCCION_HOST_BLOQUEADO -- HOST_PRODUCCION_NO_DECLARADO (nunca asume cual es produccion)", () => {
    process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO = HOST_TEMPORAL;
    process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL = "si";
    expect(() => exigirHostDeRamaTemporalRendimiento(HOST_TEMPORAL, "require")).toThrow("HOST_PRODUCCION_NO_DECLARADO");
  });

  it("el host temporal confirmado coincide con el host de produccion bloqueado -- DESTINO_ES_PRODUCCION", () => {
    process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO = HOST_PRODUCCION;
    process.env.NEON_PRODUCCION_HOST_BLOQUEADO = HOST_PRODUCCION;
    process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL = "si";
    expect(() => exigirHostDeRamaTemporalRendimiento(HOST_PRODUCCION, "require")).toThrow("DESTINO_ES_PRODUCCION");
  });

  it("coincide con produccion aunque una de las dos variantes use '-pooler.' -- sigue siendo DESTINO_ES_PRODUCCION (normalizado antes de comparar)", () => {
    process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO = `${HOST_PRODUCCION.replace(".us-east-2", "-pooler.us-east-2")}`;
    process.env.NEON_PRODUCCION_HOST_BLOQUEADO = HOST_PRODUCCION;
    process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL = "si";
    const hostConPooler = process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO as string;
    expect(() => exigirHostDeRamaTemporalRendimiento(hostConPooler, "require")).toThrow("DESTINO_ES_PRODUCCION");
  });

  it("host contiene '-pooler.' -- CONEXION_TEMPORAL_DEBE_SER_DIRECTA (las escrituras/carga de PR4 exigen conexion directa, nunca pooled)", () => {
    const hostPooler = HOST_TEMPORAL.replace(".us-east-2", "-pooler.us-east-2");
    process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO = hostPooler;
    process.env.NEON_PRODUCCION_HOST_BLOQUEADO = HOST_PRODUCCION;
    process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL = "si";
    expect(() => exigirHostDeRamaTemporalRendimiento(hostPooler, "require")).toThrow("CONEXION_TEMPORAL_DEBE_SER_DIRECTA");
  });

  it("sslmode distinto de require/verify-full -- TLS_FUERTE_REQUERIDO", () => {
    fijarEnvValido();
    expect(() => exigirHostDeRamaTemporalRendimiento(HOST_TEMPORAL, "prefer")).toThrow("TLS_FUERTE_REQUERIDO");
    expect(() => exigirHostDeRamaTemporalRendimiento(HOST_TEMPORAL, null)).toThrow("TLS_FUERTE_REQUERIDO");
  });

  it("sslmode=verify-full tambien es valido (no solo 'require')", () => {
    fijarEnvValido();
    expect(() => exigirHostDeRamaTemporalRendimiento(HOST_TEMPORAL, "verify-full")).not.toThrow();
  });

  it("falta AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL='si' -- AUTORIZACION_PR4_RENDIMIENTO_FALTANTE (nunca otro valor que 'si' exacto)", () => {
    process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO = HOST_TEMPORAL;
    process.env.NEON_PRODUCCION_HOST_BLOQUEADO = HOST_PRODUCCION;
    process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL = "SI"; // mayusculas -- no cuenta
    expect(() => exigirHostDeRamaTemporalRendimiento(HOST_TEMPORAL, "require")).toThrow("AUTORIZACION_PR4_RENDIMIENTO_FALTANTE");
  });
});

describe("exigirDestinoRendimientoSeguro() -- compuerta combinada (host + destino exacto)", () => {
  it("todo confirmado correctamente -- devuelve el destino, no lanza", () => {
    process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO = "ep-temporal-xyz.us-east-2.aws.neon.tech";
    process.env.NEON_PRODUCCION_HOST_BLOQUEADO = "ep-produccion-abc.us-east-2.aws.neon.tech";
    process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL = "si";
    process.env.ENTORNO_PRUEBA_CONFIRMADO = "ep-temporal-xyz.us-east-2.aws.neon.tech:5432/chainpulse?schema=public";

    const destino = exigirDestinoRendimientoSeguro("SEED_DATABASE_URL", URL_TEMPORAL);
    expect(destino.host).toBe("ep-temporal-xyz.us-east-2.aws.neon.tech");
    expect(destino.sslmode).toBe("require");
  });

  it("host de rama temporal confirmado pero ENTORNO_PRUEBA_CONFIRMADO ausente/distinto -- ENTORNO_NO_CONFIRMADO (las DOS compuertas son necesarias, ninguna sustituye a la otra)", () => {
    process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO = "ep-temporal-xyz.us-east-2.aws.neon.tech";
    process.env.NEON_PRODUCCION_HOST_BLOQUEADO = "ep-produccion-abc.us-east-2.aws.neon.tech";
    process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL = "si";
    // ENTORNO_PRUEBA_CONFIRMADO deliberadamente ausente.
    expect(() => exigirDestinoRendimientoSeguro("SEED_DATABASE_URL", URL_TEMPORAL)).toThrow("ENTORNO_NO_CONFIRMADO");
  });

  it("intentar usar la URL de produccion -- DESTINO_ES_PRODUCCION, incluso con ENTORNO_PRUEBA_CONFIRMADO fijado (la compuerta de host corre PRIMERO)", () => {
    process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO = "ep-produccion-abc.us-east-2.aws.neon.tech";
    process.env.NEON_PRODUCCION_HOST_BLOQUEADO = "ep-produccion-abc.us-east-2.aws.neon.tech";
    process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL = "si";
    process.env.ENTORNO_PRUEBA_CONFIRMADO = "ep-produccion-abc.us-east-2.aws.neon.tech:5432/chainpulse?schema=public";
    expect(() => exigirDestinoRendimientoSeguro("SEED_DATABASE_URL", URL_PRODUCCION)).toThrow("DESTINO_ES_PRODUCCION");
  });

  it("URL con host pooler -- CONEXION_TEMPORAL_DEBE_SER_DIRECTA, nunca llega a evaluar ENTORNO_PRUEBA_CONFIRMADO", () => {
    process.env.NEON_RAMA_TEMPORAL_HOST_CONFIRMADO = "ep-temporal-xyz-pooler.us-east-2.aws.neon.tech";
    process.env.NEON_PRODUCCION_HOST_BLOQUEADO = "ep-produccion-abc.us-east-2.aws.neon.tech";
    process.env.AUTORIZO_PR4_RENDIMIENTO_RAMA_TEMPORAL = "si";
    expect(() => exigirDestinoRendimientoSeguro("SEED_DATABASE_URL", URL_TEMPORAL_POOLER)).toThrow("CONEXION_TEMPORAL_DEBE_SER_DIRECTA");
  });
});
