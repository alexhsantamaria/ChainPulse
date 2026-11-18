// Pruebas (unitarias, sin DB ni render de componentes) --
// construirMensajeError(), ConsultasPanel.tsx (Incremento 5). Mismo
// criterio que dashboard/kpis/otif/__tests__/construirMensajeError.test.ts:
// el repositorio no tiene @testing-library/react ni jsdom configurado,
// asi que la funcion pura se exporta desde el componente y se prueba
// aislada.
import { describe, expect, it } from "vitest";
import { construirMensajeError, debeMostrarReintentar } from "../ConsultasPanel";

const INESPERADO = "Ocurrió un error inesperado -- intentá de nuevo en un momento.";

describe("construirMensajeError", () => {
  it("sin codigo (undefined) -> mensaje generico", () => {
    expect(construirMensajeError(undefined)).toBe(INESPERADO);
  });

  it.each(["CATALOGO_ID_INVALIDO", "CADENA_INEXISTENTE", "PERMISO_DENEGADO", "PERIODO_REQUERIDO", "PERIODO_INVALIDO", "PERIODO_DEMASIADO_LARGO"])(
    "%s -- mensaje especifico de Incremento 5, nunca el generico",
    (codigo) => {
      expect(construirMensajeError(codigo)).not.toBe(INESPERADO);
    },
  );

  it("NO_SESION -> mensaje reconocido (compartido con el resto de la app)", () => {
    expect(construirMensajeError("NO_SESION")).toMatch(/sesión/i);
  });

  it("ERROR_RED -> mensaje reconocido", () => {
    expect(construirMensajeError("ERROR_RED")).toMatch(/conectar|conexión/i);
  });

  it("codigo desconocido -> mensaje generico (nunca revienta ni muestra el codigo crudo)", () => {
    expect(construirMensajeError("ALGO_QUE_NO_EXISTE")).toBe(INESPERADO);
  });

  it("SIN_DATOS_SUFICIENTES nunca deberia llegar aca en la practica, pero si llega no revienta", () => {
    expect(() => construirMensajeError("SIN_DATOS_SUFICIENTES")).not.toThrow();
  });
});


describe("construirMensajeError -- Incremento 5 PR1 (limite de tasa)", () => {
  it("LIMITE_TASA_EXCEDIDO -- mensaje especifico, nunca expone el contador real ni la huella", () => {
    const mensaje = construirMensajeError("LIMITE_TASA_EXCEDIDO");
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).toMatch(/espera|momento/i);
  });

  it("SERVICIO_NO_DISPONIBLE -- mensaje especifico (fail-closed de infraestructura)", () => {
    expect(construirMensajeError("SERVICIO_NO_DISPONIBLE")).not.toBe(INESPERADO);
  });
});

describe("construirMensajeError -- Incremento 5 PR2 (presupuesto de computo)", () => {
  it("PRESUPUESTO_COMPUTO_EXCEDIDO -- mensaje especifico, nunca el generico, nunca expone duracionMs", () => {
    const mensaje = construirMensajeError("PRESUPUESTO_COMPUTO_EXCEDIDO");
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).toMatch(/tiempo de cálculo|período más corto/i);
    expect(mensaje).not.toMatch(/\d/); // nunca un numero (ni duracionMs ni presupuestoMs) en el texto al usuario
  });
});

// debeMostrarReintentar() -- Incremento 5 PR1. NOTA DE COBERTURA (a
// pedido explicito de Alex: nunca declarar un boton "renderizado y
// operativo" sin poder probarlo de verdad): este repositorio NO tiene
// @testing-library/react ni jsdom instalados (ver el comentario de
// arriba y vitest.config.ts, environment:"node") -- por eso aca solo se
// prueba la funcion PURA que decide si el boton deberia aparecer, nunca
// el click real del boton ni que ejecutarConsulta() se vuelva a llamar
// al presionarlo. Esa verificacion de extremo a extremo (render + click)
// queda pendiente como hueco de cobertura documentado -- requeriria
// agregar jsdom + @testing-library/react como dependencias de
// desarrollo nuevas, fuera del alcance decidido para este PR1 sin
// autorizacion separada.
describe("debeMostrarReintentar", () => {
  it.each(["LIMITE_TASA_EXCEDIDO", "SERVICIO_NO_DISPONIBLE"])(
    "%s -- SI deberia mostrar el boton Reintentar (falla transitoria, no de formulario)",
    (codigo) => {
      expect(debeMostrarReintentar(codigo)).toBe(true);
    },
  );

  it.each(["CATALOGO_ID_INVALIDO", "PERIODO_INVALIDO", "PERMISO_DENEGADO", "CADENA_INEXISTENTE"])(
    "%s -- NO deberia mostrar el boton (reintentar sin cambiar el formulario fallaria igual)",
    (codigo) => {
      expect(debeMostrarReintentar(codigo)).toBe(false);
    },
  );

  // Incremento 5 PR2, decision explicita de Alex (a diferencia de
  // LIMITE_TASA_EXCEDIDO/SERVICIO_NO_DISPONIBLE): reintentar el MISMO
  // pedido sin cambiar nada (mismos datos, mismo periodo) muy
  // probablemente vuelve a exceder el presupuesto -- no es una falla
  // transitoria que el tiempo por si solo resuelva.
  it("PRESUPUESTO_COMPUTO_EXCEDIDO -- NO deberia mostrar el boton Reintentar", () => {
    expect(debeMostrarReintentar("PRESUPUESTO_COMPUTO_EXCEDIDO")).toBe(false);
  });

  it("undefined -- no muestra el boton", () => {
    expect(debeMostrarReintentar(undefined)).toBe(false);
  });
});
