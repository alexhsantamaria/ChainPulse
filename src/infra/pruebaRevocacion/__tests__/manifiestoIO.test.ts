// Pruebas — E/S del manifiesto con manejo de error de codigo fijo
// (Alex, 2026-10-04, punto 2 de la segunda correccion). "fs" mockeado
// por completo -- ninguna prueba toca el disco real.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { emailUsuario, type ManifiestoPrueba } from "../manifiesto";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

const readFileSyncMock = vi.fn();
const writeFileSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();
const unlinkSyncMock = vi.fn();
vi.mock("fs", () => ({
  readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
  writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args),
  mkdirSync: (...args: unknown[]) => mkdirSyncMock(...args),
  unlinkSync: (...args: unknown[]) => unlinkSyncMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const RUN_ID = "run-1";
function manifiestoValido(): ManifiestoPrueba {
  return {
    version: 1,
    runId: RUN_ID,
    creadoEn: new Date().toISOString(),
    destino: { host: "host-de-prueba.neon.tech", base: "chainpulse_prueba" },
    empresaId: "empresa-1",
    usuarios: {
      a1: { id: "usuario-a1", email: emailUsuario(RUN_ID, "a1"), uso: "x" },
      a2: { id: "usuario-a2", email: emailUsuario(RUN_ID, "a2"), uso: "x" },
      a3: { id: "usuario-a3", email: emailUsuario(RUN_ID, "a3"), uso: "x" },
      a4: { id: "usuario-a4", email: emailUsuario(RUN_ID, "a4"), uso: "x" },
    },
  };
}

describe("leerManifiesto", () => {
  it("lee y valida un manifiesto bien formado", async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify(manifiestoValido()));
    const { leerManifiesto } = await import("../manifiestoIO");
    expect(leerManifiesto("/alguna/ruta.json", "ctx").runId).toBe(RUN_ID);
  });

  it("el archivo no existe o no se puede leer -- MANIFIESTO_ILEGIBLE, nunca la ruta real en el error", async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory, open '/ruta/secreta/del/sistema.json'");
    });
    const { leerManifiesto } = await import("../manifiestoIO");
    expect(() => leerManifiesto("/ruta/secreta/del/sistema.json", "ctx")).toThrow("MANIFIESTO_ILEGIBLE");
    expect(logErrorMock).toHaveBeenCalledWith("ctx", "MANIFIESTO_ILEGIBLE");
  });

  it("el contenido no es JSON valido -- MANIFIESTO_ILEGIBLE", async () => {
    readFileSyncMock.mockReturnValue("esto no es json {{{");
    const { leerManifiesto } = await import("../manifiestoIO");
    expect(() => leerManifiesto("/ruta.json", "ctx")).toThrow("MANIFIESTO_ILEGIBLE");
  });

  it("el JSON es valido pero la estructura no (reenvia el error de validarEstructuraManifiesto)", async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ version: 2 }));
    const { leerManifiesto } = await import("../manifiestoIO");
    expect(() => leerManifiesto("/ruta.json", "ctx")).toThrow("MANIFIESTO_VERSION_DESCONOCIDA");
  });
});

describe("escribirManifiesto", () => {
  it("escribe exclusivo ('wx') en la carpeta fuera del repo y devuelve la ruta", async () => {
    mkdirSyncMock.mockReturnValue(undefined);
    writeFileSyncMock.mockReturnValue(undefined);
    const { escribirManifiesto } = await import("../manifiestoIO");
    const m = manifiestoValido();
    const ruta = escribirManifiesto(RUN_ID, m, "ctx");
    expect(ruta).toContain(RUN_ID);
    expect(writeFileSyncMock).toHaveBeenCalledWith(ruta, JSON.stringify(m, null, 2), { flag: "wx" });
  });

  it("la escritura falla (por ejemplo, ya existe uno con ese runId) -- ERROR_ESCRITURA_MANIFIESTO, nunca el error crudo", async () => {
    mkdirSyncMock.mockReturnValue(undefined);
    writeFileSyncMock.mockImplementation(() => {
      throw new Error("EEXIST: file already exists, open '/tmp/chainpulse-prueba-revocacion/manifiesto-run-1.json'");
    });
    const { escribirManifiesto } = await import("../manifiestoIO");
    expect(() => escribirManifiesto(RUN_ID, manifiestoValido(), "ctx")).toThrow("ERROR_ESCRITURA_MANIFIESTO");
    expect(logErrorMock).toHaveBeenCalledWith("ctx", "ERROR_ESCRITURA_MANIFIESTO");
  });
});

describe("borrarManifiesto", () => {
  it("borra sin problemas -- devuelve true", async () => {
    unlinkSyncMock.mockReturnValue(undefined);
    const { borrarManifiesto } = await import("../manifiestoIO");
    expect(borrarManifiesto("/ruta.json", "ctx")).toBe(true);
  });

  it("el borrado falla -- devuelve false, nunca lanza (los datos de la base ya se limpiaron), codigo fijo registrado", async () => {
    unlinkSyncMock.mockImplementation(() => {
      throw new Error("EPERM: operation not permitted, unlink '/ruta.json'");
    });
    const { borrarManifiesto } = await import("../manifiestoIO");
    expect(borrarManifiesto("/ruta.json", "ctx")).toBe(false);
    expect(logErrorMock).toHaveBeenCalledWith("ctx", "ERROR_BORRADO_MANIFIESTO");
  });
});
