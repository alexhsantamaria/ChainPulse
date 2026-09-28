// Pagina — genera el QR de MFA para el administrador en sesion (RF1, ADR-0003).
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { construirOtpauthUrl } from "@/infra/auth/mfa";
import { asegurarSecretoMfa } from "@/infra/auth/enrolamientoMfa";
import ActivarMfaForm from "./ActivarMfaForm";

export default async function ActivarMfaPage() {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/login");
  }

  const usuario = await tenantClient(session.user.empresaId).usuario.findFirst({
    where: { email: session.user.email },
  });

  if (!usuario) {
    redirect("/login");
  }

  // Ya la activo antes (o el seed la marco activa) -- no hay nada que hacer aca.
  if (usuario.mfaHabilitado) {
    redirect("/");
  }

  // Antes: si mfaSecret era null esta pagina redirigia derecho a /login,
  // sin distinguir "sesion invalida" de "administrador legitimo sin
  // secreto todavia" -- el segundo caso ocurre cuando alguien cambia el
  // rol de un usuario a ADMINISTRADOR por fuera de registrarEmpresaYAdmin()
  // (por ejemplo, editando `rol` a mano en Prisma Studio sobre una cuenta
  // creada como RESPONSABLE via crearUsuarioResponsable(), que deja
  // mfaSecret en null a proposito -- ver aceptarInvitacion.ts). El
  // administrador quedaba en un loop silencioso entre /login y
  // /activar-mfa sin ninguna forma de completar el MFA que el middleware
  // le exige. asegurarSecretoMfa() genera (o reutiliza, si ya existia) el
  // secreto de forma idempotente -- ver el comentario de esa funcion.
  // mfaHabilitado sigue en false hasta que /api/mfa/activar valide un
  // codigo TOTP real; esta pagina nunca lo marca en true.
  const secreto = await asegurarSecretoMfa(session.user.empresaId, usuario);

  const otpauthUrl = construirOtpauthUrl(usuario.email, secreto);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  return <ActivarMfaForm qrDataUrl={qrDataUrl} secreto={secreto} />;
}
