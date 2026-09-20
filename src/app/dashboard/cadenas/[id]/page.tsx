// Pagina — mapa visual de una Cadena (RF34, requirements.md Seccion
// 14.3). Server Component: resuelve nodos/conexiones/flujos ya filtrados
// por tenant (RNF1/RNF13) y se los pasa como props al canvas cliente --
// mismo patron que page.tsx de ciclos/[id]/responder le pasa
// "asignaciones" al form (PLAN-DE-TRABAJO.md, Bloque B).
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import MapaCadenaCanvas from "./MapaCadenaCanvas";

export default async function CadenaMapaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    redirect("/login");
  }

  const { id } = await params;
  const cadena = await tenantClient(session.user.empresaId).cadena.findUnique({
    where: { id },
    include: {
      nodos: { orderBy: { createdAt: "asc" } },
      conexiones: { include: { flujos: true }, orderBy: { createdAt: "asc" } },
    },
  });

  if (!cadena) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard/cadenas" className="text-sm text-slate-500 underline">
          ← Volver a cadenas
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{cadena.nombre}</h1>
        <p className="text-sm text-slate-600">
          {cadena.productoServicio} — {cadena.tipoOperacion}
        </p>
      </div>

      <MapaCadenaCanvas nodos={cadena.nodos} conexiones={cadena.conexiones} />

      {cadena.nodos.length === 0 && (
        <p className="text-sm text-slate-500">
          Este mapa todavía no tiene nodos. La creación de nodos y conexiones directamente sobre
          el mapa (RF34) llega en el siguiente paso del Bloque B — por ahora el mapa muestra lo
          que ya exista.
        </p>
      )}
    </main>
  );
}
