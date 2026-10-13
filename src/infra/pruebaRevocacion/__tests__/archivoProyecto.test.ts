// Pruebas — resolucion de rutas del proyecto y lectura del directorio
// de migraciones (Alex, 2026-10-04, punto 6 y punto 2 de la segunda
// correccion). "fs" mockeado -- no toca el disco real.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { sep } from "path";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

const readdirSyncMock = vi.fn();
vi.mock("fs", () => ({ readdirSync: (...args: unknown[]) => readdirSyncMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("directorioProyecto / rutaEsquemaPrisma", () => {
  it("rutaEsquemaPrisma() termina en prisma/schema.prisma, dentro del directorio del proyecto resuelto", async () => {
    const { directorioProyecto, rutaEsquemaPrisma } = await import("../archivoProyecto");
    const raiz = directorioProyecto();
    const esquema = rutaEsquemaPrisma();
    expect(esquema).toBe(`${raiz}${sep}prisma${sep}schema.prisma`);
    // nunca relativo a la carpeta de trabajo de quien corre el script --
    // es siempre el mismo valor, sin importar process.cwd().
    expect(esquema.startsWith(sep) || /^[A-Za-z]:/.test(esquema)).toBe(true);
  });
});

describe("migracionesEnRepo", () => {
  it("lista las migraciones, excluyendo migration_lock.toml", async () => {
    readdirSyncMock.mockReturnValue(["20260101000000_a", "migration_lock.toml", "20260102000000_b"]);
    const { migracionesEnRepo } = await import("../archivoProyecto");
    expect(migracionesEnRepo("ctx")).toEqual(["20260101000000_a", "20260102000000_b"]);
  });

  it("la lectura falla -- ERROR_LECTURA_CARPETA_MIGRACIONES, nunca el error crudo de fs", async () => {
    readdirSyncMock.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory, scandir '/ruta/real/del/sistema'");
    });
    const { migracionesEnRepo } = await import("../archivoProyecto");
    expect(() => migracionesEnRepo("ctx")).toThrow("ERROR_LECTURA_CARPETA_MIGRACIONES");
    expect(logErrorMock).toHaveBeenCalledWith("ctx", "ERROR_LECTURA_CARPETA_MIGRACIONES");
  });
});
