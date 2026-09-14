// Pagina — resultados de un ciclo cerrado: salud, criticidad, riesgo y
// dependencia (los 4 valores de RF9) por conexion, eslabones mas debiles,
// indice de integracion, recomendacion (RF8) y tendencia de salud de
// ciclos anteriores por conexion (RF9).
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { obtenerResultadosCiclo } from "@/infra/ciclos/resultados";

export default async function ResultadosCicloPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.empresaId) {
    redirect("/login");
  }

  const { id } = await params;
  const datos = await obtenerResultadosCiclo(session.user.empresaId, id);
  if (!datos) {
    notFound();
  }

  const idsDebiles = new Set(datos.resultadoCiclo?.eslabonesMasDebilesIds ?? []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard/ciclos" className="text-sm text-slate-500 underline">
          ← Volver a ciclos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Resultados del ciclo</h1>
        <p className="text-sm text-slate-600">
          {datos.ciclo.cerradoEn
            ? `Cerrado el ${new Date(datos.ciclo.cerradoEn).toLocaleDateString("es-AR")}.`
            : "Este ciclo todavía está abierto."}
          {datos.ciclo.coberturaRespuesta != null &&
            ` Cobertura: ${datos.ciclo.coberturaRespuesta.toFixed(0)}%.`}
        </p>
      </div>

      {datos.resultadoCiclo && (
        <div className="rounded border border-slate-200 p-4">
          <p className="text-sm text-slate-500">Índice de integración (RF16)</p>
          <p className="text-3xl font-semibold">{datos.resultadoCiclo.indiceIntegracion.toFixed(0)}</p>
        </div>
      )}

      {datos.resultadosConexion.length > 0 ? (
        <ul className="flex flex-col divide-y divide-slate-200 rounded border border-slate-200">
          {datos.resultadosConexion.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {r.origenNombre} → {r.destinoNombre}
                </p>
                {idsDebiles.has(r.conexionId) && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                    eslabón más débil
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Salud: {r.salud.toFixed(0)} · Criticidad: {r.criticidad.toFixed(0)} · Riesgo:{" "}
                {r.riesgo.toFixed(0)} · Dependencia: {r.gradoDependenciaSnapshot}
              </p>
              {r.tendenciaSalud.length > 1 && (
                <p className="text-xs text-slate-400">
                  Tendencia de salud: {r.tendenciaSalud.map((v) => v.toFixed(0)).join(" → ")}
                </p>
              )}
              {r.recomendacion && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-medium text-amber-800">
                    Recomendación · prioridad {r.recomendacion.prioridad.toLowerCase()}
                  </p>
                  <p className="mt-1 text-xs text-amber-900">{r.recomendacion.texto}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">Ninguna conexión tuvo respuestas válidas en este ciclo.</p>
      )}
    </main>
  );
}
