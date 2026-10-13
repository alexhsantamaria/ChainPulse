// Infraestructura (solo para las herramientas de scripts/) -- manifiesto
// de una corrida de prueba de revocacion, y su validacion ESTRUCTURAL
// (Alex, 2026-10-04, punto 3 y punto 4). La correspondencia contra la
// base real (que la empresa y los usuarios de esa corrida existan de
// verdad, en el destino correcto) es un paso APARTE que si necesita
// Prisma -- ver verificarCorrespondenciaManifiesto en
// correspondenciaManifiesto.ts. Esta separacion es deliberada: permite
// probar la validacion estructural con pruebas comunes, sin mockear
// ninguna conexion.
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PREFIJO_EMPRESA = "ZZ_PRUEBA_REVOCACION_AISLADA";
export const DOMINIO_EMAIL_PRUEBA = "chainpulse.invalid";

export const SUFIJOS_USUARIO = ["a1", "a2", "a3", "a4"] as const;
export type SufijoUsuario = (typeof SUFIJOS_USUARIO)[number];

export const USO_POR_SUFIJO: Record<SufijoUsuario, string> = {
  a1: "escenario B -- sesion revocada",
  a2: "escenario E -- aislamiento, nunca se toca",
  a3: "escenario C -- usuario eliminado",
  a4: "escenario D -- JWT viejo sin claim",
};

export interface InfoUsuarioManifiesto {
  id: string;
  email: string;
  uso: string;
}

export interface ManifiestoPrueba {
  version: 1;
  runId: string;
  creadoEn: string;
  destino: { host: string; base: string };
  empresaId: string;
  usuarios: Record<SufijoUsuario, InfoUsuarioManifiesto>;
}

/** Punto 3: identificador unico por corrida -- nunca un nombre fijo. */
export function nuevoRunId(): string {
  return randomUUID();
}

export function nombreEmpresa(runId: string): string {
  return `${PREFIJO_EMPRESA}_${runId}`;
}

export function emailUsuario(runId: string, sufijo: SufijoUsuario): string {
  return `zz-prueba-revocacion-${runId}-${sufijo}@${DOMINIO_EMAIL_PRUEBA}`;
}

/**
 * Punto 3: "Guardalo fuera del repositorio" -- el directorio temporal
 * del sistema operativo, nunca dentro de scripts/ ni de ninguna carpeta
 * versionada. Un subdirectorio propio (no la raiz de tmp) para poder
 * listar o limpiar manifiestos viejos sin tocar nada ajeno.
 */
export function carpetaManifiestos(): string {
  return join(tmpdir(), "chainpulse-prueba-revocacion");
}

export function rutaManifiesto(runId: string): string {
  return join(carpetaManifiestos(), `manifiesto-${runId}.json`);
}

function esRegistroUsuarioValido(valor: unknown): valor is InfoUsuarioManifiesto {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.email === "string" &&
    v.email.length > 0 &&
    typeof v.uso === "string"
  );
}

/**
 * Validacion ESTRUCTURAL pura del manifiesto (Alex, 2026-10-04, punto
 * 4, primera mitad: "Validá la estructura del manifiesto ... antes de
 * cualquier mutación"). Comprueba la forma, los 4 usuarios esperados, y
 * que cada email corresponda EXACTAMENTE al runId y sufijo declarados
 * (un manifiesto editado a mano, o mezclado entre dos corridas, no pasa
 * aunque tenga "forma" valida). Nunca toca la base -- eso es un paso
 * aparte (ver correspondenciaManifiesto.ts), justamente para que esta
 * funcion se pueda probar sin mocks de Prisma.
 */
export function validarEstructuraManifiesto(valor: unknown): ManifiestoPrueba {
  if (typeof valor !== "object" || valor === null) throw new Error("MANIFIESTO_MALFORMADO");
  const m = valor as Record<string, unknown>;

  if (m.version !== 1) throw new Error("MANIFIESTO_VERSION_DESCONOCIDA");
  if (typeof m.runId !== "string" || m.runId.length === 0) throw new Error("MANIFIESTO_MALFORMADO");
  if (typeof m.creadoEn !== "string" || m.creadoEn.length === 0) throw new Error("MANIFIESTO_MALFORMADO");
  if (typeof m.empresaId !== "string" || m.empresaId.length === 0) throw new Error("MANIFIESTO_MALFORMADO");

  if (typeof m.destino !== "object" || m.destino === null) throw new Error("MANIFIESTO_MALFORMADO");
  const destino = m.destino as Record<string, unknown>;
  if (typeof destino.host !== "string" || destino.host.length === 0) throw new Error("MANIFIESTO_MALFORMADO");
  if (typeof destino.base !== "string" || destino.base.length === 0) throw new Error("MANIFIESTO_MALFORMADO");

  if (typeof m.usuarios !== "object" || m.usuarios === null) throw new Error("MANIFIESTO_MALFORMADO");
  const usuarios = m.usuarios as Record<string, unknown>;

  for (const sufijo of SUFIJOS_USUARIO) {
    const registro = usuarios[sufijo];
    if (!esRegistroUsuarioValido(registro)) throw new Error("MANIFIESTO_MALFORMADO");
    if (registro.email !== emailUsuario(m.runId as string, sufijo)) {
      throw new Error("MANIFIESTO_INCONSISTENTE");
    }
  }

  // IDs de los 4 usuarios deben ser distintos entre si (y del empresaId,
  // por si acaso) -- un manifiesto con un id repetido indicaria
  // corrupcion o edicion manual, nunca una siembra real de este script.
  const ids = SUFIJOS_USUARIO.map((s) => (usuarios[s] as InfoUsuarioManifiesto).id);
  if (new Set(ids).size !== ids.length || ids.includes(m.empresaId as string)) {
    throw new Error("MANIFIESTO_INCONSISTENTE");
  }

  return valor as ManifiestoPrueba;
}
