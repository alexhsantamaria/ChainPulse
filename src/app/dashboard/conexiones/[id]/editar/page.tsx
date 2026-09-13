// Pagina — completa o corrige los datos de criticidad de una conexion (RF3).
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import ConexionForm from "../../ConexionForm";

export default async function EditarConexionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    redirect("/login");
  }

  const { id } = await params;
  const conexion = await tenantClient(session.user.empresaId).conexion.findUnique({
    where: { id },
    include: { origen: true, destino: true },
  });

  if (!conexion) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard/conexiones" className="text-sm text-slate-500 underline">
          ← Volver a conexiones
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Completar datos de la conexión</h1>
      </div>

      <ConexionForm
        eslabones={[]}
        modo="editar"
        conexionExistente={{
          id: conexion.id,
          origenNombre: conexion.origen.nombre,
          destinoNombre: conexion.destino.nombre,
          gradoDependencia: conexion.gradoDependencia,
          impactoPromesaCliente: conexion.impactoPromesaCliente,
          tieneAlternativa: conexion.tieneAlternativa,
          tiempoTolerable: conexion.tiempoTolerable,
          tiempoRecuperacion: conexion.tiempoRecuperacion,
        }}
      />
    </main>
  );
}
