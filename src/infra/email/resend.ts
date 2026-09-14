// Infraestructura — envio de correo transaccional via Resend (RF4).
//
// Sin un dominio propio verificado en Resend, el remitente por defecto
// ("onboarding@resend.dev") solo puede enviar a la direccion con la que
// se creo la cuenta de Resend (modo sandbox) -- suficiente para probar el
// flujo de invitacion ahora; verificar un dominio propio queda pendiente
// para cuando se invite a gente real de las empresas piloto (no bloquea
// el Incremento 1).
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
  await cliente.emails.send({
    from: REMITENTE,
    to: datos.email,
    subject: `${datos.empresaNombre} te invitó a ChainPulse`,
    html: `
      <p>Te invitaron a ser responsable del eslabón <strong>${escaparHtml(datos.eslabonNombre)}</strong> en <strong>${escaparHtml(datos.empresaNombre)}</strong> dentro de ChainPulse.</p>
      <p><a href="${datos.linkInvitacion}">Aceptar invitación y crear tu cuenta</a></p>
      <p>Este enlace vence en 7 días.</p>
    `,
  });
}

// RF5 — aviso de apertura de ciclo a un responsable elegible.
export async function enviarAvisoCicloAbierto(datos: { email: string; nombre: string }): Promise<void> {
  const cliente = obtenerCliente();
  await cliente.emails.send({
    from: REMITENTE,
    to: datos.email,
    subject: "Nuevo ciclo de pulso abierto en ChainPulse",
    html: `
      <p>Hola ${escaparHtml(datos.nombre)},</p>
      <p>Se abrió un nuevo ciclo de pulso para las conexiones de tu eslabón. Ingresá a ChainPulse para responder el cuestionario.</p>
    `,
  });
}

// Recuperacion de contraseña -- enlace de un solo uso (ver
// src/infra/auth/recuperacion.ts), vence en 1 hora.
export async function enviarCorreoRecuperacion(datos: { email: string; nombre: string; link: string }): Promise<void> {
  const cliente = obtenerCliente();
  await cliente.emails.send({
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
}
