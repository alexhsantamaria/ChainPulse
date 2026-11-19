// Infraestructura -- orquestacion de confirmarObservacionOtifProveedor():
// toca Prisma, Incremento 5 PR3 (Alex, 2026-11-18, correcciones
// obligatorias). Separado de declarar.ts (puro) por el mismo motivo que
// persistir.ts/declarar.ts de OTIF normal (ver su comentario de cabecera).
//
// Confirmacion ATOMICA (Alex, punto 11): el modo "pegado" puede traer
// VARIAS observaciones (una por proveedor distinto, ver declarar.ts) --
// o persisten TODAS o no persiste NINGUNA. tenantClient() (la ruta mas
// comun del resto de la app) abre una transaccion NUEVA por cada llamada
// individual -- NO da atomicidad entre N upserts. Por eso esta funcion
// usa tenantTransaction() (src/infra/prisma/tenantTransaction.ts,
// PLAN-DE-TRABAJO.md Seccion 18.3.B), que envuelve la verificacion de
// cadena Y los N upserts en UNA sola transaccion real -- si cualquiera
// de los upserts fallara (p.ej. un CHECK de base de datos), ninguno de
// los anteriores de esa misma confirmacion queda persistido. Convencion
// de nombre ya establecida para este patron: esta funcion deberia
// detectarse con `grep -rn "tenantClient(\|tenantTransaction(" src/` como
// una de las pocas que usa tenantTransaction, nunca tenantClient directo,
// para una escritura multi-fila.
import { EstadoDato } from "@prisma/client";
import { tenantTransaction } from "@/infra/prisma/tenantTransaction";
import { prisma } from "@/infra/prisma/client";
import { logError } from "@/infra/log";
import { parsearFechaCalendarioEstricta } from "@/infra/kpis/otif/declarar";
import {
  previsualizarObservacionOtifProveedor,
  type EntradaDeclaracionOtifProveedor,
  type FalloValidacionOtifProveedor,
} from "./declarar";
import type { ResultadoCalculoKpi } from "@/engine/kpis/constantes";

export interface ContextoConfirmarOtifProveedor {
  empresaId: string;
}

export interface ObservacionOtifProveedorConfirmada {
  observacionId: string;
  proveedorAlias: string;
  proveedorAliasClave: string;
  resultado: ResultadoCalculoKpi;
}

export type ResultadoConfirmarOtifProveedor =
  | { ok: true; resultados: ObservacionOtifProveedorConfirmada[] }
  | ({ ok: false } & FalloValidacionOtifProveedor)
  | { ok: false; error: "CADENA_INEXISTENTE" }
  | { ok: false; error: "DEFINICION_KPI_NO_DISPONIBLE" };

/**
 * Recalcula server-side (nunca confia en un `resultado` que el cliente
 * haya visto en la previsualizacion -- Alex, punto 12) y hace upsert de
 * cada ObservacionOtifProveedor por la clave unica SIN `fuente` (Alex,
 * punto 4: `cadenaId + definicionKpiId + periodoInicio + periodoFin +
 * proveedorAliasClave`) -- reconfirmar el mismo proveedor+periodo desde
 * OTRA fuente ACTUALIZA la fila existente (fuente, valores, estado,
 * ruleVersion, updatedAt via @updatedAt), nunca crea una segunda.
 *
 * `definicionKpiId` siempre se persiste como la DefinicionKpi PUBLICADA
 * que efectivamente resolvio este calculo (Alex, punto 3) -- nunca se
 * vuelve a inferir despues de guardada.
 */
export async function confirmarObservacionOtifProveedor(
  entrada: EntradaDeclaracionOtifProveedor,
  contexto: ContextoConfirmarOtifProveedor,
): Promise<ResultadoConfirmarOtifProveedor> {
  const validacion = previsualizarObservacionOtifProveedor(entrada);
  if (!validacion.ok) {
    return validacion;
  }

  const definicionKpi = await prisma.definicionKpi.findFirst({
    where: { codigo: "OTIF_PROVEEDOR", estado: "PUBLICADA" },
    orderBy: { numero: "desc" },
  });
  if (!definicionKpi) {
    // Ya seedeada (prisma/seedDefinicionesKpi.ts) -- no deberia pasar en
    // un entorno sembrado. Mismo criterio que persistir.ts de OTIF: fallar
    // con un mensaje claro en vez de un 500 opaco.
    logError("infra/kpis/otifProveedor/persistir", new Error("DefinicionKpi OTIF_PROVEEDOR no encontrada o no publicada"));
    return { ok: false, error: "DEFINICION_KPI_NO_DISPONIBLE" };
  }

  // Mismo parser ESTRICTO ya usado por previsualizarObservacionOtifProveedor()
  // -- nunca un `new Date(string)` directo, mas laxo (Alex, punto 13).
  const periodoInicio = parsearFechaCalendarioEstricta(entrada.periodoInicio);
  const periodoFin = parsearFechaCalendarioEstricta(entrada.periodoFin);
  if (!periodoInicio || !periodoFin) {
    // No deberia pasar -- ya se valido arriba con el mismo parser. Error
    // de programacion, no de usuario, si de todos modos ocurriera.
    return { ok: false, error: "DATOS_INVALIDOS" };
  }

  const fuente: string = entrada.modo === "manual" ? "manual" : "pegado";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver nota de tenantClient.ts/tenantTransaction.ts
  const resultadoTx = await tenantTransaction(contexto.empresaId, async (tx: any) => {
    const cadena = await tx.cadena.findUnique({ where: { id: entrada.cadenaId } });
    if (!cadena) {
      return { ok: false as const, error: "CADENA_INEXISTENTE" as const };
    }

    const creadas: ObservacionOtifProveedorConfirmada[] = [];
    for (const r of validacion.resultados) {
      const datosObservacion = {
        proveedorAlias: r.proveedorAlias,
        valor: r.resultado.valor,
        numerador: r.resultado.numerador,
        denominador: r.resultado.denominador,
        estado: EstadoDato.DECLARADO,
        ruleVersion: r.resultado.ruleVersion,
        fuente,
      };

      const observacion = await tx.observacionOtifProveedor.upsert({
        where: {
          cadenaId_definicionKpiId_periodoInicio_periodoFin_proveedorAliasClave: {
            cadenaId: entrada.cadenaId,
            definicionKpiId: definicionKpi.id,
            periodoInicio,
            periodoFin,
            proveedorAliasClave: r.proveedorAliasClave,
          },
        },
        create: {
          empresaId: contexto.empresaId,
          cadenaId: entrada.cadenaId,
          definicionKpiId: definicionKpi.id,
          periodoInicio,
          periodoFin,
          proveedorAliasClave: r.proveedorAliasClave,
          ...datosObservacion,
        },
        // Reconfirmacion desde otra fuente (Alex, punto 4): actualiza
        // fuente/valores/estado/ruleVersion -- `updatedAt` se actualiza
        // solo via @updatedAt del schema, nunca se escribe aca a mano.
        update: datosObservacion,
      });

      creadas.push({
        observacionId: observacion.id,
        proveedorAlias: r.proveedorAlias,
        proveedorAliasClave: r.proveedorAliasClave,
        resultado: r.resultado,
      });
    }

    return { ok: true as const, resultados: creadas };
  });

  return resultadoTx;
}
