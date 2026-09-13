// Pagina — lista y declara conexiones entre eslabones (RF2/RF3).
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import ConexionForm from "./ConexionForm";

export default async function ConexionesPage() {
  const session = await auth();
  if (!session?.user?.empresaId) {
    redirect("/login");
  }

  const client = tenantClient(session.user.empresaId);
  const [eslabones, conexiones] = await Promise.all([
    client.eslabon.findMany({ orderBy: { createdAt: "asc" } }),
    client.conexion.findMany({
      orderBy: { createdAt: "asc" },
      include: { origen: true, destino: true },
    }),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard" className="text-sm text-slate-500 underline">
          ← Volver al panel
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Conexiones entre eslabones</h1>
        <p className="text-sm text-slate-600">
          Cada dependencia declarada entre dos eslabones, con su grado de dependencia y sus datos
          de criticidad (RF3).
        </p>
      </div>

      {eslabones.length < 2 ? (
        <p className="text-sm text-slate-500">
          Necesitás al menos dos eslabones declarados para crear una conexión.{" "}
          <Link href="/dashboard/eslabones" className="underline">
            Declarar eslabones →
          </Link>
        </p>
      ) : (
        <>
          {conexiones.length > 0 ? (
            <ul className="flex flex-col divide-y divide-slate-200 rounded border border-slate-200">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003) */}
              {conexiones.map((conexion: any) => (
                <li key={conexion.id} className="flex items-center justify-between px-4 py-3">
                  <span>
                    {conexion.origen.nombre} → {conexion.destino.nombre}
                  </span>
                  {conexion.completa ? (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      completa
                    </span>
                  ) : (
                    <Link
                      href={`/dashboard/conexiones/${conexion.id}/editar`}
                      className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-200"
                    >
                      incompleta — completar →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Todavía no hay conexiones declaradas.</p>
          )}

          <ConexionForm eslabones={eslabones} modo="crear" />
        </>
      )}
    </main>
  );
}
