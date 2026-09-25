// Dominio -- huella de la vista previa de retiro (REEMPLAZO_ALCANCE,
// Incremento 4 Bloque B). Alex, 2026-09-25 (ronda de revision): "un
// booleano confirmarRetiro=true por si solo no demuestra que el usuario
// haya revisado esos mismos cambios" -- este hash ata la aceptacion
// explicita del usuario al CONJUNTO EXACTO de candidatas a retiro (mas
// el alcance) que la vista previa (soloVistaPrevia=true) le mostro. La
// ruta de confirmar recalcula candidatasRetiro+hash SIEMPRE contra el
// estado real de la base al momento de confirmar (nunca contra lo que
// mando el cliente) -- si no coincide con el retiroHash que el cliente
// manda de vuelta, algo cambio entre la vista previa y la confirmacion
// (otra importacion se proceso, una correccion manual, etc.) y hace
// falta una vista previa nueva.
//
// Funcion PURA -- mismo criterio que contenidoHashCobertura.ts (sha256,
// claves en orden alfabetico a mano, nunca Object.keys().sort() en
// runtime para que el orden sea visible en el codigo).
import { createHash } from "node:crypto";

export interface CandidataRetiroParaHash {
  id: string;
  sku: string;
  ubicacion: string;
  fechaCorte: Date;
}

export interface AlcanceParaHash {
  fechaCorteInicio: Date;
  fechaCorteFin: Date;
  ubicaciones: string[];
}

function comoFechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export function calcularHashVistaPreviaRetiro(candidatas: CandidataRetiroParaHash[], alcance: AlcanceParaHash): string {
  // Orden alfabetico de claves de nivel superior, a mano -- ver cabecera.
  const canonico = {
    alcanceFechaCorteFin: comoFechaISO(alcance.fechaCorteFin),
    alcanceFechaCorteInicio: comoFechaISO(alcance.fechaCorteInicio),
    alcanceUbicaciones: [...alcance.ubicaciones].sort(),
    // Cada candidata identificada por su fila (id) + clave de negocio --
    // el id solo no alcanza (dos importaciones distintas podrian, en
    // teoria, competir por la misma fila) y la clave de negocio sola
    // tampoco (no distingue CUAL fila real se va a retirar). Ordenadas
    // para que el hash no dependa del orden en que Postgres devolvio las
    // filas.
    candidatas: candidatas
      .map((c) => `${c.id}|${c.sku}|${c.ubicacion}|${comoFechaISO(c.fechaCorte)}`)
      .sort(),
  };
  return createHash("sha256").update(JSON.stringify(canonico)).digest("hex");
}
