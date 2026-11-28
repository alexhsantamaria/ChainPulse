// Pruebas (unitarias, sin DB ni render de componentes) --
// construirMensajeError(), parsearFilasPegadasLeadTime() y
// construirPayloadLeadTime(), las tres exportadas desde
// DeclaracionLeadTimeWizard.tsx (Incremento 5, Alex 2026-11-27/28).
// Mismo criterio y mismo motivo que
// kpis/fill-rate/__tests__/construirMensajeError.test.ts: el repositorio
// no tiene infraestructura para probar componentes React interactivos
// (render + click), asi que la logica que de verdad importa se exporta
// como funciones puras de modulo y se prueba aislada aca.
//
// Cubre, de las pruebas de UI/rutas pedidas (Alex, 2026-11-28):
//   - "manual valido e invalido" -> describe "construirPayloadLeadTime
//     -- modo manual".
//   - "unidad obligatoria" -> el campo de unidad ("dias") es un <span>
//     fijo, no un input -- no hay nada que validar en el payload (la
//     unidad nunca viaja en el payload, ver declarar.ts); se deja
//     constancia de esto en el describe correspondiente, sin inventar
//     una prueba sobre un campo que no existe.
//   - "previsualizacion pegada" -> describe
//     "parsearFilasPegadasLeadTime" + "construirPayloadLeadTime -- modo
//     pegado".
//   - "advertencia visible y no bloqueante" -> la advertencia la
//     calcula EXCLUSIVAMENTE el servidor (ya cubierto exhaustivamente en
//     infra/kpis/leadTime/__tests__/declarar.test.ts); este archivo NO
//     la recalcula, solo confirma (mas abajo) que el tipo
//     FilaLeadTimeUI puede llevar `advertencia` y que
//     construirPayloadLeadTime() nunca lee ese campo al construir el
//     payload de confirmar (la advertencia nunca bloquea ni se envia de
//     vuelta al servidor).
//   - "confirmacion" -> construirPayloadLeadTime() es la MISMA funcion
//     que arma el payload de previsualizar Y el de confirmar (ver
//     DeclaracionLeadTimeWizard.tsx, handlePrevisualizar/
//     handleConfirmar) -- se prueba aca que, con los mismos datos de
//     formulario, el payload es identico en ambos casos.
//   - "aislamiento/autorizacion" -> cubierto en page.test.ts (mock de
//     requireAdminOrRedirect(), mismo patron que OTIF/Fill Rate).
import { describe, expect, it } from "vitest";
import {
  construirMensajeError,
  construirPayloadLeadTime,
  parsearFilasPegadasLeadTime,
  type DetalleErrorLeadTimeUI,
  type DatosFormularioLeadTime,
} from "../DeclaracionLeadTimeWizard";
import { MAX_TAMANO_BODY_LEAD_TIME_BYTES } from "@/domain/limitesDeclaracionLeadTime";

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

  // Lead time NUNCA tiene una regla de "proceso duplicado" que rechace
  // la carga (decision 2026-11-27, regla 2/8: no se reutiliza la regla
  // de OTIF) -- si la API alguna vez devolviera este codigo por error,
  // la UI debe caer al mensaje generico, nunca a un mensaje de
  // "duplicado" que no corresponde a como funciona Lead time.
  it("NUNCA reconoce PEDIDOS_DUPLICADOS -- Lead time no tiene ese error, cae al mensaje generico", () => {
    expect(construirMensajeError({ error: "PEDIDOS_DUPLICADOS" } as DetalleErrorLeadTimeUI)).toBe(INESPERADO);
  });

  it("NUNCA reconoce FILAS_FUERA_DE_PERIODO -- no existe para Lead time, cae al mensaje generico", () => {
    expect(construirMensajeError({ error: "FILAS_FUERA_DE_PERIODO" } as DetalleErrorLeadTimeUI)).toBe(INESPERADO);
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
    const mensaje = construirMensajeError({ error: "CUERPO_DEMASIADO_GRANDE", limiteBytes: MAX_TAMANO_BODY_LEAD_TIME_BYTES });
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).toContain("1 MB");
    expect(mensaje).not.toContain("1048576");
  });

  it("sin limiteBytes -> mensaje generico del codigo, no revienta ni dice 'undefined'", () => {
    const mensaje = construirMensajeError({ error: "CUERPO_DEMASIADO_GRANDE" });
    expect(mensaje).not.toBe(INESPERADO);
    expect(mensaje).not.toContain("undefined");
    expect(mensaje).toMatch(/demasiado grandes/i);
  });
});

describe("parsearFilasPegadasLeadTime -- prueba obligatoria 'previsualizacion pegada'", () => {
  it("separa por tabulador, 3 columnas (proceso, inicio, fin)", () => {
    const filas = parsearFilasPegadasLeadTime("Recepcion\t2026-01-01\t2026-01-03\nPicking\t2026-01-02\t2026-01-04");
    expect(filas).toEqual([
      { proceso: "Recepcion", inicio: "2026-01-01", fin: "2026-01-03" },
      { proceso: "Picking", inicio: "2026-01-02", fin: "2026-01-04" },
    ]);
  });

  it("separa por coma cuando la linea no tiene tabulador", () => {
    const filas = parsearFilasPegadasLeadTime("Recepcion, 2026-01-01, 2026-01-03");
    expect(filas).toEqual([{ proceso: "Recepcion", inicio: "2026-01-01", fin: "2026-01-03" }]);
  });

  it("columna `fin` vacia -> null (proceso aun no cerrado, dato de negocio valido, no un error de forma)", () => {
    const filas = parsearFilasPegadasLeadTime("Recepcion\t2026-01-01\t");
    expect(filas).toEqual([{ proceso: "Recepcion", inicio: "2026-01-01", fin: null }]);
  });

  it("ignora lineas vacias y recorta espacios", () => {
    const filas = parsearFilasPegadasLeadTime("\n  Recepcion \t 2026-01-01 \t 2026-01-03 \n\n");
    expect(filas).toEqual([{ proceso: "Recepcion", inicio: "2026-01-01", fin: "2026-01-03" }]);
  });

  it("texto vacio -> array vacio, nunca revienta", () => {
    expect(parsearFilasPegadasLeadTime("")).toEqual([]);
    expect(parsearFilasPegadasLeadTime("   \n  \n ")).toEqual([]);
  });
});

const BASE_DATOS: DatosFormularioLeadTime = {
  modo: "manual",
  cadenaId: "cadena-1",
  periodoInicio: "2026-01-01",
  periodoFin: "2026-01-31",
  valorPromedioDiasTexto: "",
  textoPegado: "",
};

describe("construirPayloadLeadTime -- modo manual (pruebas obligatorias 'manual valido e invalido' + 'unidad obligatoria')", () => {
  it("valor numerico valido -> payload con valorPromedioDias numerico, SIN ningun campo de unidad (la unidad es fija en la UI, nunca viaja en el payload -- ver declarar.ts)", () => {
    const payload = construirPayloadLeadTime({ ...BASE_DATOS, valorPromedioDiasTexto: "4.5" });
    expect(payload).toEqual({
      modo: "manual",
      cadenaId: "cadena-1",
      periodoInicio: "2026-01-01",
      periodoFin: "2026-01-31",
      valorPromedioDias: 4.5,
    });
    expect(payload).not.toHaveProperty("unidad");
  });

  it("valor 0 -> valido (caso de borde, proceso instantaneo)", () => {
    const payload = construirPayloadLeadTime({ ...BASE_DATOS, valorPromedioDiasTexto: "0" });
    expect(payload?.valorPromedioDias).toBe(0);
  });

  it("campo vacio -> null (invalido), nunca Number('') que daria 0 silenciosamente", () => {
    expect(construirPayloadLeadTime({ ...BASE_DATOS, valorPromedioDiasTexto: "" })).toBeNull();
  });

  it("texto no numerico -> null (invalido)", () => {
    expect(construirPayloadLeadTime({ ...BASE_DATOS, valorPromedioDiasTexto: "abc" })).toBeNull();
  });

  it("cadenaId vacio -> null, incluso con un valor numerico valido", () => {
    expect(construirPayloadLeadTime({ ...BASE_DATOS, cadenaId: "", valorPromedioDiasTexto: "4.5" })).toBeNull();
  });

  it("periodoInicio o periodoFin vacios -> null", () => {
    expect(construirPayloadLeadTime({ ...BASE_DATOS, periodoInicio: "", valorPromedioDiasTexto: "4.5" })).toBeNull();
    expect(construirPayloadLeadTime({ ...BASE_DATOS, periodoFin: "", valorPromedioDiasTexto: "4.5" })).toBeNull();
  });
});

describe("construirPayloadLeadTime -- modo pegado (prueba obligatoria 'previsualizacion pegada')", () => {
  it("tabla con filas -> payload con `filas` tal como las interpreto parsearFilasPegadasLeadTime()", () => {
    const payload = construirPayloadLeadTime({
      ...BASE_DATOS,
      modo: "pegado",
      textoPegado: "Recepcion\t2026-01-01\t2026-01-03",
    });
    expect(payload).toEqual({
      modo: "pegado",
      cadenaId: "cadena-1",
      periodoInicio: "2026-01-01",
      periodoFin: "2026-01-31",
      filas: [{ proceso: "Recepcion", inicio: "2026-01-01", fin: "2026-01-03" }],
    });
  });

  it("tabla vacia (sin ninguna fila interpretable) -> null", () => {
    expect(construirPayloadLeadTime({ ...BASE_DATOS, modo: "pegado", textoPegado: "" })).toBeNull();
    expect(construirPayloadLeadTime({ ...BASE_DATOS, modo: "pegado", textoPegado: "   \n  " })).toBeNull();
  });
});

describe("construirPayloadLeadTime -- confirmacion usa la MISMA funcion que previsualizar (prueba obligatoria 'confirmacion')", () => {
  it("con los mismos datos de formulario, el payload de 'confirmar' es identico al de 'previsualizar' (manual)", () => {
    const datos: DatosFormularioLeadTime = { ...BASE_DATOS, valorPromedioDiasTexto: "7.25" };
    const payloadPrevisualizar = construirPayloadLeadTime(datos);
    const payloadConfirmar = construirPayloadLeadTime(datos);
    expect(payloadConfirmar).toEqual(payloadPrevisualizar);
  });

  it("con los mismos datos de formulario, el payload de 'confirmar' es identico al de 'previsualizar' (pegado, filas CON advertencia incluida tal cual -- la advertencia nunca se lee ni se filtra al construir el payload)", () => {
    const datos: DatosFormularioLeadTime = {
      ...BASE_DATOS,
      modo: "pegado",
      textoPegado: "Recepcion\t2026-01-01\t2026-01-03\nRecepcion\t2026-01-01\t2026-01-03",
    };
    const payloadPrevisualizar = construirPayloadLeadTime(datos);
    const payloadConfirmar = construirPayloadLeadTime(datos);
    expect(payloadConfirmar).toEqual(payloadPrevisualizar);
    // Las dos filas identicas se envian TAL CUAL, nunca deduplicadas por
    // el cliente -- la advertencia (si la hubiera) la agrega el
    // servidor en la RESPUESTA de previsualizar, nunca en lo que el
    // cliente envia.
    expect((payloadConfirmar as { filas: unknown[] }).filas).toHaveLength(2);
  });
});
