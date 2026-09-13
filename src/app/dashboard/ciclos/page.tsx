// Pagina — lista los ciclos de pulso y permite abrir/cerrar/responder (RF5-RF7).
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { tenantClient } from "@/infra/prisma/tenantClient";
import AbrirCicloBoton from "./AbrirCicloBoton";
import CerrarCicloBoton from "./CerrarCicloBoton";

export default async function CiclosPage() {
  const session = await auth();
  if (!session?.user?.empresaId) {
    redirect("/login");
  }

  const ciclos = await tenantClient(session.user.empresaId).cicloPulso.findMany({
    orderBy: { abiertoEn: "desc" },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  const hayCicloAbierto = ciclos.some((c: any) => c.estado === "ABIERTO");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard" className="text-sm text-slate-500 underline">
          ← Volver al panel
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Ciclos de pulso</h1>
        <p className="text-sm text-slate-600">
          Cada ciclo envía el cuestionario a los responsables de las conexiones completas y calcula
          salud, criticidad y riesgo reales al cerrarse (RF5-RF7).
        </p>
      </div>

      {session.user.rol === "ADMINISTRADOR" && !hayCicloAbierto && <AbrirCicloBoton />}

      {ciclos.length > 0 ? (
        <ul className="flex flex-col divide-y divide-slate-200 rounded border border-slate-200">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003) */}
          {ciclos.map((ciclo: any) => (
            <li key={ciclo.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm">
                  Ciclo del {new Date(ciclo.abiertoEn).toLocaleDateString("es-AR")}
                  {" — "}
                  <span className={ciclo.estado === "ABIERTO" ? "text-amber-600" : "text-slate-500"}>
                    {ciclo.estado === "ABIERTO" ? "abierto" : "cerrado"}
                  </span>
                </p>
                {ciclo.coberturaRespuesta != null && (
                  <p className="text-xs text-slate-500">Cobertura: {ciclo.coberturaRespuesta.toFixed(0)}%</p>
                )}
              </div>
              <span className="flex items-center gap-3">
                {ciclo.estado === "ABIERTO" && session.user.rol === "RESPONSABLE" && session.user.eslabonId && (
                  <Link
                    href={`/dashboard/ciclos/${ciclo.id}/responder`}
                    className="text-xs text-slate-500 underline hover:text-slate-700"
                  >
                    Responder cuestionario
                  </Link>
                )}
                {ciclo.estado === "ABIERTO" && session.user.rol === "ADMINISTRADOR" && (
                  <CerrarCicloBoton cicloId={ciclo.id} />
                )}
                {ciclo.estado === "CERRADO" && (
                  <Link
                    href={`/dashboard/ciclos/${ciclo.id}`}
                    className="text-xs text-slate-500 underline hover:text-slate-700"
                  >
                    Ver resultados
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Todavía no se abrió ningún ciclo de pulso.</p>
      )}
    </main>
  );
}
