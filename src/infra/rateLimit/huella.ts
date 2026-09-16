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

// R5-19 (Ronda 5, MEDIO) -- LimiteTasa usaba una ventana FIJA por hora
// (un solo bucket de 60 min, truncarVentanaHora): un visitante podia mandar
// hasta `limite` intentos a las 13:59 y otros `limite` a las 14:00:00 --
// dos ventanas "distintas" desde el punto de vista de la tabla, pero
// separadas por segundos en el reloj real, duplicando de hecho el limite
// alrededor de cada frontera de hora.
//
// La correccion no toca el schema ("ventanaInicio" en prisma/schema.prisma
// ya es un DateTime generico, sin significado de "hora exacta" grabado en
// la estructura): se reduce la granularidad del bucket a 15 minutos y
// registrarIntento() (./limiteTasa.ts) suma los ultimos BUCKETS_POR_VENTANA
// buckets (incluido el actual) en vez de mirar uno solo. Sigue sin ser una
// ventana deslizante exacta -- el peor caso de doble conteo baja de "una
// ventana completa" a "como mucho un bucket de 15 minutos", que alcanza
// para el proposito de RF15/RF17 (limitar abuso, no una garantia
// matematica): mismo criterio ya documentado en limiteTasa.ts.
export const BUCKET_MINUTOS_LIMITE_TASA = 15;
export const VENTANA_MINUTOS_LIMITE_TASA = 60;
export const BUCKETS_POR_VENTANA_LIMITE_TASA = VENTANA_MINUTOS_LIMITE_TASA / BUCKET_MINUTOS_LIMITE_TASA;

/** Trunca una fecha al inicio de su bucket de `bucketMinutos` minutos, en UTC. */
export function truncarVentanaBucket(fecha: Date, bucketMinutos: number = BUCKET_MINUTOS_LIMITE_TASA): Date {
  const truncada = new Date(fecha);
  const minutoBucket = Math.floor(truncada.getUTCMinutes() / bucketMinutos) * bucketMinutos;
  truncada.setUTCMinutes(minutoBucket, 0, 0);
  return truncada;
}
