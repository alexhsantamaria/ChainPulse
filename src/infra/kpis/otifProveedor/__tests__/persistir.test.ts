// Unitarias (SIN Postgres real) -- confirmarObservacionOtifProveedor(),
// Incremento 5 PR3. Mockea tenantTransaction() y el cliente base de
// Prisma para verificar el CABLEADO de la confirmacion atomica (Alex,
// punto 11) sin necesitar una base real: que TODOS los upserts de un
// lote "pegado" ocurran dentro de UNA SOLA llamada a tenantTransaction()
// (nunca N llamadas a tenantClient(), que abriria una transaccion nueva
// por cada una -- ver el comentario de cabecera de persistir.ts), y que
// un fallo a mitad del lote se PROPAGUE (nunca se atrape ni se devuelva
// un resultado parcial) para que la reversion real de Postgres (fuera
// del alcance de esta prueba mockeada) sea quien revierta todo.
//
// Las pruebas de idempotencia/aislamiento de tenant/RLS CONTRA Postgres
// real viven en declararObservacionOtifProveedor.integration.test.ts
// (*.integration.test.ts, excluida de la suite normal -- Alex, punto 19).
import { beforeEach, describe, expect, it, vi } from "vitest";

// EstadoDato real viene de @prisma/client, cuyo Client generado en este
// Mac esta desactualizado (403 contra binaries.prisma.sh, limitacion de
// red YA documentada en todo el repositorio -- ver otif/persistir.ts) --
// sin este mock, `EstadoDato.DECLARADO` seria `undefined` en runtime
// (no solo un error de typecheck). Mismo criterio que
// src/infra/kpis/cobertura/__tests__/job.test.ts (`vi.mock("@prisma/client", ...)`
// para Prisma.DbNull), aplicado aca al enum que persistir.ts necesita.
vi.mock("@prisma/client", () => ({
  EstadoDato: { DECLARADO: "DECLARADO", INFERIDO: "INFERIDO", VERIFICADO: "VERIFICADO" },
}));

const tenantTransactionMock = vi.fn();
vi.mock("@/infra/prisma/tenantTransaction", () => ({
  tenantTransaction: (...args: unknown[]) => tenantTransactionMock(...args),
}));

const definicionKpiFindFirstMock = vi.fn();
vi.mock("@/infra/prisma/client", () => ({
  prisma: { definicionKpi: { findFirst: (...args: unknown[]) => definicionKpiFindFirstMock(...args) } },
}));

vi.mock("@/infra/log", () => ({ logError: vi.fn() }));

import { confirmarObservacionOtifProveedor } from "../persistir";

const PERIODO = { periodoInicio: "2026-09-01", periodoFin: "2026-09-30" };
const DEFINICION_KPI = { id: "def-otif-proveedor" };

function construirFakeTx(cadenaExiste = true) {
  return {
    cadena: { findUnique: vi.fn().mockResolvedValue(cadenaExiste ? { id: "cadena-1" } : null) },
    observacionOtifProveedor: { upsert: vi.fn().mockImplementation(async (args: { where: unknown }) => ({ id: `obs-${JSON.stringify(args.where)}` })) },
  };
}

beforeEach(() => {
  tenantTransactionMock.mockReset();
  definicionKpiFindFirstMock.mockReset();
  definicionKpiFindFirstMock.mockResolvedValue(DEFINICION_KPI);
});

describe("confirmarObservacionOtifProveedor -- DEFINICION_KPI_NO_DISPONIBLE", () => {
  it("si la DefinicionKpi OTIF_PROVEEDOR no esta publicada, NUNCA abre una transaccion", async () => {
    definicionKpiFindFirstMock.mockResolvedValue(null);
    const resultado = await confirmarObservacionOtifProveedor(
      { modo: "manual", cadenaId: "cadena-1", ...PERIODO, proveedorAlias: "Proveedor A", numerador: 1, denominador: 1 },
      { empresaId: "empresa-1" },
    );
    expect(resultado).toEqual({ ok: false, error: "DEFINICION_KPI_NO_DISPONIBLE" });
    expect(tenantTransactionMock).not.toHaveBeenCalled();
  });
});

describe("confirmarObservacionOtifProveedor -- CADENA_INEXISTENTE", () => {
  it("si la cadena no existe para el tenant, nunca llega a llamar upsert", async () => {
    const fakeTx = construirFakeTx(false);
    tenantTransactionMock.mockImplementation(async (_empresaId: string, fn: (tx: unknown) => unknown) => fn(fakeTx));

    const resultado = await confirmarObservacionOtifProveedor(
      { modo: "manual", cadenaId: "cadena-1", ...PERIODO, proveedorAlias: "Proveedor A", numerador: 1, denominador: 1 },
      { empresaId: "empresa-1" },
    );
    expect(resultado).toEqual({ ok: false, error: "CADENA_INEXISTENTE" });
    expect(fakeTx.observacionOtifProveedor.upsert).not.toHaveBeenCalled();
  });
});

describe("confirmarObservacionOtifProveedor -- modo manual, camino feliz", () => {
  it("un solo upsert, where SIN fuente, create con definicionKpiId resuelto", async () => {
    const fakeTx = construirFakeTx(true);
    tenantTransactionMock.mockImplementation(async (_empresaId: string, fn: (tx: unknown) => unknown) => fn(fakeTx));

    const resultado = await confirmarObservacionOtifProveedor(
      { modo: "manual", cadenaId: "cadena-1", ...PERIODO, proveedorAlias: "Proveedor A", numerador: 8, denominador: 10 },
      { empresaId: "empresa-1" },
    );

    expect(resultado.ok).toBe(true);
    expect(fakeTx.observacionOtifProveedor.upsert).toHaveBeenCalledTimes(1);
    const [primeraLlamada] = fakeTx.observacionOtifProveedor.upsert.mock.calls;
    if (!primeraLlamada) throw new Error("upsert deberia haberse llamado al menos una vez");
    const [args] = primeraLlamada;
    expect(Object.keys(args.where.cadenaId_definicionKpiId_periodoInicio_periodoFin_proveedorAliasClave)).not.toContain("fuente");
    expect(args.where.cadenaId_definicionKpiId_periodoInicio_periodoFin_proveedorAliasClave.proveedorAliasClave).toBe("proveedor a");
    expect(args.create.definicionKpiId).toBe(DEFINICION_KPI.id);
    expect(args.update.fuente).toBe("manual");
  });
});

describe("confirmarObservacionOtifProveedor -- modo pegado, multiples proveedores", () => {
  it("UNA sola llamada a tenantTransaction para TODO el lote (nunca una por proveedor)", async () => {
    const fakeTx = construirFakeTx(true);
    tenantTransactionMock.mockImplementation(async (_empresaId: string, fn: (tx: unknown) => unknown) => fn(fakeTx));

    const filas = [
      { proveedorAlias: "Proveedor A", pedido: "A-1", fechaPromesa: "2026-09-10", fechaRecepcion: "2026-09-10", cantidadPedida: 10, cantidadRecibida: 10 },
      { proveedorAlias: "Proveedor B", pedido: "B-1", fechaPromesa: "2026-09-10", fechaRecepcion: "2026-09-10", cantidadPedida: 10, cantidadRecibida: 10 },
    ];
    const resultado = await confirmarObservacionOtifProveedor({ modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas }, { empresaId: "empresa-1" });

    expect(resultado.ok).toBe(true);
    expect(tenantTransactionMock).toHaveBeenCalledTimes(1);
    expect(fakeTx.observacionOtifProveedor.upsert).toHaveBeenCalledTimes(2);
  });

  it("confirmacion atomica: si el upsert del 2do proveedor falla, la funcion PROPAGA el error (nunca devuelve un resultado parcial)", async () => {
    const fakeTx = construirFakeTx(true);
    let llamadas = 0;
    fakeTx.observacionOtifProveedor.upsert = vi.fn().mockImplementation(async () => {
      llamadas += 1;
      if (llamadas === 2) throw new Error("fallo simulado del 2do upsert (p.ej. un CHECK de base de datos)");
      return { id: `obs-${llamadas}` };
    });
    tenantTransactionMock.mockImplementation(async (_empresaId: string, fn: (tx: unknown) => unknown) => fn(fakeTx));

    const filas = [
      { proveedorAlias: "Proveedor A", pedido: "A-1", fechaPromesa: "2026-09-10", fechaRecepcion: "2026-09-10", cantidadPedida: 10, cantidadRecibida: 10 },
      { proveedorAlias: "Proveedor B", pedido: "B-1", fechaPromesa: "2026-09-10", fechaRecepcion: "2026-09-10", cantidadPedida: 10, cantidadRecibida: 10 },
    ];

    await expect(
      confirmarObservacionOtifProveedor({ modo: "pegado", cadenaId: "cadena-1", ...PERIODO, filas }, { empresaId: "empresa-1" }),
    ).rejects.toThrow("fallo simulado del 2do upsert");
    // El 1er upsert SI se invoco (ya habia "escrito" en esta tx mockeada),
    // pero la funcion nunca atrapo el error del 2do ni devolvio un
    // resultado ok:true parcial -- la propagacion es lo que permite que
    // el $transaction REAL de Prisma (nunca mockeado aca) revierta ambos.
    expect(fakeTx.observacionOtifProveedor.upsert).toHaveBeenCalledTimes(2);
  });
});
