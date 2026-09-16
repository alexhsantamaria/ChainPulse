// Infraestructura — normaliza el tiempo de respuesta de un flujo que no
// debe revelar por timing si una cuenta existe (Ronda 5 de revision,
// hallazgo R5-2: login y recuperar-contrasena ya evitaban la enumeracion
// en el CONTENIDO de la respuesta, pero no en cuanto tardaba en llegar --
// la rama "no existe" volvia casi de inmediato mientras la rama "existe"
// corria Argon2id o llamaba a Resend antes de responder, un timing attack
// clasico, OWASP A07).
//
// `conPisoDeTiempo` espera a que termine el trabajo real Y a que pase un
// piso minimo de tiempo, lo que tarde mas -- asi la respuesta nunca sale
// antes de ese piso, sin importar que rama del codigo se ejecuto. No es
// una garantia criptografica exacta (jitter de red/CPU sigue existiendo),
// pero cierra la diferencia de ordenes de magnitud entre "responder de
// inmediato" y "correr Argon2id"/"llamar a una API externa", que es lo
// que un atacante puede medir de forma practica.
export async function conPisoDeTiempo<T>(trabajo: Promise<T>, pisoMs: number): Promise<T> {
  const [resultado] = await Promise.all([
    trabajo,
    new Promise<void>((resolve) => setTimeout(resolve, pisoMs)),
  ]);
  return resultado;
}

// Piso elegido para cubrir el costo tipico de un hash Argon2id (login) o
// una llamada a la API de Resend (recuperar contraseña) en este proyecto
// -- ambos casos documentados en README como del orden de cientos de ms.
// Un valor fijo (no medido dinamicamente) a proposito: medir el costo
// real de la rama lenta y usarlo como piso reintroduciria la misma fuga
// de informacion por otra via.
export const PISO_TIEMPO_AUTENTICACION_MS = 400;
