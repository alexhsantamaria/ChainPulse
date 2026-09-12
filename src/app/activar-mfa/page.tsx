// Pagina — genera el QR de MFA para el administrador recien registrado (RF1, ADR-0003).
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { construirOtpauthUrl } from "@/infra/auth/mfa";
import ActivarMfaForm from "./ActivarMfaForm";

export default async function ActivarMfaPage() {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/login");
  }

  const usuario = await tenantClient(session.user.empresaId).usuario.findFirst({
    where: { email: session.user.email },
  });

  if (!usuario || !usuario.mfaSecret) {
    redirect("/login");
  }

  // Ya la activo antes (o el seed la marco activa) -- no hay nada que hacer aca.
  if (usuario.mfaHabilitado) {
    redirect("/");
  }

  const otpauthUrl = construirOtpauthUrl(usuario.email, usuario.mfaSecret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  return <ActivarMfaForm qrDataUrl={qrDataUrl} secreto={usuario.mfaSecret} />;
}
