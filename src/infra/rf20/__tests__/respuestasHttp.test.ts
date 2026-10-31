import { describe, expect, it } from "vitest";
import { esErrorOrigenInexistente, respuestaRechazoGobernanza } from "../respuestasHttp";

describe("respuestaRechazoGobernanza", () => {
  it.each(["VERSION_INEXISTENTE", "PREGUNTA_INEXISTENTE", "RF20_ORIGEN_INEXISTENTE"])(
    "mapea %s a 404 (recurso de la URL inexistente)",
    async (motivo) => {
      const respuesta = respuestaRechazoGobernanza(motivo);
      expect(respuesta.status).toBe(404);
      expect(await respuesta.json()).toEqual({ ok: false, motivo });
    },
  );

  it.each(["VERSION_NO_ES_BORRADOR", "SECUENCIA_INVALIDA", "VERSION_PUBLICADA_CONCURRENTE", "CUALQUIER_OTRO"])(
    "mapea cualquier otro motivo (%s) a 409",
    async (motivo) => {
      const respuesta = respuestaRechazoGobernanza(motivo);
      expect(respuesta.status).toBe(409);
    },
  );

  it("respeta un status explicito por encima de la regla por defecto", () => {
    const respuesta = respuestaRechazoGobernanza("VERSION_INEXISTENTE", 422);
    expect(respuesta.status).toBe(422);
  });
});

describe("esErrorOrigenInexistente", () => {
  it("reconoce el prefijo fijo del RAISE EXCEPTION de corregir_cuestionario_version()", () => {
    expect(esErrorOrigenInexistente(new Error("RF20_ORIGEN_INEXISTENTE: no existe v9"))).toBe(true);
  });

  it("no confunde otros errores ni valores no-Error", () => {
    expect(esErrorOrigenInexistente(new Error("otra falla"))).toBe(false);
    expect(esErrorOrigenInexistente("RF20_ORIGEN_INEXISTENTE")).toBe(false);
    expect(esErrorOrigenInexistente(null)).toBe(false);
  });
});
