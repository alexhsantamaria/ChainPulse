// Pagina — mapa visual de una Cadena (RF34, requirements.md Seccion
// 14.3). Server Component: resuelve nodos/conexiones/flujos ya filtrados
// por tenant (RNF1/RNF13) y se los pasa como props iniciales al canvas
// cliente, que a partir de ahi administra su propio estado -- crear un
// nodo o una conexion pasa por las rutas propias del canvas
// (/api/cadenas/:id/nodos, /api/cadenas/:id/conexiones), nunca por esta
// pagina (mismo patron de "Server Component solo resuelve datos
// iniciales" que ciclos/[id]/responder le pasa "asignaciones" al form).
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

      <MapaCadenaCanvas cadenaId={cadena.id} nodosIniciales={cadena.nodos} conexionesIniciales={cadena.conexiones} />
    </main>
  );
}
