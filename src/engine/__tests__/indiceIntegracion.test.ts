import { describe, expect, it } from "vitest";
import { calcularIndiceIntegracion } from "../indiceIntegracion";

describe("calcularIndiceIntegracion", () => {
  it("combina % de conexiones aceptables con la penalizacion por puntos unicos de falla", () => {
    const r = calcularIndiceIntegracion([
      { salud: 80, criticidad: 90, tieneAlternativa: false }, // aceptable + SPOF
      { salud: 60, criticidad: 30, tieneAlternativa: true }, // no aceptable, no SPOF
    ]);
    expect(r.conexionesAceptables).toBe(1);
    expect(r.puntosUnicosFalla).toBe(1);
    expect(r.indiceIntegracion).toBe(40); // 50 base - 10 de penalizacion
  });

  it("una conexion critica CON alternativa declarada no cuenta como punto unico de falla", () => {
    const r = calcularIndiceIntegracion([{ salud: 80, criticidad: 90, tieneAlternativa: true }]);
    expect(r.puntosUnicosFalla).toBe(0);
    expect(r.indiceIntegracion).toBe(100);
  });

  it("sin conexiones, el indice es 0 y no explota por division entre cero", () => {
    const r = calcularIndiceIntegracion([]);
    expect(r.indiceIntegracion).toBe(0);
    expect(r.totalConexiones).toBe(0);
  });

  it("nunca baja de 0 aunque la penalizacion supere la base", () => {
    const r = calcularIndiceIntegracion([
      { salud: 10, criticidad: 90, tieneAlternativa: false },
      { salud: 10, criticidad: 90, tieneAlternativa: false },
    ]);
    expect(r.indiceIntegracion).toBe(0);
  });
});
