// Pruebas — requireSession()/requireAdmin() (ya existian, sin pruebas
// propias hasta ahora) y requireSessionOrRedirect()/requireAdminOrRedirect()
// (nuevos, Alex 2026-10-03, diagnostico-eliminacion-cuenta-prueba.md
// Seccion 8). auth(), verificarSesionVigente() y next/navigation.redirect()
// van mockeados (vi.mock) -- unitarias, sin red ni Prisma real. Las
// pruebas de integracion quedan pendientes de autorizacion aparte.
import { describe, expect, it, vi, beforeEach } from "vitest";

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));

const verificarSesionVigenteMock = vi.fn();
vi.mock("../sessionVerification", () => ({
  verificarSesionVigente: (...args: unknown[]) => verificarSesionVigenteMock(...args),
}));

// redirect() de Next.js nunca retorna -- en produccion lanza un error
// especial que el framework intercepta al renderizar. Para que el
// comportamiento de las funciones que lo usan (parar ahi mismo, no seguir
// ejecutando) sea observable en una prueba unitaria, el mock reproduce
// eso: lanza un Error con la ruta adentro, en vez de ser un no-op.
const redirectMock = vi.fn((ruta: string) => {
  throw new Error(`REDIRECT:${ruta}`);
});
vi.mock("next/navigation", () => ({ redirect: (ruta: string) => redirectMock(ruta) }));

const SESION_ADMIN_RAW = {
  id: "usuario-1",
  empresaId: "empresa-1",
  email: "admin@chainpulse.test",
  name: "Admin",
  rol: "ADMINISTRADOR",
  eslabonId: null,
  sessionVersion: 1,
};
const SESION_RESPONSABLE_RAW = { ...SESION_ADMIN_RAW, id: "usuario-2", rol: "RESPONSABLE", eslabonId: "eslabon-1" };

beforeEach(() => {
  vi.clearAllMocks();
  verificarSesionVigenteMock.mockResolvedValue({ vigente: true });
});

describe("requireSession", () => {
  it("sin sesion -- 401 NO_SESION, nunca llega a verificar vigencia", async () => {
    const { requireSession } = await import("../session");
    authMock.mockResolvedValue(null);

    const resultado = await requireSession();

    expect("respuesta" in resultado && resultado.respuesta.status).toBe(401);
    expect(verificarSesionVigenteMock).not.toHaveBeenCalled();
  });

  it("sesion valida y vigente -- devuelve la sesion mapeada", async () => {
    const { requireSession } = await import("../session");
    authMock.mockResolvedValue({ user: SESION_ADMIN_RAW });

    const resultado = await requireSession();

    expect("sesion" in resultado && resultado.sesion.usuarioId).toBe("usuario-1");
    expect(verificarSesionVigenteMock).toHaveBeenCalledWith("usuario-1", "empresa-1", 1);
  });

  it("sesion valida pero NO vigente (eliminada/revocada/error) -- mismo 401 NO_SESION que sin sesion, sin distinguir el motivo al cliente", async () => {
    const { requireSession } = await import("../session");
    authMock.mockResolvedValue({ user: SESION_ADMIN_RAW });
    verificarSesionVigenteMock.mockResolvedValue({ vigente: false, motivo: "REVOCADA" });

    const resultado = await requireSession();

    expect("respuesta" in resultado && resultado.respuesta.status).toBe(401);
    const cuerpo = "respuesta" in resultado ? await resultado.respuesta.json() : null;
    expect(cuerpo).toEqual({ ok: false, error: "NO_SESION" });
  });

  it("propaga el claim sessionVersion del JWT tal cual, incluso si es undefined (JWT viejo)", async () => {
    const { requireSession } = await import("../session");
    const sinClaim = {
      id: SESION_ADMIN_RAW.id,
      empresaId: SESION_ADMIN_RAW.empresaId,
      email: SESION_ADMIN_RAW.email,
      name: SESION_ADMIN_RAW.name,
      rol: SESION_ADMIN_RAW.rol,
      eslabonId: SESION_ADMIN_RAW.eslabonId,
    };
    authMock.mockResolvedValue({ user: sinClaim });

    await requireSession();

    expect(verificarSesionVigenteMock).toHaveBeenCalledWith("usuario-1", "empresa-1", undefined);
  });
});

describe("requireAdmin", () => {
  it("rol RESPONSABLE con sesion vigente -- 403 NO_AUTORIZADO", async () => {
    const { requireAdmin } = await import("../session");
    authMock.mockResolvedValue({ user: SESION_RESPONSABLE_RAW });

    const resultado = await requireAdmin();

    expect("respuesta" in resultado && resultado.respuesta.status).toBe(403);
  });

  it("rol ADMINISTRADOR con sesion vigente -- devuelve la sesion", async () => {
    const { requireAdmin } = await import("../session");
    authMock.mockResolvedValue({ user: SESION_ADMIN_RAW });

    const resultado = await requireAdmin();

    expect("sesion" in resultado && resultado.sesion.rol).toBe("ADMINISTRADOR");
  });

  it("sesion no vigente -- 401, nunca llega a evaluar el rol", async () => {
    const { requireAdmin } = await import("../session");
    authMock.mockResolvedValue({ user: SESION_ADMIN_RAW });
    verificarSesionVigenteMock.mockResolvedValue({ vigente: false, motivo: "ELIMINADA" });

    const resultado = await requireAdmin();

    expect("respuesta" in resultado && resultado.respuesta.status).toBe(401);
  });
});

describe("requireSessionOrRedirect", () => {
  it("sin sesion -- redirige a /login antes de tocar la base", async () => {
    const { requireSessionOrRedirect } = await import("../session");
    authMock.mockResolvedValue(null);

    await expect(requireSessionOrRedirect()).rejects.toThrow("REDIRECT:/login");
    expect(verificarSesionVigenteMock).not.toHaveBeenCalled();
  });

  it("sesion valida y vigente -- devuelve la sesion mapeada (no redirige)", async () => {
    const { requireSessionOrRedirect } = await import("../session");
    authMock.mockResolvedValue({ user: SESION_ADMIN_RAW });

    const sesion = await requireSessionOrRedirect();

    expect(sesion.usuarioId).toBe("usuario-1");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("sesion no vigente -- redirige a /login", async () => {
    const { requireSessionOrRedirect } = await import("../session");
    authMock.mockResolvedValue({ user: SESION_ADMIN_RAW });
    verificarSesionVigenteMock.mockResolvedValue({ vigente: false, motivo: "ELIMINADA" });

    await expect(requireSessionOrRedirect()).rejects.toThrow("REDIRECT:/login");
  });

  it("ruta personalizada", async () => {
    const { requireSessionOrRedirect } = await import("../session");
    authMock.mockResolvedValue(null);

    await expect(requireSessionOrRedirect("/otra-ruta")).rejects.toThrow("REDIRECT:/otra-ruta");
  });
});

describe("requireAdminOrRedirect", () => {
  it("rol no admin con sesion vigente -- redirige a /dashboard por defecto", async () => {
    const { requireAdminOrRedirect } = await import("../session");
    authMock.mockResolvedValue({ user: SESION_RESPONSABLE_RAW });

    await expect(requireAdminOrRedirect()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("rol ADMINISTRADOR con sesion vigente -- devuelve la sesion (no redirige)", async () => {
    const { requireAdminOrRedirect } = await import("../session");
    authMock.mockResolvedValue({ user: SESION_ADMIN_RAW });

    const sesion = await requireAdminOrRedirect();

    expect(sesion.rol).toBe("ADMINISTRADOR");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("sin sesion -- redirige a /login, no a /dashboard", async () => {
    const { requireAdminOrRedirect } = await import("../session");
    authMock.mockResolvedValue(null);

    await expect(requireAdminOrRedirect()).rejects.toThrow("REDIRECT:/login");
  });

  it("rutas personalizadas para ambos casos", async () => {
    const { requireAdminOrRedirect } = await import("../session");
    authMock.mockResolvedValue({ user: SESION_RESPONSABLE_RAW });

    await expect(requireAdminOrRedirect("/no-autorizado", "/ingresar")).rejects.toThrow("REDIRECT:/no-autorizado");
  });

  it("aislamiento -- revocar/eliminar a un usuario no cambia el resultado de otro usuario distinto en la misma empresa", async () => {
    const { requireAdminOrRedirect } = await import("../session");
    // Usuario distinto, misma empresa: su propia verificacion de vigencia
    // sigue devolviendo "vigente" independientemente de lo que le haya
    // pasado a otra cuenta -- verificarSesionVigente() se llama una vez
    // por request, con el usuarioId de ESTA sesion, nunca el de otra.
    authMock.mockResolvedValue({ user: { ...SESION_ADMIN_RAW, id: "usuario-otro" } });

    await requireAdminOrRedirect();

    expect(verificarSesionVigenteMock).toHaveBeenCalledTimes(1);
    expect(verificarSesionVigenteMock).toHaveBeenCalledWith("usuario-otro", "empresa-1", 1);
  });
});
