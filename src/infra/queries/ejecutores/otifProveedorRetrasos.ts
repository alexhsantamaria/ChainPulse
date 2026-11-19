// Infraestructura -- carga de datos (Prisma, tenant-scoped) para I5-02.
// Incremento 5 PR3 (Alex, 2026-11-18): este ejecutor ya lee observaciones
// REALES de la tabla dedicada ObservacionOtifProveedor -- antes de este
// PR siempre pasaba `filas: []` al motor (ver el comentario de cabecera
// de engine/queries/otifProveedorRetrasos.ts, ahora corregido). PURO de
// logica de negocio (eso vive en engine/queries/otifProveedorRetrasos.ts);
// este archivo SOLO sabe como conseguir las filas por proveedor que el
// motor necesita, via tenantClient() (RNF1 capa 1 + capa 2) -- mismo
// molde exacto que cargarYEjecutarOtifCaida() (otifCaida.ts).
import type { TenantPrismaClient } from "@/infra/prisma/tenantClient";
import { ejecutarOtifProveedorRetrasos, type FilaOtifProveedorAgregada } from "@/engine/queries/otifProveedorRetrasos";
import type { RespuestaConsulta } from "@/domain/queries/tipos";
import { ejecutarConsultaDentroDePresupuesto, type ErrorPresupuestoComputoExcedido } from "../presupuestoComputo";
import { PRESUPUESTO_COMPUTO_MS } from "@/domain/limitesConsultas";
import { mensajeSinDatos } from "@/engine/queries/plantillasExplicacion";

async function obtenerDefinicionKpiOtifProveedor(cliente: TenantPrismaClient) {
  // DefinicionKpi es catalogo de plataforma sin empresaId (fuera de
  // TENANT_SCOPED_MODELS) -- mismo criterio que obtenerDefinicionKpiOtif()
  // (otifCaida.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  return (cliente as any).definicionKpi.findFirst({
    where: { codigo: "OTIF_PROVEEDOR", estado: "PUBLICADA" },
    orderBy: { numero: "desc" },
  });
}

interface FilaObservacionOtifProveedorDb {
  proveedorAlias: string;
  proveedorAliasClave: string;
  valor: number | null;
  ruleVersion: string;
}

/**
 * I5-02 -- carga TODAS las observaciones de OTIF proveedor del periodo
 * EXACTO consultado (mismo criterio de "periodo exacto, sin inferir
 * contiguidad" que I5-01) y las entrega al motor de ranking.
 * `orderBy: { proveedorAliasClave: "asc" }` es una CONVENIENCIA (reduce
 * trabajo de ordenamiento en el motor en el caso comun), NUNCA la unica
 * garantia de desempate deterministico -- el propio motor vuelve a
 * ordenar explicitamente antes de elegir el peor (Alex, punto 15; ver
 * engine/queries/otifProveedorRetrasos.ts).
 */
export async function cargarYEjecutarOtifProveedorRetrasos(
  cliente: TenantPrismaClient,
  cadenaId: string,
  periodo: { inicio: Date; fin: Date },
): Promise<RespuestaConsulta | ErrorPresupuestoComputoExcedido> {
  const definicionKpi = await obtenerDefinicionKpiOtifProveedor(cliente);
  if (!definicionKpi) {
    // No deberia pasar -- prisma/seedDefinicionesKpi.ts ya publica
    // OTIF_PROVEEDOR. Mismo criterio que obtenerDefinicionKpiOtif(): fallar
    // con SIN_DATOS_SUFICIENTES explicito en vez de un 500 opaco si de
    // todos modos ocurriera (entorno no sembrado).
    return {
      ok: false,
      catalogoId: "OTIF_PROVEEDOR_RETRASOS",
      error: "SIN_DATOS_SUFICIENTES",
      mensaje: mensajeSinDatos("el catálogo de KPIs no tiene publicada la definición de OTIF proveedor"),
      camposFaltantes: ["definición de KPI OTIF_PROVEEDOR publicada"],
      comoIngresarlos: "Contacta al administrador de la plataforma -- esto no debería ocurrir en un entorno ya sembrado.",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts
  const filasDb: FilaObservacionOtifProveedorDb[] = await (cliente as any).observacionOtifProveedor.findMany({
    where: { cadenaId, definicionKpiId: definicionKpi.id, periodoInicio: periodo.inicio, periodoFin: periodo.fin },
    orderBy: { proveedorAliasClave: "asc" },
  });

  const filas: FilaOtifProveedorAgregada[] = filasDb.map((f) => ({
    proveedorAlias: f.proveedorAlias,
    proveedorAliasClave: f.proveedorAliasClave,
    valor: f.valor,
    ruleVersion: f.ruleVersion,
  }));

  return ejecutarConsultaDentroDePresupuesto("OTIF_PROVEEDOR_RETRASOS", PRESUPUESTO_COMPUTO_MS, () =>
    ejecutarOtifProveedorRetrasos({ filas, periodoConsultado: periodo }),
  );
}
