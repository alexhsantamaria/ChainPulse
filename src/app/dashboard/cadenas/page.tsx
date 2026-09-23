// Pagina — lista y declara Cadenas del mapa (RF27, requirements.md
// Seccion 14.1). Cada Cadena es el alcance de una evaluacion (producto o
// servicio concreto + periodo) dentro de la Empresa -- ver
// PLAN-DE-TRABAJO.md "Incremento 3 -- Mapa y profundidad".
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import NuevaCadenaForm from "./NuevaCadenaForm";

export default async function CadenasPage() {
  const session = await auth();
  if (!session?.user?.empresaId) {
    redirect("/login");
  }

  const cadenas = await tenantClient(session.user.empresaId).cadena.findMany({
    orderBy: { createdAt: "asc" },
    // Punto D de la revision externa del 2026-09-22: dos cadenas con el
    // mismo nombre/producto eran indistinguibles en esta lista -- se
    // agrega periodo, tipo de operacion y cantidad de nodos para poder
    // diferenciarlas sin tener que abrir cada mapa.
    include: { _count: { select: { nodos: true } } },
  });

  const formatearFecha = (fecha: Date) =>
    fecha.toLocaleDateString("es-PE", { year: "numeric", month: "short" });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard" className="text-sm text-slate-500 underline">
          ← Volver al panel
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Cadenas (mapa)</h1>
        <p className="text-sm text-slate-600">
          Cada Cadena delimita un producto o servicio concreto y un periodo — dentro de ella se
          declara el mapa de nodos y conexiones.
        </p>
      </div>

      {cadenas.length > 0 ? (
        <ul className="flex flex-col divide-y divide-slate-200 rounded border border-slate-200">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003) */}
          {cadenas.map((cadena: any) => (
            <li key={cadena.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-medium">{cadena.nombre}</p>
                <p className="text-xs text-slate-500">
                  {cadena.productoServicio} · {cadena.tipoOperacion} ·{" "}
                  {formatearFecha(cadena.periodoInicio)}–{formatearFecha(cadena.periodoFin)} ·{" "}
                  {cadena._count.nodos} {cadena._count.nodos === 1 ? "nodo" : "nodos"}
                </p>
              </div>
              <Link
                href={`/dashboard/cadenas/${cadena.id}`}
                className="text-xs text-slate-500 underline hover:text-slate-700"
              >
                Ver mapa →
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Todavía no declaraste ninguna cadena.</p>
      )}

      <NuevaCadenaForm />
    </main>
  );
}
