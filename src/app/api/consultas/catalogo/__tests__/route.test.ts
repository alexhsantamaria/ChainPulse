// Pruebas -- GET /api/consultas/catalogo. requireSession mockeado;
// listarCatalogoConsultas() corre REAL (es pura, I5-08) -- misma razon
// que otros route.test.ts de esta suite: esta prueba es de la RUTA
// (autenticacion, filtro por rol), no del catalogo en si (eso lo cubre
// infra/queries/__tests__/catalogo.test.ts).
import { describe, expect, it, vi, beforeEach } from "vitest";

const requireSessionMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({ requireSession: (...args: unknown[]) => requireSessionMock(...args) }));

const SESION_ADMIN = { usuarioId: "u1", empresaId: "e1", rol: "ADMINISTRADOR", email: "a@b.com", nombre: null, eslabonId: null };
const SESION_RESPONSABLE = { usuarioId: "u2", empresaId: "e1", rol: "RESPONSABLE", email: "b@b.com", nombre: null, eslabonId: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/consultas/catalogo -- autenticacion", () => {
  it("sin sesion valida -- devuelve la respuesta de requireSession tal cual (401), nunca el catalogo", async () => {
    const { NextResponse } = await import("next/server");
    requireSessionMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 }) });

    const { GET } = await import("../route");
    const respuesta = await GET();

    expect(respuesta.status).toBe(401);
  });
});

describe("GET /api/consultas/catalogo -- contenido", () => {
  it("ADMINISTRADOR ve las 6 preguntas del catalogo (I5-08)", async () => {
    requireSessionMock.mockResolvedValue({ sesion: SESION_ADMIN });
    const { GET } = await import("../route");
    const respuesta = await GET();
    const cuerpo = await respuesta.json();

    expect(respuesta.status).toBe(200);
    expect(cuerpo.ok).toBe(true);
    expect(cuerpo.catalogo).toHaveLength(6);
  });

  it("RESPONSABLE tambien ve las 6 (todas las entradas actuales permiten ambos roles)", async () => {
    requireSessionMock.mockResolvedValue({ sesion: SESION_RESPONSABLE });
    const { GET } = await import("../route");
    const respuesta = await GET();
    const cuerpo = await respuesta.json();

    expect(cuerpo.catalogo).toHaveLength(6);
  });

  it("cada entrada expone solo metadata -- nunca una funcion ni un detalle de implementacion (id, titulo, descripcion, requierePeriodo)", async () => {
    requireSessionMock.mockResolvedValue({ sesion: SESION_ADMIN });
    const { GET } = await import("../route");
    const respuesta = await GET();
    const cuerpo = await respuesta.json();

    for (const entrada of cuerpo.catalogo) {
      expect(typeof entrada.id).toBe("string");
      expect(typeof entrada.titulo).toBe("string");
      expect(typeof entrada.descripcion).toBe("string");
      expect(typeof entrada.requierePeriodo).toBe("boolean");
      expect(entrada.ejecutor).toBeUndefined();
    }
  });
});
