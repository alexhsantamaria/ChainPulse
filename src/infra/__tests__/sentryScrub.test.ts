// Pruebas — scrubbing explicito de PII antes de mandar un evento a Sentry
// (PLAN-DE-TRABAJO.md Seccion 18.1.B). Evento sintetico con los campos
// sensibles reales del dominio en varios lugares distintos del evento,
// para confirmar que el redactado no depende de en que parte haya
// terminado el dato (extra, contexts, user, request.data, breadcrumbs).
import { describe, expect, it } from "vitest";
import { scrubEventoSentry } from "../sentryScrub";

function eventoSintetico() {
  return {
    message: "Error en api/public/evaluations/[id]/unlock POST",
    user: {
      id: "anonimo",
      email: "visitante@ejemplo.com",
    },
    extra: {
      correo: "visitante@ejemplo.com",
      telefono: "+51 999 999 999",
      nombreCompleto: "Visitante de Prueba",
      empresaNombre: "Empresa de Prueba SAC",
      huellaOrigen: "203.0.113.5",
      huellaOrigenHash: "abc123",
      descripcionLibre: "Detalle sensible escrito por el usuario",
      evaluacionExpresV2Id: "cmu7j4hxw00008wuf3u53zh30", // no sensible, debe sobrevivir
    },
    contexts: {
      datosDelFormulario: {
        correo: "otra@ejemplo.com",
        productoServicio: "Envasado de frutas congeladas", // no sensible
      },
    },
    request: {
      data: {
        correo: "tercera@ejemplo.com",
        consentimientoDiagnostico: true, // no sensible
      },
      headers: {
        "x-forwarded-for": "203.0.113.5",
      },
    },
    breadcrumbs: [
      {
        message: "respuesta guardada",
        data: { correo: "cuarta@ejemplo.com", codigoPregunta: "Q1" },
      },
    ],
  };
}

describe("scrubEventoSentry", () => {
  it("redacta los campos sensibles sin importar en que parte del evento aparezcan", () => {
    const evento = eventoSintetico();
    const scrubbed = scrubEventoSentry(evento);

    expect(scrubbed.user.email).toBe("[redactado]");
    expect(scrubbed.extra.correo).toBe("[redactado]");
    expect(scrubbed.extra.telefono).toBe("[redactado]");
    expect(scrubbed.extra.nombreCompleto).toBe("[redactado]");
    expect(scrubbed.extra.empresaNombre).toBe("[redactado]");
    expect(scrubbed.extra.huellaOrigen).toBe("[redactado]");
    expect(scrubbed.extra.huellaOrigenHash).toBe("[redactado]");
    expect(scrubbed.extra.descripcionLibre).toBe("[redactado]");
    expect(scrubbed.contexts.datosDelFormulario.correo).toBe("[redactado]");
    expect(scrubbed.request.data.correo).toBe("[redactado]");
    expect(scrubbed.breadcrumbs[0]?.data.correo).toBe("[redactado]");
  });

  it("nunca toca campos que no estan en la lista de sensibles", () => {
    const evento = eventoSintetico();
    const scrubbed = scrubEventoSentry(evento);

    expect(scrubbed.message).toBe(evento.message);
    expect(scrubbed.user.id).toBe("anonimo");
    expect(scrubbed.extra.evaluacionExpresV2Id).toBe("cmu7j4hxw00008wuf3u53zh30");
    expect(scrubbed.contexts.datosDelFormulario.productoServicio).toBe("Envasado de frutas congeladas");
    expect(scrubbed.request.data.consentimientoDiagnostico).toBe(true);
    expect(scrubbed.request.headers["x-forwarded-for"]).toBe("203.0.113.5");
    expect(scrubbed.breadcrumbs[0]?.data.codigoPregunta).toBe("Q1");
  });

  it("no muta el evento original", () => {
    const evento = eventoSintetico();
    scrubEventoSentry(evento);
    expect(evento.extra.correo).toBe("visitante@ejemplo.com");
  });

  it("funciona con un evento minimo, sin ninguno de los campos sensibles", () => {
    const evento = { message: "algo fallo", extra: { codigo: "500" } };
    expect(scrubEventoSentry(evento)).toEqual(evento);
  });

  it("nunca lanza, incluso ante una forma de evento inesperada", () => {
    const evento = { extra: null, circular: {} as Record<string, unknown> };
    evento.circular.self = evento.circular; // referencia circular
    expect(() => scrubEventoSentry(evento)).not.toThrow();
  });
});
