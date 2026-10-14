// Pruebas (unitarias, sin DB ni render de componentes) -- construirMensajeError(),
// DeclaracionFillRateWizard.tsx (Incremento 4 Bloque B). Mismo criterio y
// mismo motivo que
// kpis/otif/__tests__/construirMensajeError.test.ts (Alex 2026-10-10:
// "aisla y proba la funcion que construye esos mensajes"): el repositorio
// no tiene infraestructura para probar componentes React, asi que esta
// funcion se exporta desde el componente y se prueba de forma aislada.
// SIN los casos FILAS_FUERA_DE_PERIODO (no existen para Fill Rate, que no
// tiene fecha de fila).
import { describe, expect, it } from "vitest";
import { construirMensajeError, type DetalleErrorFillRateUI } from "../DeclaracionFillRateWizard";
import { MAX_TAMANO_BODY_FILL_RATE_BYTES } from "@/domain/limitesDeclaracionFillRate";

const INESPERADO = "Ocurrió un error inesperado -- intentá de nuevo en un momento.";

describe("construirMensajeError -- casos sin detalle estructurado", () => {
  it("sin respuesta (undefined) -> mensaje generico", () => {
    expect(construirMensajeError(undefined)).toBe(INESPERADO);
  });

  it("respuesta sin codigo de error -> mensaje generico", () => {
    expect(construirMensajeError({})).toBe(INESPERADO);
  });

  it("codigo reconocido sin detalle (DATOS_INVALIDOS) -> mensaje fijo", () => {
    expect(construirMensajeError({ error: "DATOS_INVALIDOS" })).toBe("Faltan datos o hay un valor inválido -- revisá el formulario.");
  });

  it("codigo reconocido (NO_SESION) -> mensaje fijo", () => {
    expect(construirMensajeError({ error: "NO_SESION" })).toBe("Tu sesión expiró -- volvé a iniciar sesión.");
  });

  it("codigo TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES -> mensaje reconocido, no generico", () => {
    expect(construirMensajeError({ error: "TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES" })).not.toBe(INESPERADO);
  });

  it("codigo CUERPO_INVALIDO (leerCuerpoJsonLimitado -- JSON malformado) -> mensaje reconocido, no generico", () => {
    expect(construirMensajeError({ error: "CUERPO_INVALIDO" })).not.toBe(INESPERADO);
    expect(construirMensajeError({ error: "CUERPO_INVALIDO" })).toMatch(/formato/i);
  });

  it("codigo desconocido -> mensaje generico (nunca revienta ni muestra el codigo crudo)", () => {
    expect(construirMensajeError({ error: "ALGO_QUE_NO_EXISTE" })).toBe(INESPERADO);
  });

  it("NUNCA reconoce FILAS_FUERA_DE_PERIODO -- no existe para Fill Rate, cae al mensaje generico del codigo desconocido", () => {
    expect(construirMensajeError({ error: "FILAS_FUERA_DE_PERIODO", pedidos: ["PED-1"] })).toBe(INESPERADO);
  });
});

describe("construirMensajeError -- PEDIDOS_DUPLICADOS", () => {
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

describe("construirMensajeError -- DEMASIADAS_FILAS", () => {
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

describe("construirMensajeError -- CUERPO_DEMASIADO_GRANDE", () => {
  it("con limiteBytes exactamente 1 MB -> lo muestra en MB, legible (no '1048576 bytes')", () => {
    const mensaje = construirMensajeError({ error: "CUERPO_DEMASIADO_GRANDE", limiteBytes: MAX_TAMANO_BODY_FILL_RATE_BYTES });
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

describe("construirMensajeError -- tipo DetalleErrorFillRateUI", () => {
  it("acepta exactamente los campos que las rutas pueden devolver", () => {
    const detalle: DetalleErrorFillRateUI = {
      error: "PEDIDOS_DUPLICADOS",
      pedidos: ["PED-1"],
      limite: 2000,
      recibidas: 2001,
      limiteBytes: MAX_TAMANO_BODY_FILL_RATE_BYTES,
    };
    expect(construirMensajeError(detalle)).not.toBe(INESPERADO);
  });
});
