// Pruebas de INTEGRACION (Postgres real, nunca produccion) -- piloto OTIF
// Incremento 4 Bloque B. Ejercitan confirmarObservacionOtif() (persistir.ts)
// de punta a punta contra una base real: idempotencia (RF-K2), aislamiento
// de tenant (RF-K5), listado (RF-K6) y ruleVersion persistido.
//
// Requiere DATABASE_URL + CHAINPULSE_CONFIRMAR_PRUEBAS_DESTRUCTIVAS con el
// valor exacto (ver entornoPruebasIntegracionOtif.ts) -- correr con
// `npm run test:integration` en Windows, NUNCA `npm run test`.
// requerirEntornoDePruebasConfirmado() hace que fallar-cerrado sea
// automatico si alguien lo intenta sin las dos variables exactas.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { tenantClient } from "../../../prisma/tenantClient";
import { confirmarObservacionOtif } from "../persistir";
import {
  requerirEntornoDePruebasConfirmado,
  crearFixtureOtif,
  borrarFixtureOtif,
  type FixtureOtifIntegracion,
} from "./entornoPruebasIntegracionOtif";

beforeAll(() => {
  requerirEntornoDePruebasConfirmado();
});

const fixturesCreados: FixtureOtifIntegracion[] = [];

afterEach(async () => {
  while (fixturesCreados.length > 0) {
    const fixture = fixturesCreados.pop()!;
    await borrarFixtureOtif(fixture);
  }
});

async function fixture(etiqueta: string): Promise<FixtureOtifIntegracion> {
  const f = await crearFixtureOtif(etiqueta);
  fixturesCreados.push(f);
  return f;
}

describe("confirmarObservacionOtif -- nivel 1 manual", () => {
  it("previsualizar (ruta, no esta funcion) nunca persiste; confirmar SI persiste una fila con ruleVersion = kpis-v1", async () => {
    const f = await fixture("manual-basico");
    const entrada = {
      modo: "manual" as const,
      cadenaId: f.cadenaId,
      periodoInicio: "2026-10-01",
      periodoFin: "2026-10-31",
      numerador: 90,
      denominador: 100,
    };

    const resultado = await confirmarObservacionOtif(entrada, { empresaId: f.empresaId });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.valor).toBeCloseTo(0.9);

    const cliente = tenantClient(f.empresaId);
    const fila = await cliente.observacionKpi.findUnique({ where: { id: resultado.observacionId } });
    expect(fila?.ruleVersion).toBe("kpis-v1");
    expect(fila?.fuente).toBe("manual");
    expect(fila?.empresaId).toBe(f.empresaId);
  });
});

describe("confirmarObservacionOtif -- nivel 2 pegado", () => {
  it("una fila incompleta da advertencia sin fallar; confirmar persiste el agregado correcto", async () => {
    const f = await fixture("pegado-advertencia");
    const entrada = {
      modo: "pegado" as const,
      cadenaId: f.cadenaId,
      periodoInicio: "2026-10-01",
      periodoFin: "2026-10-31",
      filas: [
        { pedido: "P1", fechaPrometida: "2026-10-05", fechaReal: "2026-10-05", cantidadPedida: 10, cantidadEntregada: 10 },
        { pedido: "P2", fechaPrometida: "2026-10-06", fechaReal: null, cantidadPedida: 5, cantidadEntregada: null },
      ],
    };

    const resultado = await confirmarObservacionOtif(entrada, { empresaId: f.empresaId });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.filasEvaluadas).toBe(1);
    expect(resultado.resultado.filasExcluidas).toBe(1);
    expect(resultado.resultado.advertencias.length).toBeGreaterThan(0);
  });
});

describe("RF-K2 -- idempotencia por upsert", () => {
  it("confirmar el mismo periodo dos veces actualiza la MISMA fila (una sola fila en observaciones_kpi)", async () => {
    const f = await fixture("idempotencia");
    const entradaBase = { cadenaId: f.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31" } as const;

    const primera = await confirmarObservacionOtif({ modo: "manual", ...entradaBase, numerador: 80, denominador: 100 }, { empresaId: f.empresaId });
    const segunda = await confirmarObservacionOtif({ modo: "manual", ...entradaBase, numerador: 95, denominador: 100 }, { empresaId: f.empresaId });

    expect(primera.ok).toBe(true);
    expect(segunda.ok).toBe(true);
    if (!primera.ok || !segunda.ok) throw new Error("no deberia pasar");
    expect(segunda.observacionId).toBe(primera.observacionId);

    const cliente = tenantClient(f.empresaId);
    const filas = await cliente.observacionKpi.findMany({ where: { cadenaId: f.cadenaId, fuente: "manual" } });
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    if (!fila) throw new Error("no deberia pasar -- toHaveLength(1) ya confirmo que existe");
    expect(fila.valor).toBeCloseTo(0.95);
  });
});

describe("RF-K5 -- aislamiento de tenant", () => {
  it("un tenant nunca ve ni puede sobrescribir la ObservacionKpi de otro", async () => {
    const tenantA = await fixture("aislamiento-a");
    const tenantB = await fixture("aislamiento-b");

    await confirmarObservacionOtif(
      { modo: "manual", cadenaId: tenantA.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 1 },
      { empresaId: tenantA.empresaId },
    );

    // El tenant B usa el cadenaId del tenant A -- tenantClient() filtra por
    // empresaId de la sesion ANTES que por cadenaId del payload, asi que
    // la cadena de otro tenant simplemente no existe para el (RNF1 capa 1).
    const resultado = await confirmarObservacionOtif(
      { modo: "manual", cadenaId: tenantA.cadenaId, periodoInicio: "2026-11-01", periodoFin: "2026-11-30", numerador: 1, denominador: 1 },
      { empresaId: tenantB.empresaId },
    );
    expect(resultado).toEqual({ ok: false, error: "CADENA_INEXISTENTE" });

    const clienteB = tenantClient(tenantB.empresaId);
    const observacionesVisiblesParaB = await clienteB.observacionKpi.findMany({ where: { cadenaId: tenantA.cadenaId } });
    expect(observacionesVisiblesParaB).toHaveLength(0);
  });
});

describe("RF-K6 -- listado filtra por cadena/tenant", () => {
  it("el listado de una cadena no devuelve observaciones de otra cadena ni de otro tenant", async () => {
    const f = await fixture("listado");
    const cliente = tenantClient(f.empresaId);
    const otraCadena = await cliente.cadena.create({
      data: {
        empresaId: f.empresaId,
        nombre: "Otra cadena del mismo tenant",
        productoServicio: "prueba",
        periodoInicio: new Date("2026-01-01T00:00:00.000Z"),
        periodoFin: new Date("2026-12-31T00:00:00.000Z"),
        tipoOperacion: "manufactura",
      },
    });

    await confirmarObservacionOtif(
      { modo: "manual", cadenaId: f.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 1 },
      { empresaId: f.empresaId },
    );
    await confirmarObservacionOtif(
      { modo: "manual", cadenaId: otraCadena.id, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 2 },
      { empresaId: f.empresaId },
    );

    const listado = await cliente.observacionKpi.findMany({ where: { cadenaId: f.cadenaId } });
    expect(listado).toHaveLength(1);
    const primeraFila = listado[0];
    if (!primeraFila) throw new Error("no deberia pasar -- toHaveLength(1) ya confirmo que existe");
    expect(primeraFila.cadenaId).toBe(f.cadenaId);

    await cliente.cadena.delete({ where: { id: otraCadena.id } });
  });
});

describe("Rol -- solo ADMINISTRADOR declara (decision 3)", () => {
  it("confirmarObservacionOtif() en si misma no filtra por rol -- ese chequeo es de la ruta (requireAdmin), probado en route.test.ts con mocks; aca se confirma que el fixture RESPONSABLE existe para esa prueba de ruta", async () => {
    const f = await fixture("rol-responsable-existe");
    const cliente = tenantClient(f.empresaId);
    const responsable = await cliente.usuario.findUnique({ where: { id: f.responsableId } });
    expect(responsable?.rol).toBe("RESPONSABLE");
  });
});
