// Pagina publica — acepta una invitacion de responsable de eslabon (RF4).
// No pasa por el middleware (matcher solo cubre /activar-mfa y
// /dashboard/:path*) porque quien la abre todavia no tiene cuenta.
import { tenantClient } from "@/infra/prisma/tenantClient";
import { verificarTokenInvitacion } from "@/infra/auth/invitacion";
import AceptarInvitacionForm from "./AceptarInvitacionForm";

export default async function AceptarInvitacionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const payload = token ? await verificarTokenInvitacion(token) : null;

  if (!payload) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">Invitación inválida o vencida</h1>
        <p className="text-sm text-slate-600">
          Pedile a quien te invitó que te mande un enlace nuevo.
        </p>
      </main>
    );
  }

  // tenantClient() con el empresaId del propio token, ya verificado --
  // mismo criterio que registro.ts/aceptarInvitacion.ts: el id no lo
  // elige quien visita la pagina, viene firmado.
  const client = tenantClient(payload.empresaId);
  const [eslabon, empresa] = await Promise.all([
    client.eslabon.findUnique({ where: { id: payload.eslabonId } }),
    client.empresa.findUnique({ where: { id: payload.empresaId } }),
  ]);

  if (!eslabon || !empresa) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">Invitación inválida</h1>
        <p className="text-sm text-slate-600">El eslabón o la empresa ya no existen.</p>
      </main>
    );
  }

  return (
    <AceptarInvitacionForm
      token={token as string}
      email={payload.email}
      empresaNombre={empresa.nombre}
      eslabonNombre={eslabon.nombre}
    />
  );
}
