// Infraestructura — helpers puros de RF15/RF17 (Bloque A del Incremento 2),
// separados de limiteTasa.ts a proposito: ninguno de los dos toca Prisma ni
// ningun otro recurso externo, para que se puedan probar con
// `npm run test` sin depender de una conexion real a Neon (a diferencia de
// registrarIntento() en limiteTasa.ts, que si necesita la base).
import { createHmac } from "node:crypto";

// Valores iniciales de calibracion de RF15/RF17 (requirements.md Seccion
// 12), ambos por hora. Se exportan como constantes para que la ruta
// publica que los use (todavia sin construir) nunca los repita como
// numero magico.
export const LIMITE_INICIO_EVALUACION = 5;
export const LIMITE_DESBLOQUEO_DETALLE = 10;

/**
 * Hash salteado de la huella de origen (IP + fingerprint del visitante) —
 * nunca se guarda ni se procesa la IP en claro (PLAN-DE-TRABAJO.md Seccion
 * 18.2.E, mismo criterio de minimizacion). HUELLA_ORIGEN_SALT es
 * obligatorio: sin salto, el hash es reversible por fuerza bruta contra el
 * espacio (chico) de direcciones IPv4.
 */
export function hashHuellaOrigen(valorCrudo: string): string {
  const salt = process.env.HUELLA_ORIGEN_SALT;
  if (!salt) {
    throw new Error(
      "HUELLA_ORIGEN_SALT no esta configurado (ver .env.example / SEGURIDAD-credenciales.md).",
    );
  }
  return createHmac("sha256", salt).update(valorCrudo).digest("hex");
}

/** Trunca una fecha al inicio de su hora en UTC — la clave de la ventana fija de LimiteTasa. */
export function truncarVentanaHora(fecha: Date): Date {
  const truncada = new Date(fecha);
  truncada.setUTCMinutes(0, 0, 0);
  return truncada;
}
