// Pagina — un responsable completa el cuestionario del ciclo abierto (RF6).
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import { obtenerAsignacionesResponsable } from "@/infra/ciclos/registrarRespuestas";
import ResponderCuestionarioForm from "./ResponderCuestionarioForm";

export default async function ResponderCicloPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    redirect("/login");
  }
  if (session.user.rol !== "RESPONSABLE" || !session.user.eslabonId) {
    redirect("/dashboard/ciclos");
  }

  const { id } = await params;
  const ciclo = await tenantClient(session.user.empresaId).cicloPulso.findUnique({ where: { id } });
  if (!ciclo) {
    notFound();
  }
  if (ciclo.estado !== "ABIERTO") {
    redirect("/dashboard/ciclos");
  }

  const asignaciones = await obtenerAsignacionesResponsable({
    empresaId: session.user.empresaId,
    cicloPulsoId: id,
    eslabonId: session.user.eslabonId,
    responsableId: session.user.id,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard/ciclos" className="text-sm text-slate-500 underline">
          ← Volver a ciclos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Cuestionario del ciclo</h1>
        <p className="text-sm text-slate-600">
          Para cada conexión, indicá qué tan bien está funcionando hoy (RF6). 1 = muy mal, 5 = muy bien.
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
