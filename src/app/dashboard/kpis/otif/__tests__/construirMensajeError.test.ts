// Pruebas (unitarias, sin DB ni render de componentes) -- construirMensajeError(),
// DeclaracionOtifWizard.tsx (piloto OTIF, Incremento 4 Bloque B). El
// repositorio no tiene infraestructura para probar componentes React
// (sin @testing-library/react ni jsdom configurado en vitest.config.ts),
// asi que, por pedido explicito de Alex (2026-10-10, "aisla y proba la
// funcion que construye esos mensajes"), esta funcion se exporta desde el
// componente y se prueba de forma aislada, pasandole directamente el
// objeto de respuesta en vez de simular un fetch + render.
import { describe, expect, it } from "vitest";
import { construirMensajeError, type DetalleErrorOtifUI } from "../DeclaracionOtifWizard";
import { MAX_TAMANO_BODY_OTIF_BYTES } from "@/domain/limitesDeclaracionOtif";

const INESPERADO = "Ocurrió un error inesperado -- intentá de nuevo en un momento.";

describe("construirMensajeError -- casos preexistentes (sin detalle estructurado)", () => {
  it("sin respuesta (undefined) -> mensaje generico", () => {
    expect(construirMensajeError(undefined)).toBe(INESPERADO);
  });

  it("respuesta sin codigo de error -> mensaje generico", () => {
    expect(construirMensajeError({})).toBe(INESPERADO);
  });

  it("codigo reconocido sin detalle (DATOS_INVALIDOS) -> mensaje fijo tal cual antes", () => {
    expect(construirMensajeError({ error: "DATOS_INVALIDOS" })).toBe("Faltan datos o hay un valor inválido -- revisá el formulario.");
  });

  it("codigo reconocido (NO_SESION) -> mensaje fijo", () => {
    expect(construirMensajeError({ error: "NO_SESION" })).toBe("Tu sesión expiró -- volvé a iniciar sesión.");
  });

  it("codigo nuevo CUERPO_INVALIDO (leerCuerpoJsonLimitado -- JSON malformado) -> mensaje reconocido, no generico", () => {
    expect(construirMensajeError({ error: "CUERPO_INVALIDO" })).not.toBe(INESPERADO);
    expect(construirMensajeError({ error: "CUERPO_INVALIDO" })).toMatch(/formato/i);
  });

  it("codigo desconocido -> mensaje generico (nunca revienta ni muestra el codigo crudo)", () => {
    expect(construirMensajeError({ error: "ALGO_QUE_NO_EXISTE" })).toBe(INESPERADO);
  });
});

describe("construirMensajeError -- PEDIDOS_DUPLICADOS (Alex 2026-10-10)", () => {
  it("con pedidos -> los identifica en el mensaje, sin caer en 'error inesperado'", () => {
    const mensaje = construirMensajeError({ error: "PEDIDOS_DUPLICADOS", pedidos: ["PED-1", "PED-2"] });
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).toContain("PED-1");
    expect(mensaje).toContain("PED-2");
    expect(mensaje).toMatch(/duplicad/i);
  });

  it("sin pedidos (campo ausente) -> mensaje generico del codigo, no revienta", () => {
    const mensaje = construirMensajeError({ error: "PEDIDOS_DUPLICADOS" });
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).toMatch(/duplicad/i);
  });

  it("con mas pedidos que el tope de presentacion -> trunca y agrega cuantos quedan afuera", () => {
    const pedidos = Array.from({ length: 25 }, (_, i) => `PED-${i}`);
    const mensaje = construirMensajeError({ error: "PEDIDOS_DUPLICADOS", pedidos });
    expect(mensaje).toContain("PED-0");
    expect(mensaje).toContain("PED-19");
    expect(mensaje).not.toContain("PED-20");
    expect(mensaje).toMatch(/5 más/);
  });
});

describe("construirMensajeError -- FILAS_FUERA_DE_PERIODO (Alex 2026-10-10)", () => {
  it("con pedidos -> los identifica en el mensaje", () => {
    const mensaje = construirMensajeError({ error: "FILAS_FUERA_DE_PERIODO", pedidos: ["PED-9"] });
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).toContain("PED-9");
    expect(mensaje).toMatch(/per[ií]odo/i);
  });

  it("sin pedidos -> mensaje generico del codigo", () => {
    const mensaje = construirMensajeError({ error: "FILAS_FUERA_DE_PERIODO" });
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).toMatch(/per[ií]odo/i);
  });
});

describe("construirMensajeError -- DEMASIADAS_FILAS (Alex 2026-10-10)", () => {
  it("con limite y recibidas -> los incluye en el mensaje", () => {
    const mensaje = construirMensajeError({ error: "DEMASIADAS_FILAS", limite: 2000, recibidas: 2001 });
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).toContain("2000");
    expect(mensaje).toContain("2001");
  });

  it("sin limite/recibidas -> mensaje generico del codigo, no revienta", () => {
    const mensaje = construirMensajeError({ error: "DEMASIADAS_FILAS" });
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).toMatch(/demasiadas filas/i);
  });
});

describe("construirMensajeError -- CUERPO_DEMASIADO_GRANDE (Alex 2026-10-10)", () => {
  it("con limiteBytes exactamente 1 MB -> lo muestra en MB, legible (no '1048576 bytes')", () => {
    const mensaje = construirMensajeError({ error: "CUERPO_DEMASIADO_GRANDE", limiteBytes: MAX_TAMANO_BODY_OTIF_BYTES });
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).toContain("1 MB");
    expect(mensaje).not.toContain("1048576");
  });

  it("con limiteBytes que no es un multiplo exacto de MB -> muestra un decimal", () => {
    const mensaje = construirMensajeError({ error: "CUERPO_DEMASIADO_GRANDE", limiteBytes: 1.5 * 1024 * 1024 });
    expect(mensaje).toContain("1.5 MB");
  });

  it("con limiteBytes menor a 1 MB -> lo muestra en KB", () => {
    const mensaje = construirMensajeError({ error: "CUERPO_DEMASIADO_GRANDE", limiteBytes: 512 * 1024 });
    expect(mensaje).toContain("512 KB");
  });

  it("sin limiteBytes -> mensaje generico del codigo, no revienta ni dice 'undefined'", () => {
    const mensaje = construirMensajeError({ error: "CUERPO_DEMASIADO_GRANDE" });
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).not.toContain("undefined");
    expect(mensaje).toMatch(/demasiado grandes/i);
  });
});

describe("construirMensajeError -- tipo DetalleErrorOtifUI", () => {
  it("acepta exactamente los campos que las rutas pueden devolver", () => {
    const detalle: DetalleErrorOtifUI = {
      error: "PEDIDOS_DUPLICADOS",
      pedidos: ["PED-1"],
      limite: 2000,
      recibidas: 2001,
      limiteBytes: MAX_TAMANO_BODY_OTIF_BYTES,
    };
    expect(construirMensajeError(detalle)).not.toBe(INESPERADO);
  });
});
