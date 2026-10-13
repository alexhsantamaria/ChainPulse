// Pruebas — verificacion de destino y rol para las herramientas de
// scripts/ (Alex, 2026-10-04, corregido en tercera ronda: la
// confirmacion ahora esta atada al destino exacto, no a un booleano
// suelto, y se contrasta contra lo que Postgres mismo devuelve).
// logError() mockeado para poder comprobar que un secreto simulado
// dentro de un error real NUNCA llega al logger -- mismo criterio que
// sessionVerification.test.ts.
import { describe, expect, it, vi, beforeEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("../../log", () => ({ logError: (...args: unknown[]) => logErrorMock(...args) }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ENTORNO_PRUEBA_CONFIRMADO;
});

const DESTINO_PRUEBA = {
  host: "host-de-prueba.neon.tech",
  puerto: "5432",
  base: "chainpulse_prueba",
  esquema: "public",
  usuario: "chainpulse_app",
};

describe("resumenUrl", () => {
  it("falta la variable -- codigo fijo, nunca el valor (que ni siquiera existe)", async () => {
    const { resumenUrl } = await import("../destinoPrueba");
    expect(() => resumenUrl("DATABASE_URL", undefined)).toThrow("FALTA_VARIABLE_DATABASE_URL");
  });

  it("parsea host/puerto/base/esquema/usuario, nunca la password (ni siquiera la devuelve)", async () => {
    const { resumenUrl } = await import("../destinoPrueba");
    const info = resumenUrl(
      "DATABASE_URL",
      "postgresql://chainpulse_app:ContraseñaSecreta123@host-de-prueba.neon.tech:5432/chainpulse_prueba?schema=public",
    );
    expect(info).toEqual(DESTINO_PRUEBA);
    expect(JSON.stringify(info)).not.toContain("ContraseñaSecreta123");
  });

  it('sin "?schema=" en la URL -- esquema default "public" (mismo default que Postgres/Prisma)', async () => {
    const { resumenUrl } = await import("../destinoPrueba");
    const info = resumenUrl("DATABASE_URL", "postgresql://chainpulse_app:x@host-de-prueba.neon.tech:5432/chainpulse_prueba");
    expect(info.esquema).toBe("public");
  });

  it("URL invalida CON UN SECRETO SIMULADO adentro -- codigo fijo, el secreto nunca llega al logger ni al error lanzado", async () => {
    const { resumenUrl } = await import("../destinoPrueba");
    const secreto = "password=ContraseñaSecreta123";
    let errorLanzado: unknown;
    try {
      resumenUrl("DATABASE_URL", `no-es-una-url-valida :: ${secreto}`);
    } catch (e) {
      errorLanzado = e;
    }
    expect(errorLanzado).toBeInstanceOf(Error);
    expect((errorLanzado as Error).message).toBe("URL_INVALIDA_DATABASE_URL");
    expect((errorLanzado as Error).message).not.toContain("ContraseñaSecreta123");
    expect(logErrorMock).toHaveBeenCalledWith("resumenUrl", "URL_INVALIDA_DATABASE_URL");
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls[0]);
    expect(argumentosRegistrados).not.toContain("ContraseñaSecreta123");
  });
});

describe("destinoConfirmado", () => {
  it("es deterministico para el mismo destino", async () => {
    const { destinoConfirmado } = await import("../destinoPrueba");
    expect(destinoConfirmado(DESTINO_PRUEBA)).toBe(destinoConfirmado({ ...DESTINO_PRUEBA }));
  });

  it("cambia si cambia cualquiera de host/puerto/base/esquema", async () => {
    const { destinoConfirmado } = await import("../destinoPrueba");
    const base = destinoConfirmado(DESTINO_PRUEBA);
    expect(destinoConfirmado({ ...DESTINO_PRUEBA, host: "otro-host" })).not.toBe(base);
    expect(destinoConfirmado({ ...DESTINO_PRUEBA, puerto: "5433" })).not.toBe(base);
    expect(destinoConfirmado({ ...DESTINO_PRUEBA, base: "otra_base" })).not.toBe(base);
    expect(destinoConfirmado({ ...DESTINO_PRUEBA, esquema: "otro_esquema" })).not.toBe(base);
  });
});

describe("exigirEntornoConfirmado", () => {
  it("sin la variable -- aborta", async () => {
    const { exigirEntornoConfirmado } = await import("../destinoPrueba");
    expect(() => exigirEntornoConfirmado(DESTINO_PRUEBA)).toThrow("ENTORNO_NO_CONFIRMADO");
  });

  it('con "si" suelto (el formato viejo) -- ya NO alcanza, aborta igual', async () => {
    process.env.ENTORNO_PRUEBA_CONFIRMADO = "si";
    const { exigirEntornoConfirmado } = await import("../destinoPrueba");
    expect(() => exigirEntornoConfirmado(DESTINO_PRUEBA)).toThrow("ENTORNO_NO_CONFIRMADO");
  });

  it("con el destino exacto confirmado -- no lanza", async () => {
    const { destinoConfirmado, exigirEntornoConfirmado } = await import("../destinoPrueba");
    process.env.ENTORNO_PRUEBA_CONFIRMADO = destinoConfirmado(DESTINO_PRUEBA);
    expect(() => exigirEntornoConfirmado(DESTINO_PRUEBA)).not.toThrow();
  });

  it("confirmado para un destino, pero la conexion cambio a otro -- aborta (el booleano viejo no lo detectaba)", async () => {
    const { destinoConfirmado, exigirEntornoConfirmado } = await import("../destinoPrueba");
    process.env.ENTORNO_PRUEBA_CONFIRMADO = destinoConfirmado(DESTINO_PRUEBA);
    const otroDestino = { ...DESTINO_PRUEBA, host: "host-distinto.neon.tech" };
    expect(() => exigirEntornoConfirmado(otroDestino)).toThrow("ENTORNO_NO_CONFIRMADO");
  });
});

describe("verificarRolConexion", () => {
  function clienteMock(filaRol: unknown[], filaAtributos: unknown[]) {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce(filaRol)
      .mockResolvedValueOnce(filaAtributos);
    return { $queryRaw: queryRaw };
  }

  it("rol esperado, sin BYPASSRLS ni superusuario -- devuelve el veredicto con esquemaActual", async () => {
    const { verificarRolConexion } = await import("../destinoPrueba");
    const cliente = clienteMock(
      [{ usuario_actual: "chainpulse_app", base_actual: "chainpulse_prueba", esquema_actual: "public" }],
      [{ rolbypassrls: false, rolsuper: false }],
    );
    const veredicto = await verificarRolConexion(cliente, "ctx", "chainpulse_app");
    expect(veredicto).toEqual({
      usuarioActual: "chainpulse_app",
      baseActual: "chainpulse_prueba",
      esquemaActual: "public",
      bypassrls: false,
      superuser: false,
    });
  });

  it("rol distinto del esperado -- ROL_INESPERADO", async () => {
    const { verificarRolConexion } = await import("../destinoPrueba");
    const cliente = clienteMock(
      [{ usuario_actual: "otro_rol", base_actual: "chainpulse_prueba", esquema_actual: "public" }],
      [{ rolbypassrls: false, rolsuper: false }],
    );
    await expect(verificarRolConexion(cliente, "ctx", "chainpulse_app")).rejects.toThrow("ROL_INESPERADO");
  });

  it("rol esperado pero con BYPASSRLS -- ROL_CON_ATRIBUTOS_INCOMPATIBLES", async () => {
    const { verificarRolConexion } = await import("../destinoPrueba");
    const cliente = clienteMock(
      [{ usuario_actual: "chainpulse_app", base_actual: "chainpulse_prueba", esquema_actual: "public" }],
      [{ rolbypassrls: true, rolsuper: false }],
    );
    await expect(verificarRolConexion(cliente, "ctx", "chainpulse_app")).rejects.toThrow(
      "ROL_CON_ATRIBUTOS_INCOMPATIBLES",
    );
  });

  it("rol esperado pero superusuario -- ROL_CON_ATRIBUTOS_INCOMPATIBLES", async () => {
    const { verificarRolConexion } = await import("../destinoPrueba");
    const cliente = clienteMock(
      [{ usuario_actual: "chainpulse_app", base_actual: "chainpulse_prueba", esquema_actual: "public" }],
      [{ rolbypassrls: false, rolsuper: true }],
    );
    await expect(verificarRolConexion(cliente, "ctx", "chainpulse_app")).rejects.toThrow(
      "ROL_CON_ATRIBUTOS_INCOMPATIBLES",
    );
  });

  it("la consulta falla CON UN SECRETO SIMULADO en el error -- codigo fijo, el secreto nunca llega al logger", async () => {
    const { verificarRolConexion } = await import("../destinoPrueba");
    const secreto = "DATABASE_URL=postgresql://chainpulse_app:ContraseñaSecreta123@host/db";
    const cliente = { $queryRaw: vi.fn().mockRejectedValue(new Error(`conexion perdida -- ${secreto}`)) };

    await expect(verificarRolConexion(cliente, "ctx-secreto", "chainpulse_app")).rejects.toThrow(
      "ERROR_CONSULTA_ROL",
    );
    expect(logErrorMock).toHaveBeenCalledWith("ctx-secreto", "ERROR_CONSULTA_ROL");
    const argumentosRegistrados = JSON.stringify(logErrorMock.mock.calls[0]);
    expect(argumentosRegistrados).not.toContain("ContraseñaSecreta123");
    expect(argumentosRegistrados).not.toContain(secreto);
  });

  it("respuesta vacia (sin filas) -- RESPUESTA_VACIA_VERIFICACION_ROL", async () => {
    const { verificarRolConexion } = await import("../destinoPrueba");
    const cliente = clienteMock([], [{ rolbypassrls: false, rolsuper: false }]);
    await expect(verificarRolConexion(cliente, "ctx", "chainpulse_app")).rejects.toThrow(
      "RESPUESTA_VACIA_VERIFICACION_ROL",
    );
  });
});

describe("verificarDestinoEfectivo", () => {
  const veredictoOk = {
    usuarioActual: "chainpulse_app",
    baseActual: "chainpulse_prueba",
    esquemaActual: "public",
    bypassrls: false,
    superuser: false,
  };

  it("base y esquema efectivos coinciden con lo esperado -- no lanza", async () => {
    const { verificarDestinoEfectivo } = await import("../destinoPrueba");
    expect(() => verificarDestinoEfectivo(veredictoOk, DESTINO_PRUEBA, "ctx")).not.toThrow();
  });

  it("la base que Postgres devuelve es distinta de la esperada -- BASE_EFECTIVA_DISTINTA_DE_LA_ESPERADA " +
    "(aunque la URL dijera otra cosa)", async () => {
    const { verificarDestinoEfectivo } = await import("../destinoPrueba");
    const veredicto = { ...veredictoOk, baseActual: "otra_base_real" };
    expect(() => verificarDestinoEfectivo(veredicto, DESTINO_PRUEBA, "ctx")).toThrow(
      "BASE_EFECTIVA_DISTINTA_DE_LA_ESPERADA",
    );
  });

  it("el esquema efectivo es distinto del esperado -- ESQUEMA_EFECTIVO_DISTINTO_DEL_ESPERADO", async () => {
    const { verificarDestinoEfectivo } = await import("../destinoPrueba");
    const veredicto = { ...veredictoOk, esquemaActual: "otro_esquema_real" };
    expect(() => verificarDestinoEfectivo(veredicto, DESTINO_PRUEBA, "ctx")).toThrow(
      "ESQUEMA_EFECTIVO_DISTINTO_DEL_ESPERADO",
    );
  });
});

describe("evaluarEstadoMigraciones", () => {
  it("todas aplicadas, nada pendiente", async () => {
    const { evaluarEstadoMigraciones } = await import("../destinoPrueba");
    const resultado = evaluarEstadoMigraciones(
      [{ migration_name: "m1", finished_at: new Date(), rolled_back_at: null }],
      ["m1"],
    );
    expect(resultado).toEqual({ aplicadas: ["m1"], pendientes: [], fallidasOInconclusas: [] });
  });

  it("una pendiente -- ni aplicada ni en la tabla todavia", async () => {
    const { evaluarEstadoMigraciones } = await import("../destinoPrueba");
    const resultado = evaluarEstadoMigraciones(
      [{ migration_name: "m1", finished_at: new Date(), rolled_back_at: null }],
      ["m1", "m2_pendiente"],
    );
    expect(resultado).toEqual({ aplicadas: ["m1"], pendientes: ["m2_pendiente"], fallidasOInconclusas: [] });
  });

  it("rolled_back_at distinto de null -- fallida/inconclusa, no pendiente ni aplicada", async () => {
    const { evaluarEstadoMigraciones } = await import("../destinoPrueba");
    const resultado = evaluarEstadoMigraciones(
      [{ migration_name: "m1", finished_at: new Date(), rolled_back_at: new Date() }],
      ["m1"],
    );
    expect(resultado).toEqual({ aplicadas: [], pendientes: [], fallidasOInconclusas: ["m1"] });
  });

  it("finished_at null (quedo a mitad de aplicar) -- fallida/inconclusa, no pendiente ni aplicada", async () => {
    const { evaluarEstadoMigraciones } = await import("../destinoPrueba");
    const resultado = evaluarEstadoMigraciones([{ migration_name: "m1", finished_at: null, rolled_back_at: null }], [
      "m1",
    ]);
    expect(resultado).toEqual({ aplicadas: [], pendientes: [], fallidasOInconclusas: ["m1"] });
  });

  it("mezcla real -- aplicada, inconclusa y pendiente a la vez", async () => {
    const { evaluarEstadoMigraciones } = await import("../destinoPrueba");
    const resultado = evaluarEstadoMigraciones(
      [
        { migration_name: "m1_ok", finished_at: new Date(), rolled_back_at: null },
        { migration_name: "m2_rollback", finished_at: new Date(), rolled_back_at: new Date() },
      ],
      ["m1_ok", "m2_rollback", "m3_pendiente"],
    );
    expect(resultado).toEqual({
      aplicadas: ["m1_ok"],
      pendientes: ["m3_pendiente"],
      fallidasOInconclusas: ["m2_rollback"],
    });
  });
});
