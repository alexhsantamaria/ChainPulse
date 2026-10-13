// Pruebas — invocacion de "prisma migrate deploy" y de la comprobacion
// inocua de lanzamiento (Alex, 2026-10-04, punto 3 de la tercera
// correccion: reemplazar execFileSync("npx"/"npx.cmd", ...) por
// process.execPath + la entrada JS de Prisma, resuelta via el campo
// "bin" de su propio package.json). execFileSync y la resolucion de
// package.json estan ambas inyectadas -- ninguna prueba lanza un
// subproceso real ni toca node_modules.
import { describe, expect, it, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
});

const OPCIONES = { directorioProyecto: "/proyecto", rutaEsquema: "/proyecto/prisma/schema.prisma" };
const RUTA_CLI_RESUELTA = "/proyecto/node_modules/prisma/build/index.js";

function depsResolucionOk(rutaCli: string = RUTA_CLI_RESUELTA) {
  return {
    resolverPackageJson: vi.fn().mockReturnValue("/proyecto/node_modules/prisma/package.json"),
    leerArchivo: vi.fn().mockReturnValue(JSON.stringify({ bin: { prisma: "build/index.js" } })),
  };
}

describe("resolverEntradaCliPrisma", () => {
  it("lee el campo bin.prisma del package.json resuelto y arma la ruta absoluta de la entrada", async () => {
    const { resolverEntradaCliPrisma } = await import("../subproceso");
    const deps = depsResolucionOk();
    const ruta = resolverEntradaCliPrisma("ctx", deps);
    expect(deps.resolverPackageJson).toHaveBeenCalledWith("prisma/package.json");
    expect(ruta).toBe(RUTA_CLI_RESUELTA);
  });

  it('tambien acepta "bin" como string plano (algunos paquetes lo declaran asi)', async () => {
    const { resolverEntradaCliPrisma } = await import("../subproceso");
    const deps = {
      resolverPackageJson: vi.fn().mockReturnValue("/proyecto/node_modules/prisma/package.json"),
      leerArchivo: vi.fn().mockReturnValue(JSON.stringify({ bin: "build/index.js" })),
    };
    const ruta = resolverEntradaCliPrisma("ctx", deps);
    expect(ruta).toBe(RUTA_CLI_RESUELTA);
  });

  it("package.json sin bin.prisma -- aborta con codigo fijo, nunca el error real", async () => {
    const { resolverEntradaCliPrisma } = await import("../subproceso");
    const deps = {
      resolverPackageJson: vi.fn().mockReturnValue("/proyecto/node_modules/prisma/package.json"),
      leerArchivo: vi.fn().mockReturnValue(JSON.stringify({ bin: { otraCosa: "x.js" } })),
    };
    expect(() => resolverEntradaCliPrisma("ctx", deps)).toThrow("ERROR_RESOLUCION_CLI_PRISMA");
    expect(logErrorMock).toHaveBeenCalledWith("ctx", "ERROR_RESOLUCION_CLI_PRISMA");
  });

  it("la resolucion del package.json falla CON UN SECRETO SIMULADO -- codigo fijo, el secreto nunca llega al logger", async () => {
    const { resolverEntradaCliPrisma } = await import("../subproceso");
    const secreto = "/Users/alx/.ssh/id_rsa";
    const deps = {
      resolverPackageJson: vi.fn().mockImplementation(() => {
        throw new Error(`no se pudo resolver -- revisar ${secreto}`);
      }),
      leerArchivo: vi.fn(),
    };
    expect(() => resolverEntradaCliPrisma("ctx-secreto", deps)).toThrow("ERROR_RESOLUCION_CLI_PRISMA");
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls[0]);
    expect(argumentosRegistrados).not.toContain(secreto);
  });
});

describe("ejecutarMigrateDeploy", () => {
  it("usa process.execPath (nunca npx/npx.cmd) con la ruta de la CLI resuelta como primer argumento", async () => {
    const ejecutarMock = vi.fn().mockReturnValue("");
    const resolverEntradaMock = vi.fn().mockReturnValue(RUTA_CLI_RESUELTA);
    const { ejecutarMigrateDeploy } = await import("../subproceso");
    ejecutarMigrateDeploy(OPCIONES, "ctx", ejecutarMock, resolverEntradaMock);
    expect(resolverEntradaMock).toHaveBeenCalledWith("ctx");
    expect(ejecutarMock).toHaveBeenCalledWith(
      process.execPath,
      [RUTA_CLI_RESUELTA, "migrate", "deploy", "--schema", OPCIONES.rutaEsquema],
      { cwd: OPCIONES.directorioProyecto, stdio: "inherit" },
    );
  });

  it("nunca pasa por npx ni npx.cmd, en ninguna plataforma", async () => {
    const ejecutarMock = vi.fn().mockReturnValue("");
    const resolverEntradaMock = vi.fn().mockReturnValue(RUTA_CLI_RESUELTA);
    const { ejecutarMigrateDeploy } = await import("../subproceso");
    ejecutarMigrateDeploy(OPCIONES, "ctx", ejecutarMock, resolverEntradaMock);
    const [comando] = ejecutarMock.mock.calls[0]!;
    expect(comando).not.toBe("npx");
    expect(comando).not.toBe("npx.cmd");
    expect(comando).toBe(process.execPath);
  });

  it("fija --schema con la ruta absoluta revisada y cwd al directorio del proyecto, nunca relativo", async () => {
    const ejecutarMock = vi.fn().mockReturnValue("");
    const resolverEntradaMock = vi.fn().mockReturnValue(RUTA_CLI_RESUELTA);
    const { ejecutarMigrateDeploy } = await import("../subproceso");
    ejecutarMigrateDeploy(OPCIONES, "ctx", ejecutarMock, resolverEntradaMock);
    const [, args, opts] = ejecutarMock.mock.calls[0]!;
    expect(args).toContain("--schema");
    expect(args[args.indexOf("--schema") + 1]).toBe(OPCIONES.rutaEsquema);
    expect(opts.cwd).toBe(OPCIONES.directorioProyecto);
    expect(opts.stdio).toBe("inherit");
  });

  it("si la resolucion de la CLI falla, nunca llega a invocar execFileSync", async () => {
    const ejecutarMock = vi.fn();
    const resolverEntradaMock = vi.fn().mockImplementation(() => {
      throw new Error("ERROR_RESOLUCION_CLI_PRISMA");
    });
    const { ejecutarMigrateDeploy } = await import("../subproceso");
    expect(() => ejecutarMigrateDeploy(OPCIONES, "ctx", ejecutarMock, resolverEntradaMock)).toThrow(
      "ERROR_RESOLUCION_CLI_PRISMA",
    );
    expect(ejecutarMock).not.toHaveBeenCalled();
  });

  it("el subproceso falla CON UN SECRETO SIMULADO en el error -- codigo fijo, el secreto nunca llega al logger", async () => {
    const secreto = "DATABASE_URL=postgresql://chainpulse_app:ContraseñaSecreta123@host/db";
    const ejecutarMock = vi.fn().mockImplementation(() => {
      throw new Error(`comando fallo -- entorno: ${secreto}`);
    });
    const resolverEntradaMock = vi.fn().mockReturnValue(RUTA_CLI_RESUELTA);
    const { ejecutarMigrateDeploy } = await import("../subproceso");
    expect(() =>
      ejecutarMigrateDeploy(OPCIONES, "ctx-secreto", ejecutarMock, resolverEntradaMock),
    ).toThrow("ERROR_MIGRATE_DEPLOY");
    expect(logErrorMock).toHaveBeenCalledWith("ctx-secreto", "ERROR_MIGRATE_DEPLOY");
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls[0]);
    expect(argumentosRegistrados).not.toContain("ContraseñaSecreta123");
  });
});

describe("verificarLanzamientoPrisma", () => {
  it('corre "<cli> --version" via process.execPath, nunca requiere --schema', async () => {
    const ejecutarMock = vi.fn().mockReturnValue("prisma : 7.0.0\n");
    const resolverEntradaMock = vi.fn().mockReturnValue(RUTA_CLI_RESUELTA);
    const { verificarLanzamientoPrisma } = await import("../subproceso");
    const salida = verificarLanzamientoPrisma("ctx", ejecutarMock, resolverEntradaMock);
    expect(ejecutarMock).toHaveBeenCalledWith(
      process.execPath,
      [RUTA_CLI_RESUELTA, "--version"],
      expect.objectContaining({ stdio: "pipe" }),
    );
    expect(salida).toContain("7.0.0");
  });

  it("nunca pasa --schema ni depende de un directorio de proyecto especifico", async () => {
    const ejecutarMock = vi.fn().mockReturnValue("");
    const resolverEntradaMock = vi.fn().mockReturnValue(RUTA_CLI_RESUELTA);
    const { verificarLanzamientoPrisma } = await import("../subproceso");
    verificarLanzamientoPrisma("ctx", ejecutarMock, resolverEntradaMock);
    const [, args] = ejecutarMock.mock.calls[0]!;
    expect(args).not.toContain("--schema");
    expect(args).not.toContain("migrate");
  });

  it("el lanzamiento falla CON UN SECRETO SIMULADO -- codigo fijo, el secreto nunca llega al logger", async () => {
    const secreto = "C:\\Users\\alex\\AppData\\secretos.txt";
    const ejecutarMock = vi.fn().mockImplementation(() => {
      throw new Error(`no se pudo lanzar -- ver ${secreto}`);
    });
    const resolverEntradaMock = vi.fn().mockReturnValue(RUTA_CLI_RESUELTA);
    const { verificarLanzamientoPrisma } = await import("../subproceso");
    expect(() => verificarLanzamientoPrisma("ctx-secreto", ejecutarMock, resolverEntradaMock)).toThrow(
      "ERROR_VERIFICACION_LANZAMIENTO_PRISMA",
    );
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls[0]);
    expect(argumentosRegistrados).not.toContain(secreto);
  });
});
