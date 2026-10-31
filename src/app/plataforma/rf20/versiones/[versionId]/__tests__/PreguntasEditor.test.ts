// Pruebas focalizadas -- deuda de revision del PR 8, hallazgo Medio
// (try/catch/finally faltante en los fetch() de escritura de RF20).
// validarOpciones() es la UNICA pieza de PreguntasEditor.tsx sin hooks
// ni JSX (no depende de useState/useRouter para ejecutarse), asi que es
// la unica que se puede probar sin jsdom/Testing Library -- el resto de
// las funciones corregidas en este archivo (guardar/eliminar/mover/
// agregar) son closures de componente que necesitarian renderizar el
// arbol y simular eventos, fuera del alcance permitido aqui (ver
// informe de entrega de PR 8, brecha de pruebas de UI).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validarOpciones } from "../PreguntasEditor";

describe("validarOpciones", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("JSON invalido -- nunca llega a llamar a fetch", async () => {
    const resultado = await validarOpciones("{ esto no es json");

    expect(resultado).toBe("JSON invalido.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fallo de red (fetch rechaza) -- mensaje generico, nunca el detalle crudo del error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch: ECONNREFUSED 10.0.0.1:443"));

    const resultado = await validarOpciones("[]");

    expect(resultado).toBe("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
  });

  it("estructura valida -- mismo mensaje que antes de la correccion", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, valido: true }),
    });

    const resultado = await validarOpciones("[]");

    expect(resultado).toBe("Estructura válida.");
  });

  it("estructura invalida -- conserva el motivo devuelto por el servidor", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, valido: false, motivo: "OPCIONES_DUPLICADAS" }),
    });

    const resultado = await validarOpciones("[]");

    expect(resultado).toBe("Inválida: OPCIONES_DUPLICADAS");
  });

  it("respuesta HTTP de error -- conserva el comportamiento previo (nunca entra al catch)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => null,
    });

    const resultado = await validarOpciones("[]");

    expect(resultado).toBe("No se pudo validar (HTTP 500).");
  });
});
