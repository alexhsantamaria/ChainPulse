// Pagina — el administrador invita a un responsable para este eslabon (RF4).
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdminOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import InvitarResponsableForm from "./InvitarResponsableForm";

export default async function InvitarResponsablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Mecanismo de revocacion de sesiones (Alex, 2026-10-03,
  // diagnostico-eliminacion-cuenta-prueba.md Seccion 8): requireAdminOrRedirect()
  // reemplaza el auth() + los dos chequeos manuales de antes (sesion y
  // rol) -- misma redireccion a /login o /dashboard segun el caso, ahora
  // con la verificacion de sesion vigente incluida.
  const sesion = await requireAdminOrRedirect();

  const { id } = await params;
  const eslabon = await tenantClient(sesion.empresaId).eslabon.findUnique({ where: { id } });
  if (!eslabon) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard/eslabones" className="text-sm text-slate-500 underline">
          ← Volver a eslabones
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Invitar responsable</h1>
        <p className="text-sm text-slate-600">
          Para el eslabón <strong>{eslabon.nombre}</strong>. Va a recibir un correo con un enlace
          para crear su cuenta, con acceso limitado a este eslabón.
        </p>
      </div>
      <InvitarResponsableForm eslabonId={eslabon.id} />
    </main>
  );
}
