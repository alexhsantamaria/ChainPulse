// Pruebas de INTEGRACION (Postgres real, nunca produccion) -- Incremento
// 5 PR3, OTIF Proveedor real. Ejercitan confirmarObservacionOtifProveedor()
// (persistir.ts) de punta a punta contra una base real: identidad SIN
// `fuente` (Alex, punto 4), confirmacion atomica multi-proveedor (punto
// 11), aislamiento de tenant, y DefinicionKpi/ruleVersion persistidos.
//
// Requiere DATABASE_URL + CHAINPULSE_CONFIRMAR_PRUEBAS_DESTRUCTIVAS con
// el valor exacto (ver entornoPruebasIntegracionOtifProveedor.ts) --
// correr con `npm run test:integration` en Windows, NUNCA `npm run
// test` (mismo criterio que declararObservacionOtif.integration.test.ts
// -- Alex, punto 19 de esta ronda: preparadas y excluidas de la suite
// normal, NO ejecutadas en esta sesion ni conectadas a Neon).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { tenantClient } from "../../../prisma/tenantClient";
import { confirmarObservacionOtifProveedor } from "../persistir";
import {
  requerirEntornoDePruebasConfirmado,
  crearFixtureOtifProveedor,
  borrarFixtureOtifProveedor,
  type FixtureOtifProveedorIntegracion,
} from "./entornoPruebasIntegracionOtifProveedor";

beforeAll(() => {
  requerirEntornoDePruebasConfirmado();
});

const fixturesCreados: FixtureOtifProveedorIntegracion[] = [];

afterEach(async () => {
  while (fixturesCreados.length > 0) {
    const f = fixturesCreados.pop()!;
    await borrarFixtureOtifProveedor(f);
  }
});

async function fixture(etiqueta: string): Promise<FixtureOtifProveedorIntegracion> {
  const f = await crearFixtureOtifProveedor(etiqueta);
  fixturesCreados.push(f);
  return f;
}

describe("confirmarObservacionOtifProveedor -- nivel 1 manual", () => {
  it("persiste una fila con ruleVersion=kpis-v1, fuente=manual y definicionKpiId resuelto a OTIF_PROVEEDOR publicada", async () => {
    const f = await fixture("manual-basico");
    const entrada = {
      modo: "manual" as const,
      cadenaId: f.cadenaId,
      periodoInicio: "2026-10-01",
      periodoFin: "2026-10-31",
      proveedorAlias: "Proveedor A",
      numerador: 90,
      denominador: 100,
    };

    const resultado = await confirmarObservacionOtifProveedor(entrada, { empresaId: f.empresaId });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultados).toHaveLength(1);
    const [primeraObservacion] = resultado.resultados;
    if (!primeraObservacion) throw new Error("deberia tener 1 resultado");

    const cliente = tenantClient(f.empresaId);
    const fila = await cliente.observacionOtifProveedor.findUnique({ where: { id: primeraObservacion.observacionId } });
    expect(fila?.ruleVersion).toBe("kpis-v1");
    expect(fila?.fuente).toBe("manual");
    expect(fila?.proveedorAlias).toBe("Proveedor A");
    expect(fila?.proveedorAliasClave).toBe("proveedor a");
    expect(fila?.empresaId).toBe(f.empresaId);

    const definicionKpi = await cliente.definicionKpi.findFirst({ where: { codigo: "OTIF_PROVEEDOR", estado: "PUBLICADA" } });
    expect(fila?.definicionKpiId).toBe(definicionKpi?.id);
  });
});

describe("identidad SIN `fuente` -- reconfirmar desde otra fuente actualiza la MISMA fila", () => {
  it("manual y luego pegado, mismo proveedor/periodo -> UNA sola fila, con la fuente mas reciente", async () => {
    const f = await fixture("cambio-fuente");
    const base = { cadenaId: f.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31" };

    const primera = await confirmarObservacionOtifProveedor(
      { modo: "manual", ...base, proveedorAlias: "Proveedor A", numerador: 80, denominador: 100 },
      { empresaId: f.empresaId },
    );
    const segunda = await confirmarObservacionOtifProveedor(
      {
        modo: "pegado",
        ...base,
        filas: [
          { proveedorAlias: "Proveedor A", pedido: "P1", fechaPromesa: "2026-10-05", fechaRecepcion: "2026-10-05", cantidadPedida: 10, cantidadRecibida: 10 },
        ],
      },
      { empresaId: f.empresaId },
    );

    expect(primera.ok).toBe(true);
    expect(segunda.ok).toBe(true);
    if (!primera.ok || !segunda.ok) throw new Error("no deberia pasar");
    const [primeraObs] = primera.resultados;
    const [segundaObs] = segunda.resultados;
    if (!primeraObs || !segundaObs) throw new Error("deberia tener 1 resultado cada confirmacion");
    expect(segundaObs.observacionId).toBe(primeraObs.observacionId);

    const cliente = tenantClient(f.empresaId);
    const filas = await cliente.observacionOtifProveedor.findMany({ where: { cadenaId: f.cadenaId, proveedorAliasClave: "proveedor a" } });
    expect(filas).toHaveLength(1);
    expect(filas[0].fuente).toBe("pegado");
    expect(filas[0].valor).toBeCloseTo(1);
    expect(filas[0].updatedAt.getTime()).toBeGreaterThanOrEqual(filas[0].createdAt.getTime());
  });
});

describe("RF-K2 analogo -- idempotencia por upsert dentro de la MISMA fuente", () => {
  it("confirmar el mismo proveedor/periodo/fuente dos veces actualiza la MISMA fila", async () => {
    const f = await fixture("idempotencia");
    const base = { cadenaId: f.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", proveedorAlias: "Proveedor A" } as const;

    const primera = await confirmarObservacionOtifProveedor({ modo: "manual", ...base, numerador: 80, denominador: 100 }, { empresaId: f.empresaId });
    const segunda = await confirmarObservacionOtifProveedor({ modo: "manual", ...base, numerador: 95, denominador: 100 }, { empresaId: f.empresaId });

    expect(primera.ok).toBe(true);
    expect(segunda.ok).toBe(true);
    if (!primera.ok || !segunda.ok) throw new Error("no deberia pasar");
    const [primeraObs] = primera.resultados;
    const [segundaObs] = segunda.resultados;
    if (!primeraObs || !segundaObs) throw new Error("deberia tener 1 resultado cada confirmacion");
    expect(segundaObs.observacionId).toBe(primeraObs.observacionId);

    const cliente = tenantClient(f.empresaId);
    const filas = await cliente.observacionOtifProveedor.findMany({ where: { cadenaId: f.cadenaId, fuente: "manual" } });
    expect(filas).toHaveLength(1);
    expect(filas[0].valor).toBeCloseTo(0.95);
  });
});

describe("confirmacion atomica -- multiples proveedores en una sola carga pegada", () => {
  it("persiste UNA fila por proveedor distinto, todas o ninguna", async () => {
    const f = await fixture("pegado-multi-proveedor");
    const resultado = await confirmarObservacionOtifProveedor(
      {
        modo: "pegado",
        cadenaId: f.cadenaId,
        periodoInicio: "2026-10-01",
        periodoFin: "2026-10-31",
        filas: [
          { proveedorAlias: "Proveedor A", pedido: "A-1", fechaPromesa: "2026-10-05", fechaRecepcion: "2026-10-05", cantidadPedida: 10, cantidadRecibida: 10 },
          { proveedorAlias: "Proveedor B", pedido: "B-1", fechaPromesa: "2026-10-05", fechaRecepcion: null, cantidadPedida: 10, cantidadRecibida: null },
        ],
      },
      { empresaId: f.empresaId },
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultados).toHaveLength(2);

    const cliente = tenantClient(f.empresaId);
    const filas = await cliente.observacionOtifProveedor.findMany({ where: { cadenaId: f.cadenaId } });
    expect(filas).toHaveLength(2);
  });
});

describe("RF-K5 analogo -- aislamiento de tenant", () => {
  it("un tenant nunca ve ni puede sobrescribir la ObservacionOtifProveedor de otro", async () => {
    const tenantA = await fixture("aislamiento-a");
    const tenantB = await fixture("aislamiento-b");

    await confirmarObservacionOtifProveedor(
      { modo: "manual", cadenaId: tenantA.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", proveedorAlias: "Proveedor A", numerador: 1, denominador: 1 },
      { empresaId: tenantA.empresaId },
    );

    const resultado = await confirmarObservacionOtifProveedor(
      { modo: "manual", cadenaId: tenantA.cadenaId, periodoInicio: "2026-11-01", periodoFin: "2026-11-30", proveedorAlias: "Proveedor A", numerador: 1, denominador: 1 },
      { empresaId: tenantB.empresaId },
    );
    expect(resultado).toEqual({ ok: false, error: "CADENA_INEXISTENTE" });

    const clienteB = tenantClient(tenantB.empresaId);
    const visiblesParaB = await clienteB.observacionOtifProveedor.findMany({ where: { cadenaId: tenantA.cadenaId } });
    expect(visiblesParaB).toHaveLength(0);
  });
});
