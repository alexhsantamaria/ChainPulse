// Pruebas — conPisoDeTiempo (Ronda 5, R5-2).
import { describe, expect, it, vi } from "vitest";
import { conPisoDeTiempo } from "./timing";

describe("conPisoDeTiempo", () => {
  it("espera el piso minimo aunque el trabajo real termine antes", async () => {
    vi.useFakeTimers();
    const trabajoRapido = Promise.resolve("listo");
    let resuelto = false;
    const promesa = conPisoDeTiempo(trabajoRapido, 400).then((r) => {
      resuelto = true;
      return r;
    });

    // El trabajo real ya resolvio (es un Promise.resolve), pero el piso
    // de tiempo todavia no paso -- conPisoDeTiempo no debe resolver antes.
    await Promise.resolve(); // deja correr microtasks pendientes
    await Promise.resolve();
    vi.advanceTimersByTime(399);
    await Promise.resolve();
    expect(resuelto).toBe(false);

    vi.advanceTimersByTime(1);
    const resultado = await promesa;
    expect(resultado).toBe("listo");
    expect(resuelto).toBe(true);
    vi.useRealTimers();
  });

  it("no espera de mas si el trabajo real tarda mas que el piso", async () => {
    // R5-2 -- reescrita con fake timers (antes medía Date.now() de pared
    // contra un setTimeout real de 20ms con un piso de tolerancia de solo
    // 5ms: el jitter normal del scheduler hacia que "transcurrido" diera
    // 19ms de vez en cuando, un test flaky sin relacion con un bug real).
    // Con fake timers el avance de tiempo es exacto: se verifica que la
    // promesa no resuelve antes de que el trabajo real (20ms) termine, y
    // que resuelve apenas eso pasa -- el piso (5ms, menor al trabajo real)
    // no debe agregar ninguna espera extra.
    vi.useFakeTimers();
    const trabajoLento = new Promise<string>((resolve) => setTimeout(() => resolve("listo"), 20));
    let resuelto = false;
    const promesa = conPisoDeTiempo(trabajoLento, 5).then((r) => {
      resuelto = true;
      return r;
    });

    await Promise.resolve();
    vi.advanceTimersByTime(19);
    await Promise.resolve();
    expect(resuelto).toBe(false);

    vi.advanceTimersByTime(1);
    const resultado = await promesa;
    expect(resultado).toBe("listo");
    expect(resuelto).toBe(true);
    vi.useRealTimers();
  });

  it("propaga el valor resuelto del trabajo real, no del piso", async () => {
    const resultado = await conPisoDeTiempo(Promise.resolve({ dato: 42 }), 1);
    expect(resultado).toEqual({ dato: 42 });
  });
});
