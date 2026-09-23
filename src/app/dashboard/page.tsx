// Pagina — panel principal del administrador (RF9, version inicial).
//
// Esta primera version es solo el hub de RF2/RF3 (declarar eslabones y
// conexiones) -- los cuatro valores por conexion, el eslabon mas debil y
// el indice de integracion (RF9 completo) llegan cuando exista al menos
// un ciclo de pulso cerrado (RF5-RF7, proximo paso segun README).
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import CerrarSesionBoton from "./CerrarSesionBoton";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.empresaId) {
    redirect("/login");
  }

  const client = tenantClient(session.user.empresaId);
  const [eslabones, conexiones] = await Promise.all([
    client.eslabon.findMany(),
    client.conexion.findMany(),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  const conexionesCompletas = conexiones.filter((c: any) => c.completa).length;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Panel de {session.user.name}</h1>
          <p className="text-sm text-slate-500">{session.user.email}</p>
        </div>
        <CerrarSesionBoton />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/dashboard/eslabones"
          className="rounded border border-slate-200 p-4 hover:border-slate-400"
        >
          <p className="text-sm text-slate-500">Eslabones declarados</p>
          <p className="text-3xl font-semibold">{eslabones.length}</p>
          <p className="mt-2 text-sm text-slate-600">Ver / declarar eslabones →</p>
        </Link>
        <Link
          href="/dashboard/conexiones"
          className="rounded border border-slate-200 p-4 hover:border-slate-400"
        >
          <p className="text-sm text-slate-500">Conexiones declaradas</p>
          <p className="text-3xl font-semibold">
            {conexionesCompletas} / {conexiones.length}{" "}
            <span className="text-base font-normal text-slate-500">completas</span>
          </p>
          <p className="mt-2 text-sm text-slate-600">Ver / declarar conexiones →</p>
        </Link>
        <Link
          href="/dashboard/ciclos"
          className="rounded border border-slate-200 p-4 hover:border-slate-400 sm:col-span-2"
        >
          <p className="text-sm text-slate-500">Ciclos de pulso</p>
          <p className="mt-2 text-sm text-slate-600">
            Abrir un ciclo, responder el cuestionario o ver los resultados calculados →
          </p>
        </Link>
        <Link
          href="/dashboard/cadenas"
          className="rounded border border-slate-200 p-4 hover:border-slate-400 sm:col-span-2"
        >
          <p className="text-sm text-slate-500">Cadenas (mapa)</p>
          <p className="mt-2 text-sm text-slate-600">
            Declarar una cadena y ver su mapa de nodos y conexiones →
          </p>
        </Link>
        {session.user.rol === "ADMINISTRADOR" && (
          <Link
            href="/dashboard/metricas"
            className="rounded border border-slate-200 p-4 hover:border-slate-400 sm:col-span-2"
          >
            <p className="text-sm text-slate-500">Métricas</p>
            <p className="mt-2 text-sm text-slate-600">
              Duración del cuestionario y recomendaciones ejecutadas (RNF9) →
            </p>
          </Link>
        )}
      </div>

      {eslabones.length === 0 && (
        <p className="text-sm text-slate-500">
          Todavía no declaraste ningún eslabón. Empezá por{" "}
          <Link href="/dashboard/eslabones" className="underline">
            declarar los eslabones
          </Link>{" "}
          de tu cadena antes de conectar dependencias entre ellos.
        </p>
      )}
    </main>
  );
}
