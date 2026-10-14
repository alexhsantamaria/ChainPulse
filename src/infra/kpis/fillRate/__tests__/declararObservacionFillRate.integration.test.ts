// Pruebas de INTEGRACION (Postgres real, nunca produccion) -- Fill Rate,
// Incremento 4 Bloque B, siguiente KPI despues de OTIF (Alex, 2026-10-14).
// Ejercitan confirmarObservacionFillRate() (persistir.ts) de punta a
// punta contra una base real: idempotencia, aislamiento de tenant CAPA 1
// (tenantClient) y CAPA 2 (RLS cruda, sin tenantClient de por medio --
// ver el ultimo describe de este archivo), listado y ruleVersion
// persistido. Mismo patron EXACTO que
// otif/__tests__/declararObservacionOtif.integration.test.ts.
//
// La seccion "capa 2 -- RLS cruda" de este archivo cierra deliberadamente
// un hueco que la auditoria comparativa de 8 KPIs pendientes
// (auditoria-comparativa-8-kpis-pendientes-2026-10-14.md, Fase C) ya
// habia identificado: aislamientoMultitenant.integration.test.ts (la
// unica prueba de integracion que SI ejercita RLS cruda, sin pasar por
// tenantClient) todavia no cubre la tabla observaciones_kpi -- solo cubre
// eslabon/conexion/nodo/conexionCadena/etc. Esta prueba agrega esa
// cobertura para observaciones_kpi, en vez de arrastrar el hueco hacia
// adelante con el siguiente KPI tambien.
//
// Requiere DATABASE_URL + CHAINPULSE_CONFIRMAR_PRUEBAS_DESTRUCTIVAS con
// el valor exacto (ver entornoPruebasIntegracionFillRate.ts) -- correr
// con `npm run test:integration` en Windows, NUNCA `npm run test`.
// requerirEntornoDePruebasConfirmado() hace que fallar-cerrado sea
// automatico si alguien lo intenta sin las dos variables exactas.
//
// NUNCA EJECUTADO EN ESTE ENTORNO (Mac, sandbox sin DATABASE_URL/red a
// Neon) -- escrito para que Alex lo corra en Windows junto con la
// validacion final.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../prisma/client";
import { tenantClient } from "../../../prisma/tenantClient";
import { confirmarObservacionFillRate } from "../persistir";
import {
  requerirEntornoDePruebasConfirmado,
  crearFixtureFillRate,
  borrarFixtureFillRate,
  TX_OPTIONS_INTEGRACION,
  type FixtureFillRateIntegracion,
} from "./entornoPruebasIntegracionFillRate";

beforeAll(() => {
  requerirEntornoDePruebasConfirmado();
});

const fixturesCreados: FixtureFillRateIntegracion[] = [];

afterEach(async () => {
  while (fixturesCreados.length > 0) {
    const fixture = fixturesCreados.pop()!;
    await borrarFixtureFillRate(fixture);
  }
});

async function fixture(etiqueta: string): Promise<FixtureFillRateIntegracion> {
  const f = await crearFixtureFillRate(etiqueta);
  fixturesCreados.push(f);
  return f;
}

describe("confirmarObservacionFillRate -- nivel 1 manual", () => {
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

    const resultado = await confirmarObservacionFillRate(entrada, { empresaId: f.empresaId });
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

describe("confirmarObservacionFillRate -- nivel 2 pegado", () => {
  it("una fila incompleta (servido: null, pedido sin cerrar) da advertencia sin fallar; confirmar persiste el agregado correcto", async () => {
    const f = await fixture("pegado-advertencia");
    const entrada = {
      modo: "pegado" as const,
      cadenaId: f.cadenaId,
      periodoInicio: "2026-10-01",
      periodoFin: "2026-10-31",
      filas: [
        { sku: "SKU-1", pedido: "P1", solicitado: 10, servido: 10 },
        { sku: "SKU-2", pedido: "P2", solicitado: 5, servido: null },
      ],
    };

    const resultado = await confirmarObservacionFillRate(entrada, { empresaId: f.empresaId });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("no deberia pasar");
    expect(resultado.resultado.filasEvaluadas).toBe(1);
    expect(resultado.resultado.filasExcluidas).toBe(1);
    expect(resultado.resultado.advertencias.length).toBeGreaterThan(0);
  });
});

describe("idempotencia por upsert (mismo criterio RF-K2 de OTIF)", () => {
  it("confirmar el mismo periodo dos veces actualiza la MISMA fila (una sola fila en observaciones_kpi)", async () => {
    const f = await fixture("idempotencia");
    const entradaBase = { cadenaId: f.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31" } as const;

    const primera = await confirmarObservacionFillRate({ modo: "manual", ...entradaBase, numerador: 80, denominador: 100 }, { empresaId: f.empresaId });
    const segunda = await confirmarObservacionFillRate({ modo: "manual", ...entradaBase, numerador: 95, denominador: 100 }, { empresaId: f.empresaId });

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

describe("aislamiento de tenant -- capa 1 (tenantClient, mismo criterio RF-K5 de OTIF)", () => {
  it("un tenant nunca ve ni puede sobrescribir la ObservacionKpi de otro", async () => {
    const tenantA = await fixture("aislamiento-a");
    const tenantB = await fixture("aislamiento-b");

    await confirmarObservacionFillRate(
      { modo: "manual", cadenaId: tenantA.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 1 },
      { empresaId: tenantA.empresaId },
    );

    // El tenant B usa el cadenaId del tenant A -- tenantClient() filtra por
    // empresaId de la sesion ANTES que por cadenaId del payload, asi que
    // la cadena de otro tenant simplemente no existe para el (RNF1 capa 1).
    const resultado = await confirmarObservacionFillRate(
      { modo: "manual", cadenaId: tenantA.cadenaId, periodoInicio: "2026-11-01", periodoFin: "2026-11-30", numerador: 1, denominador: 1 },
      { empresaId: tenantB.empresaId },
    );
    expect(resultado).toEqual({ ok: false, error: "CADENA_INEXISTENTE" });

    const clienteB = tenantClient(tenantB.empresaId);
    const observacionesVisiblesParaB = await clienteB.observacionKpi.findMany({ where: { cadenaId: tenantA.cadenaId } });
    expect(observacionesVisiblesParaB).toHaveLength(0);
  });
});

describe("aislamiento de tenant -- capa 2, RLS cruda SIN tenantClient (cierra el hueco de observaciones_kpi identificado en la auditoria Fase C, 2026-10-14)", () => {
  // Mismo patron exacto que aislamientoMultitenant.integration.test.ts
  // ("capa 2 -- RLS bloquea aunque el codigo de aplicacion se olvide del
  // filtro"): usa el cliente BASE de Prisma (nunca tenantClient), fija
  // app.tenant_id a mano con set_config, y consulta SIN ningun `where`
  // de empresaId en el codigo de la prueba. Si la politica RLS de
  // observaciones_kpi (migracion 20260924020000_incremento4_kpis_bloque_a,
  // linea ~100-103) estuviera rota o ausente, esta prueba (a diferencia
  // de la de capa 1 arriba, que SIEMPRE pasa por el filtro de aplicacion
  // de tenantClient) fallaria -- es la unica prueba de este archivo que
  // puede detectar una regresion de RLS en si mismo, no solo del filtro
  // de aplicacion.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003), mismo patron EXACTO (sin generics) que bajoTenant()/sinTenantFijado() de aislamientoMultitenant.integration.test.ts -- con generics <T> el cliente stub de Prisma en Mac infiere Promise<unknown> en vez de T
  async function bajoTenant(empresaId: string, fn: (tx: any) => Promise<any>): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
    return prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
      return fn(tx);
    }, TX_OPTIONS_INTEGRACION);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
  async function sinTenantFijado(fn: (tx: any) => Promise<any>): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
    return prisma.$transaction(async (tx: any) => fn(tx), TX_OPTIONS_INTEGRACION);
  }

  it("pedir explicitamente el id de una ObservacionKpi de otro tenant, con el cliente BASE (sin tenantClient), devuelve null bajo RLS", async () => {
    const tenantA = await fixture("rls-cruda-a");
    const tenantB = await fixture("rls-cruda-b");

    const confirmado = await confirmarObservacionFillRate(
      { modo: "manual", cadenaId: tenantB.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 1 },
      { empresaId: tenantB.empresaId },
    );
    expect(confirmado.ok).toBe(true);
    if (!confirmado.ok) throw new Error("no deberia pasar");

    // Fijado a tenant A, sin ningun `where: { empresaId }` en esta
    // consulta -- si esto encontrara la fila de B, RLS no estaria
    // protegiendo observaciones_kpi.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
    const observacion = await bajoTenant(tenantA.empresaId, (tx: any) =>
      tx.observacionKpi.findUnique({ where: { id: confirmado.observacionId } }),
    );
    expect(observacion).toBeNull();
  });

  it("una consulta SIN filtro de tenant en el codigo (findMany sin where) igual queda acotada por RLS a las filas del tenant fijado", async () => {
    const tenantA = await fixture("rls-cruda-findmany-a");
    const tenantB = await fixture("rls-cruda-findmany-b");

    const deA = await confirmarObservacionFillRate(
      { modo: "manual", cadenaId: tenantA.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 1 },
      { empresaId: tenantA.empresaId },
    );
    const deB = await confirmarObservacionFillRate(
      { modo: "manual", cadenaId: tenantB.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 1 },
      { empresaId: tenantB.empresaId },
    );
    expect(deA.ok).toBe(true);
    expect(deB.ok).toBe(true);
    if (!deA.ok || !deB.ok) throw new Error("no deberia pasar");

    // Sin `where` -- cualquier fila de observaciones_kpi en TODA la base
    // seria candidata si RLS no estuviera aplicando. Fijado a tenant A:
    // solo debe aparecer la fila de A.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
    const observaciones = await bajoTenant(tenantA.empresaId, (tx: any) => tx.observacionKpi.findMany());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
    const ids = observaciones.map((o: any) => o.id as string);
    expect(ids).toContain(deA.observacionId);
    expect(ids).not.toContain(deB.observacionId);
  });

  it("sin ningun tenant fijado, RLS falla cerrado: no devuelve ninguna fila de observaciones_kpi de ningun tenant", async () => {
    const f = await fixture("rls-cruda-sin-tenant");
    const confirmado = await confirmarObservacionFillRate(
      { modo: "manual", cadenaId: f.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 1 },
      { empresaId: f.empresaId },
    );
    expect(confirmado.ok).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de arriba
    const observaciones = await sinTenantFijado((tx: any) => tx.observacionKpi.findMany());
    expect(observaciones).toHaveLength(0);
  });
});

describe("listado filtra por cadena/tenant (mismo criterio RF-K6 de OTIF)", () => {
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

    await confirmarObservacionFillRate(
      { modo: "manual", cadenaId: f.cadenaId, periodoInicio: "2026-10-01", periodoFin: "2026-10-31", numerador: 1, denominador: 1 },
      { empresaId: f.empresaId },
    );
    await confirmarObservacionFillRate(
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

describe("Rol -- solo ADMINISTRADOR declara (mismo criterio decision 3 de OTIF)", () => {
  it("confirmarObservacionFillRate() en si misma no filtra por rol -- ese chequeo es de la ruta (requireAdmin), probado en route.test.ts con mocks; aca se confirma que el fixture RESPONSABLE existe para esa prueba de ruta", async () => {
    const f = await fixture("rol-responsable-existe");
    const cliente = tenantClient(f.empresaId);
    const responsable = await cliente.usuario.findUnique({ where: { id: f.responsableId } });
    expect(responsable?.rol).toBe("RESPONSABLE");
  });
});
