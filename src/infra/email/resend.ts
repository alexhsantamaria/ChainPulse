// Infraestructura — envio de correo transaccional via Resend (RF4).
//
// Sin un dominio propio verificado en Resend, el remitente por defecto
// ("onboarding@resend.dev") solo puede enviar a la direccion con la que
// se creo la cuenta de Resend (modo sandbox) -- suficiente para probar el
// flujo de invitacion ahora; verificar un dominio propio queda pendiente
// para cuando se invite a gente real de las empresas piloto (no bloquea
// el Incremento 1).
//
// IMPORTANTE -- el SDK de Resend NO lanza excepcion en un fallo de la
// API (dominio de prueba, rebote, rate limit, etc): `emails.send()`
// devuelve siempre `{ data, error }`, nunca rechaza la promesa (ver
// `Response<T>` en node_modules/resend/dist/index.d.mts). Bug real
// encontrado por Alex 2026-09-24: invito a 2 direcciones distintas
// probando Bloque C Paso 3, la 2da (fuera del dominio de prueba)
// devolvio 403 de Resend pero la UI no mostro ningun error -- porque
// estas funciones hacian `await cliente.emails.send(...)` sin revisar
// `error`, asi que el 403 se tragaba en silencio y el llamador (ej.
// api/cadenas/[id]/invitar) creia que el correo se habia enviado bien.
// Por eso TODA funcion de aca abajo revisa `error` explicitamente y
// lanza -- asi el try/catch de cada ruta (que ya existia) lo atrapa de
// verdad y le devuelve un error real al usuario, en vez de un falso
// exito. Mismo criterio para las 4 funciones, no solo la de invitacion
// de cadena: enviarCorreoRecuperacion es la mas sensible (RF/recuperar-
// contrasena) -- un fallo silencioso ahi deja a alguien esperando un
// correo que nunca va a llegar, sin forma de saberlo.
import { Resend } from "resend";

function obtenerCliente(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Falta RESEND_API_KEY en .env");
  }
  return new Resend(apiKey);
}

const REMITENTE = process.env.RESEND_FROM_EMAIL || "ChainPulse <onboarding@resend.dev>";

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function enviarInvitacionResponsable(datos: {
  email: string;
  empresaNombre: string;
  eslabonNombre: string;
  linkInvitacion: string;
}): Promise<void> {
  const cliente = obtenerCliente();
  const { error } = await cliente.emails.send({
    from: REMITENTE,
    to: datos.email,
    subject: `${datos.empresaNombre} te invitó a ChainPulse`,
    html: `
      <p>Te invitaron a ser responsable del eslabón <strong>${escaparHtml(datos.eslabonNombre)}</strong> en <strong>${escaparHtml(datos.empresaNombre)}</strong> dentro de ChainPulse.</p>
      <p><a href="${datos.linkInvitacion}">Aceptar invitación y crear tu cuenta</a></p>
      <p>Este enlace vence en 7 días.</p>
    `,
  });
  if (error) {
    throw new Error(`Resend enviarInvitacionResponsable: ${error.message}`);
  }
}

// RF36 — invitacion a responder sobre una Cadena o una conexion puntual
// del mapa, sin cuenta (el invitado nunca crea un Usuario, ver el
// comentario de cabecera de invitacion.ts). "alcance" ya viene resuelto
// en texto desde el llamador -- esta funcion no decide de negocio, solo
// arma el correo.
export async function enviarInvitacionCadena(datos: {
  email: string;
  empresaNombre: string;
  cadenaNombre: string;
  alcanceTexto: string;
  linkInvitacion: string;
}): Promise<void> {
  const cliente = obtenerCliente();
  const { error } = await cliente.emails.send({
    from: REMITENTE,
    to: datos.email,
    subject: `${datos.empresaNombre} te invitó a participar en ChainPulse`,
    html: `
      <p>Te invitaron a responder sobre ${escaparHtml(datos.alcanceTexto)} de la cadena <strong>${escaparHtml(datos.cadenaNombre)}</strong> en <strong>${escaparHtml(datos.empresaNombre)}</strong> dentro de ChainPulse.</p>
      <p><a href="${datos.linkInvitacion}">Responder ahora</a></p>
      <p>No hace falta crear ninguna cuenta. Este enlace vence en 7 días.</p>
    `,
  });
  if (error) {
    throw new Error(`Resend enviarInvitacionCadena: ${error.message}`);
  }
}

// RF5 — aviso de apertura de ciclo a un responsable elegible.
export async function enviarAvisoCicloAbierto(datos: { email: string; nombre: string }): Promise<void> {
  const cliente = obtenerCliente();
  const { error } = await cliente.emails.send({
    from: REMITENTE,
    to: datos.email,
    subject: "Nuevo ciclo de pulso abierto en ChainPulse",
    html: `
      <p>Hola ${escaparHtml(datos.nombre)},</p>
      <p>Se abrió un nuevo ciclo de pulso para las conexiones de tu eslabón. Ingresá a ChainPulse para responder el cuestionario.</p>
    `,
  });
  if (error) {
    throw new Error(`Resend enviarAvisoCicloAbierto: ${error.message}`);
  }
}

// Recuperacion de contraseña -- enlace de un solo uso (ver
// src/infra/auth/recuperacion.ts), vence en 1 hora.
export async function enviarCorreoRecuperacion(datos: { email: string; nombre: string; link: string }): Promise<void> {
  const cliente = obtenerCliente();
  const { error } = await cliente.emails.send({
    from: REMITENTE,
    to: datos.email,
    subject: "Recuperá tu contraseña de ChainPulse",
    html: `
      <p>Hola ${escaparHtml(datos.nombre)},</p>
      <p>Pediste recuperar tu contraseña de ChainPulse. Si fuiste vos, hacé clic para elegir una nueva:</p>
      <p><a href="${datos.link}">Elegir contraseña nueva</a></p>
      <p>Este enlace vence en 1 hora. Si no pediste esto, podés ignorar este correo -- tu contraseña actual sigue funcionando.</p>
    `,
  });
  if (error) {
    throw new Error(`Resend enviarCorreoRecuperacion: ${error.message}`);
  }
}
