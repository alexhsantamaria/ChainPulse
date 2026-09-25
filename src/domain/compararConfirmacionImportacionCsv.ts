// Dominio -- compara dos confirmaciones de ImportacionCsv de Cobertura
// para decidir si un POST de confirmar es un REINTENTO IDENTICO (mismos
// valores, ya aplicados -- responder con el estado existente, sin
// repetir efectos) o una CONFIRMACION CON VALORES DISTINTOS sobre una
// importacion ya confirmada (rechazar -- no hay "reconfirmar con otros
// valores", hace falta una importacion nueva). Alex, 2026-09-25 (ronda
// de revision): "un segundo POST que siempre devuelve 409 puede impedir
// recuperarse cuando el primero se confirmo pero se perdio su
// respuesta".
//
// Funcion PURA -- ambos lados (lo ya persistido en ImportacionCsv y lo
// que trae el body del nuevo POST) se normalizan a esta misma forma
// ANTES de comparar, para que la comparacion no dependa de si el valor
// vino de Prisma o de zod.
import type { MapeoColumnasCobertura } from "./mapeoColumnasCsv";

export interface DatosConfirmacionCobertura {
  mapeoColumnas: MapeoColumnasCobertura;
  estrategia: "CARGA_PARCIAL" | "REEMPLAZO_ALCANCE";
  alcanceFechaCorteInicio: Date | null;
  alcanceFechaCorteFin: Date | null;
  alcanceUbicaciones: string[] | null;
  fuenteConsumo: string;
  periodoReferenciaConsumoInicio: Date;
  periodoReferenciaConsumoFin: Date;
}

function comoFechaISO(fecha: Date | null): string | null {
  return fecha ? fecha.toISOString().slice(0, 10) : null;
}

function fechasIguales(a: Date | null, b: Date | null): boolean {
  return comoFechaISO(a) === comoFechaISO(b);
}

function conjuntosDeUbicacionesIguales(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  const conjA = new Set(a);
  const conjB = new Set(b);
  if (conjA.size !== conjB.size) return false;
  for (const ubicacion of conjA) {
    if (!conjB.has(ubicacion)) return false;
  }
  return true;
}

function mapeosIguales(a: MapeoColumnasCobertura, b: MapeoColumnasCobertura): boolean {
  const claves: (keyof MapeoColumnasCobertura)[] = [
    "sku",
    "ubicacion",
    "fechaCorte",
    "inventarioDisponible",
    "unidadInventario",
    "consumoDiarioEsperado",
    "unidadConsumoDiario",
  ];
  return claves.every((clave) => a[clave] === b[clave]);
}

/** true si `nueva` es exactamente la misma confirmacion que `persistida`
 * -- un reintento identico, seguro de responder con el estado ya
 * existente sin volver a persistir ni encolar nada. */
export function confirmacionesCoinciden(persistida: DatosConfirmacionCobertura, nueva: DatosConfirmacionCobertura): boolean {
  return (
    mapeosIguales(persistida.mapeoColumnas, nueva.mapeoColumnas) &&
    persistida.estrategia === nueva.estrategia &&
    fechasIguales(persistida.alcanceFechaCorteInicio, nueva.alcanceFechaCorteInicio) &&
    fechasIguales(persistida.alcanceFechaCorteFin, nueva.alcanceFechaCorteFin) &&
    conjuntosDeUbicacionesIguales(persistida.alcanceUbicaciones, nueva.alcanceUbicaciones) &&
    persistida.fuenteConsumo === nueva.fuenteConsumo &&
    fechasIguales(persistida.periodoReferenciaConsumoInicio, nueva.periodoReferenciaConsumoInicio) &&
    fechasIguales(persistida.periodoReferenciaConsumoFin, nueva.periodoReferenciaConsumoFin)
  );
}
