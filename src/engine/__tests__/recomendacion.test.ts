// Pruebas — valida la generacion de recomendaciones priorizadas (RF8).
import { describe, expect, it } from "vitest";
import { generarRecomendacion } from "../recomendacion";

describe("generarRecomendacion", () => {
  it("salud critica siempre es prioridad ALTA, sin importar la dependencia", () => {
    const r = generarRecomendacion({ gradoDependencia: "BAJA", salud: 20, tieneAlternativa: true });
    expect(r.prioridad).toBe("ALTA");
  });

  it("salud baja + dependencia alta sin alternativa -> prioridad ALTA, sugiere definir respaldo", () => {
    const r = generarRecomendacion({ gradoDependencia: "CRITICA", salud: 55, tieneAlternativa: false });
    expect(r.prioridad).toBe("ALTA");
    expect(r.texto).toMatch(/respaldo/i);
  });

  it("salud baja + dependencia baja -> prioridad MEDIA, sugiere una conversacion puntual", () => {
    const r = generarRecomendacion({ gradoDependencia: "BAJA", salud: 55, tieneAlternativa: true });
    expect(r.prioridad).toBe("MEDIA");
    expect(r.texto).toMatch(/conversación/i);
  });

  it("salud aceptable + dependencia alta sin alternativa -> prioridad MEDIA (punto unico de falla latente)", () => {
    const r = generarRecomendacion({ gradoDependencia: "ALTA", salud: 85, tieneAlternativa: false });
    expect(r.prioridad).toBe("MEDIA");
    expect(r.texto).toMatch(/respaldo/i);
  });

  it("salud aceptable + dependencia alta CON alternativa -> prioridad BAJA", () => {
    const r = generarRecomendacion({ gradoDependencia: "ALTA", salud: 85, tieneAlternativa: true });
    expect(r.prioridad).toBe("BAJA");
    expect(r.texto).toMatch(/alternativa declarada/i);
  });

  it("salud aceptable + dependencia baja -> prioridad BAJA", () => {
    const r = generarRecomendacion({ gradoDependencia: "BAJA", salud: 90, tieneAlternativa: true });
    expect(r.prioridad).toBe("BAJA");
  });

  it("es determinista: misma entrada siempre da la misma salida", () => {
    const entrada = { gradoDependencia: "MEDIA" as const, salud: 45, tieneAlternativa: false };
    expect(generarRecomendacion(entrada)).toEqual(generarRecomendacion(entrada));
  });
});
