// Pagina — instrumentacion minima (RNF9): tiempo real de completar el
// cuestionario (vs. objetivo de 5 minutos de RNF2) y cuantas de las
// recomendaciones identificadas (RF8) ya se marcaron como ejecutadas.
// No es un sistema de analitica de producto -- son consultas agregadas
// simples sobre toda la empresa, sin filtros ni series temporales (ver
// requirements.md, RNF9). Solo administrador.
import Link from "next/link";
import { requireAdminOrRedirect } from "@/infra/auth/session";
import { obtenerMetricasAgregadas } from "@/infra/ciclos/metricasAgregadas";

export default async function MetricasPage() {
  // Mecanismo de revocacion de sesiones (Alex, 2026-10-03,
  // diagnostico-eliminacion-cuenta-prueba.md Seccion 8): requireAdminOrRedirect()
  // reemplaza el auth() + los dos chequeos manuales de antes (sesion y
  // rol) -- misma redireccion a /login o /dashboard segun el caso, ahora
  // con la verificacion de sesion vigente incluida.
  const sesion = await requireAdminOrRedirect();

  const metricas = await obtenerMetricasAgregadas(sesion.empresaId);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/dashboard" className="text-sm text-slate-500 underline">
          ← Volver al panel
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Métricas</h1>
        <p className="text-sm text-slate-600">Instrumentación mínima (RNF9) de todos los ciclos de tu empresa.</p>
      </div>

      <div className="rounded border border-slate-200 p-4">
        <p className="text-sm font-medium text-slate-700">Duración del cuestionario</p>
        {metricas.cuestionario.total === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Todavía nadie completó el cuestionario con esta métrica registrada.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-1 text-sm text-slate-600">
            <p>
              Promedio: {Math.round((metricas.cuestionario.promedioSegundos ?? 0) / 60)} min (
              {metricas.cuestionario.promedioSegundos?.toFixed(0)} s) sobre {metricas.cuestionario.total}{" "}
              {metricas.cuestionario.total === 1 ? "respuesta" : "respuestas"}.
            </p>
            <p>
              Dentro del objetivo de 5 minutos (RNF2): {metricas.cuestionario.dentroDelLimite} / {metricas.cuestionario.total} (
              {metricas.cuestionario.porcentajeDentroDelLimite?.toFixed(0)}%).
            </p>
          </div>
        )}
      </div>

      <div className="rounded border border-slate-200 p-4">
        <p className="text-sm font-medium text-slate-700">Recomendaciones ejecutadas</p>
        {metricas.recomendaciones.totalIdentificadas === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Todavía no se identificó ningún eslabón más débil.</p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            {metricas.recomendaciones.totalEjecutadas} / {metricas.recomendaciones.totalIdentificadas} marcadas como
            ejecutadas.
          </p>
        )}
      </div>
    </main>
  );
}
