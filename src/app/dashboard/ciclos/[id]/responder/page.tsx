// Pagina — un responsable completa el cuestionario del ciclo abierto (RF6).
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requireSessionOrRedirect } from "@/infra/auth/session";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { obtenerAsignacionesResponsable } from "@/infra/ciclos/registrarRespuestas";
import ResponderCuestionarioForm from "./ResponderCuestionarioForm";

export default async function ResponderCicloPage({ params }: { params: Promise<{ id: string }> }) {
  // Mecanismo de revocacion de sesiones (Alex, 2026-10-03,
  // diagnostico-eliminacion-cuenta-prueba.md Seccion 8): requireSessionOrRedirect()
  // reemplaza el auth() + chequeo manual de antes -- misma redireccion a
  // /login, ahora con la verificacion de sesion vigente incluida. El
  // chequeo de rol/eslabon de abajo es logica propia de esta pagina (RF6),
  // no cambia.
  const sesion = await requireSessionOrRedirect();
  if (sesion.rol !== "RESPONSABLE" || !sesion.eslabonId) {
    redirect("/dashboard/ciclos");
  }

  const { id } = await params;
  const ciclo = await tenantClient(sesion.empresaId).cicloPulso.findUnique({ where: { id } });
  if (!ciclo) {
    notFound();
  }
  if (ciclo.estado !== "ABIERTO") {
    redirect("/dashboard/ciclos");
  }

  const asignaciones = await obtenerAsignacionesResponsable({
    empresaId: sesion.empresaId,
    cicloPulsoId: id,
    eslabonId: sesion.eslabonId,
    responsableId: sesion.usuarioId,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard/ciclos" className="text-sm text-slate-500 underline">
          ← Volver a ciclos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Cuestionario del ciclo</h1>
        <p className="text-sm text-slate-600">
          Para cada conexión, indicá qué tan bien está funcionando hoy. 1 = muy mal, 5 = muy bien.
        </p>
      </div>

      {asignaciones.length > 0 ? (
        <ResponderCuestionarioForm cicloId={id} asignaciones={asignaciones} />
      ) : (
        <p className="text-sm text-slate-500">
          No tenés conexiones completas asignadas a tu eslabón en este ciclo.
        </p>
      )}
    </main>
  );
}
