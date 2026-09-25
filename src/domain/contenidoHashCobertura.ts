// Dominio -- huella de contenido de una fila de Cobertura (Incremento 4
// Bloque B). sha256 de {sku, ubicacion, fechaCorte, inventarioDisponible,
// unidadInventario, consumoDiarioEsperado, unidadConsumoDiario,
// fuenteConsumo, periodoReferenciaConsumoInicio,
// periodoReferenciaConsumoFin, ruleVersion} con claves ordenadas -- ver el
// comentario de ObservacionCobertura.contenidoHash en
// prisma/schema.prisma. Distingue un reintento identico (mismo hash,
// no-op) de una correccion real (hash distinto, inserta fila nueva +
// marca la anterior no vigente) -- ver src/infra/kpis/cobertura/importar.ts.
//
// Funcion PURA -- no toca Prisma ni R2. Las claves del objeto que se
// serializa estan escritas ya en orden alfabetico en el codigo (en vez de
// ordenarlas en runtime) para que quede visible a simple vista que
// coinciden con las columnas listadas en el comentario del schema.
import { createHash } from "node:crypto";

export interface DatosParaHashCobertura {
  sku: string;
  ubicacion: string;
  fechaCorte: Date;
  inventarioDisponible: number | null;
  unidadInventario: string;
  consumoDiarioEsperado: number | null;
  unidadConsumoDiario: string;
  fuenteConsumo: string;
  periodoReferenciaConsumoInicio: Date | null;
  periodoReferenciaConsumoFin: Date | null;
  ruleVersion: string;
}

function comoFechaISO(fecha: Date | null): string | null {
  return fecha ? fecha.toISOString().slice(0, 10) : null;
}

export function calcularContenidoHashCobertura(datos: DatosParaHashCobertura): string {
  // Orden alfabetico de claves, a mano -- ver cabecera.
  const canonico = {
    consumoDiarioEsperado: datos.consumoDiarioEsperado,
    fechaCorte: comoFechaISO(datos.fechaCorte),
    fuenteConsumo: datos.fuenteConsumo,
    inventarioDisponible: datos.inventarioDisponible,
    periodoReferenciaConsumoFin: comoFechaISO(datos.periodoReferenciaConsumoFin),
    periodoReferenciaConsumoInicio: comoFechaISO(datos.periodoReferenciaConsumoInicio),
    ruleVersion: datos.ruleVersion,
    sku: datos.sku,
    ubicacion: datos.ubicacion,
    unidadConsumoDiario: datos.unidadConsumoDiario,
    unidadInventario: datos.unidadInventario,
  };
  return createHash("sha256").update(JSON.stringify(canonico)).digest("hex");
}
