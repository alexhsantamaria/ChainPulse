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

// Incremento 5, PR1 -- limite piloto de POST /api/consultas/ejecutar
// (usuario autenticado, no huella de IP cruda: ver
// codificarHuellaConsultaAutenticada() mas abajo). "Piloto" a proposito
// (aprobacion provisional de Alex, 2026-11-17): 30 intentos/hora es un
// valor de partida razonado (una sesion real de uso del catalogo de 6
// preguntas, incluso explorando todas con varios periodos, no se
// acerca a 30 en una hora) pero no calibrado contra uso real -- queda
// documentado aca, en un solo lugar, para poder ajustarlo sin tocar la
// ruta ni los tests de la ruta (mismo criterio que
// LIMITE_INICIO_EVALUACION/LIMITE_DESBLOQUEO_DETALLE arriba).
export const LIMITE_CONSULTA_EJECUTAR = 30;

/**
 * Codifica (empresaId, usuarioId) en un valor crudo univoco para pasar a
 * hashHuellaOrigen() -- Incremento 5 PR1, a pedido explicito de Alex
 * (2026-11-17): la huella de este bucket es por USUARIO autenticado, no
 * por IP cruda (a diferencia de INICIO_EVALUACION/DESBLOQUEO_DETALLE,
 * que son publicos y sin sesion).
 *
 * Longitud-prefijada por campo, nunca una concatenacion naive: sin el
 * prefijo de longitud, empresaId="ab"+usuarioId="c" y empresaId="a"+
 * usuarioId="bc" producirian el mismo valor crudo "abc" (colision real,
 * no solo teorica, si algun id alguna vez tiene longitud variable). El
 * prefijo de dominio "consulta-autenticada:v1" ademas garantiza que esta
 * huella nunca puede colisionar con la huella de IP cruda de
 * INICIO_EVALUACION/DESBLOQUEO_DETALLE (que nunca lleva este prefijo) ni
 * con una version futura de esta misma codificacion (":v2", si el
 * formato cambia).
 */
export function codificarHuellaConsultaAutenticada(empresaId: string, usuarioId: string): string {
  return `consulta-autenticada:v1:${empresaId.length}:${empresaId}:${usuarioId.length}:${usuarioId}`;
}

/** Desglose de un bucket de LimiteTasa (ventanaInicio truncada +
 * contador acumulado en ese bucket) -- lo que necesita
 * calcularSegundosHastaProximoIntentoPermitido() para calcular el
 * Retry-After. Mismo shape que devuelve ahora registrarIntento() en
 * limiteTasa.ts (campo `buckets` de ResultadoLimiteTasa). */
export interface BucketConteo {
  ventanaInicio: Date;
  contador: number;
}

/**
 * Pura -- segundos hasta que el PROXIMO intento (uno mas sobre lo que
 * ya esta registrado en `buckets`) pasaria a estar permitido, para un
 * limite de tasa por ventana deslizante de varios buckets (Incremento 5
 * PR1, Opcion A, a pedido explicito de Alex, 2026-11-17: "no apruebo
 * calcular siempre los segundos hasta el cierre del bucket vigente y
 * presentarlos como si fueran exactos... podria recibir otro 429
 * inmediatamente, haciendo incorrecto el contrato de Retry-After").
 *
 * CORRECCION 2026-11-17 (ronda 3 de revision de Alex) -- el contrato
 * anterior devolvia el primer instante en que `restante <= limite`,
 * asumiendo implicitamente que el proximo intento no suma nada a la
 * cuenta. Es falso: registrarIntento() SIEMPRE incrementa el bucket
 * actual ANTES de evaluar `permitido = contador <= limite` (ver
 * limiteTasa.ts), asi que el proximo intento es, el mismo, uno mas sobre
 * `restante`. Ejemplo que expone el bug con la condicion vieja: limite
 * = 30, bucket mas viejo = 1, buckets posteriores = 30 (total = 31). Al
 * expirar el bucket mas viejo quedan 30 -- la condicion vieja (30 <= 30)
 * decia "ya se puede reintentar", pero el reintento suma 1 y vuelve a
 * 31: OTRO 429. La condicion correcta es `restante < limite`
 * (equivalente a `restante <= limite - 1`), que es exactamente la que
 * garantiza `restante + 1 <= limite` para el proximo intento.
 *
 * INVARIANTE que hace esto correcto (misma condicion que usa
 * registrarIntento() para sumar buckets, "ventanaInicio" >= ahora -
 * ventana): un bucket con ventanaInicio = B deja de contar en la ventana
 * deslizante de `ventanaMinutos` minutos recien en el instante real
 * B + ventanaMinutos minutos, nunca antes. Por eso alcanza recorrer los
 * buckets ordenados por ventanaInicio ASCENDENTE (los mas viejos
 * primero) restando su contador de la suma total: el primer bucket cuya
 * expiracion deja al restante EN O POR DEBAJO de `limite - 1` (es decir
 * `restante < limite`) es el que fija el momento real en que el PROXIMO
 * intento (restante + 1) pasaria a estar permitido.
 *
 * "EXACTO" es una afirmacion condicional, no absoluta: el valor devuelto
 * es exacto UNICAMENTE bajo el supuesto de que no llegan mas solicitudes
 * (de este mismo usuario, a este mismo bucket) mientras se espera. Si
 * durante la espera ocurre una solicitud concurrente adicional (otra
 * pestana, otro dispositivo con la misma sesion, una carrera de red), el
 * bucket actual vuelve a incrementarse y el intento que efectivamente se
 * reintente en el instante calculado puede volver a recibir 429 -- esta
 * funcion no puede ver ni descontar esas solicitudes porque todavia no
 * ocurrieron en el momento en que se la invoca.
 *
 * Devuelve 0 si la suma actual YA deja margen para un proximo intento
 * (`totalInicial < limite`: el proximo intento, totalInicial + 1,
 * todavia cumpliria `<= limite`). Quien llama en la practica solo
 * invoca esto cuando ya determino `!permitido` (totalInicial > limite,
 * nunca == limite ni < limite en ese camino), pero la funcion es pura y
 * defensiva ante cualquier entrada -- incluido el caso borde
 * `totalInicial == limite`, que NO cae en este camino rapido: un
 * proximo intento haria `limite + 1 > limite`, asi que hay que esperar
 * a que expire algun bucket, igual que en el camino general.
 */
export function calcularSegundosHastaProximoIntentoPermitido(
  buckets: readonly BucketConteo[],
  limite: number,
  ahora: Date,
  ventanaMinutos: number = VENTANA_MINUTOS_LIMITE_TASA,
): number {
  const totalInicial = buckets.reduce((suma, bucket) => suma + bucket.contador, 0);
  if (totalInicial < limite) return 0;

  const ordenadosPorMasViejo = [...buckets].sort(
    (a, b) => a.ventanaInicio.getTime() - b.ventanaInicio.getTime(),
  );

  let restante = totalInicial;
  for (const bucket of ordenadosPorMasViejo) {
    restante -= bucket.contador;
    if (restante < limite) {
      const instanteExpiracion = bucket.ventanaInicio.getTime() + ventanaMinutos * 60_000;
      const segundos = Math.ceil((instanteExpiracion - ahora.getTime()) / 1000);
      return Math.max(segundos, 0);
    }
  }
  // Defensivo, no deberia alcanzarse: si totalInicial >= limite, el
  // ultimo bucket de la lista siempre deja restante en 0 (< cualquier
  // limite >= 1) y ya retorno en la iteracion anterior. Queda como red
  // de seguridad ante un `limite` no positivo (no deberia pasar nunca --
  // LIMITE_CONSULTA_EJECUTAR y el resto de los limites del modulo son
  // constantes positivas) para nunca devolver `undefined`.
  return 0;
}
