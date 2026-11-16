// Pruebas -- entornoPruebaZonaHoraria.ts (helper usado por las pruebas
// de date-only/timestamps en zona horaria negativa de varios archivos de
// src/app/dashboard/kpis/, ver su comentario de cabecera).
//
// Correccion de ronda de revision (2026-11-16): confirma el caso que
// motivo este helper -- cuando process.env.TZ NO estaba definida antes
// de simular una zona, la restauracion deja la variable REALMENTE
// ausente (ni el string "undefined" ni "" ni ningun otro valor), no
// solo con un valor "parecido a ausente".
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fijarZonaHorariaDePrueba, restaurarZonaHoraria } from "./entornoPruebaZonaHoraria";

// Guarda y restaura el TZ real del proceso de prueba alrededor de cada
// prueba de este archivo -- estas pruebas manipulan deliberadamente
// process.env.TZ (incluso borrandola) para poder probar ambos casos
// (definida / ausente), y no deben filtrar ningun valor hacia otras
// pruebas que corran despues en el mismo proceso.
let tzDelProcesoDePrueba: string | undefined;

beforeEach(() => {
  tzDelProcesoDePrueba = process.env.TZ;
});

afterEach(() => {
  restaurarZonaHoraria(tzDelProcesoDePrueba);
});

describe("fijarZonaHorariaDePrueba / restaurarZonaHoraria", () => {
  it("si TZ NO estaba definida antes, la restauracion la deja REALMENTE ausente (no el string \"undefined\")", () => {
    delete process.env.TZ;
    expect(process.env.TZ).toBeUndefined();

    const restaurar = fijarZonaHorariaDePrueba("America/Lima");
    expect(process.env.TZ).toBe("America/Lima");

    restaurar();

    expect(process.env.TZ).toBeUndefined();
    // No alcanza con que el valor sea "undefined" en JS -- hay que
    // confirmar que la clave ni siquiera esta presente en process.env
    // (que es lo que distingue "ausente" de la cadena literal
    // "undefined", que es a lo que Node convierte `x = undefined` en
    // una variable de entorno).
    expect(Object.prototype.hasOwnProperty.call(process.env, "TZ")).toBe(false);
  });

  it("si TZ SI estaba definida antes, la restauracion la deja exactamente en ese valor original", () => {
    process.env.TZ = "Europe/Moscow";

    const restaurar = fijarZonaHorariaDePrueba("America/Lima");
    expect(process.env.TZ).toBe("America/Lima");

    restaurar();

    expect(process.env.TZ).toBe("Europe/Moscow");
  });

  it("restaurarZonaHoraria(undefined) llamada directamente tambien deja la variable ausente, no el string \"undefined\"", () => {
    process.env.TZ = "America/Lima";

    restaurarZonaHoraria(undefined);

    expect(process.env.TZ).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(process.env, "TZ")).toBe(false);
  });
});
