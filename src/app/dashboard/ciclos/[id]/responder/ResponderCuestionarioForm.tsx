// Componente — formulario de respuesta al cuestionario del ciclo (RF6).
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AsignacionConexion } from "@/infra/ciclos/registrarRespuestas";

type Respuesta = { valor: number | null; noSabe: boolean; noAplica: boolean };

export default function ResponderCuestionarioForm({
  cicloId,
  asignaciones,
}: {
  cicloId: string;
  asignaciones: AsignacionConexion[];
}) {
  const router = useRouter();
  // RNF9 -- instante en que se monta el formulario, para medir cuanto
  // tarda el responsable en completarlo (RNF2: objetivo 5 minutos). Se
  // fija una sola vez con el inicializador perezoso de useState, no en
  // cada render.
  const [inicio] = useState(() => Date.now());
  const [respuestas, setRespuestas] = useState<Record<string, Respuesta>>(() => {
    const inicial: Record<string, Respuesta> = {};
    for (const asignacion of asignaciones) {
      inicial[asignacion.conexionId] = asignacion.respuestaExistente ?? {
        valor: null,
        noSabe: false,
        noAplica: false,
      };
    }
    return inicial;
  });
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [cargando, setCargando] = useState(false);

  function actualizar(conexionId: string, valor: Respuesta) {
    setRespuestas((prev) => ({ ...prev, [conexionId]: valor }));
  }

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setExito(false);

    const faltantes = asignaciones.filter((asignacion) => {
      const r = respuestas[asignacion.conexionId] ?? { valor: null, noSabe: false, noAplica: false };
      return !r.noSabe && !r.noAplica && r.valor === null;
    });
    if (faltantes.length > 0) {
      setError("Respondé todas las conexiones antes de enviar (o marcá \"No sé\" / \"No aplica\").");
      return;
    }

    setCargando(true);
    const duracionSegundos = Math.round((Date.now() - inicio) / 1000);
    const respuesta = await fetch(`/api/ciclos/${cicloId}/respuestas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        respuestas: asignaciones.map((asignacion) => ({
          conexionId: asignacion.conexionId,
          ...respuestas[asignacion.conexionId],
        })),
        duracionSegundos,
      }),
    });
    const resultado = await respuesta.json();
    setCargando(false);

    if (!resultado.ok) {
      setError("No se pudo enviar el cuestionario. Intentá de nuevo.");
      return;
    }

    setExito(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {asignaciones.map((asignacion) => {
        const r = respuestas[asignacion.conexionId] ?? { valor: null, noSabe: false, noAplica: false };
        return (
          <div key={asignacion.conexionId} className="flex flex-col gap-2 rounded border border-slate-200 p-4">
            <p className="text-sm font-medium">
              {asignacion.origenNombre} → {asignacion.destinoNombre}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => actualizar(asignacion.conexionId, { valor: n, noSabe: false, noAplica: false })}
                  className={`h-9 w-9 rounded border text-sm ${
                    r.valor === n && !r.noSabe && !r.noAplica
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300"
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => actualizar(asignacion.conexionId, { valor: null, noSabe: true, noAplica: false })}
                className={`rounded border px-2 py-1 text-xs ${
                  r.noSabe ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
                }`}
              >
                No sé
              </button>
              <button
                type="button"
                onClick={() => actualizar(asignacion.conexionId, { valor: null, noSabe: false, noAplica: true })}
                className={`rounded border px-2 py-1 text-xs ${
                  r.noAplica ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
                }`}
              >
                No aplica
              </button>
            </div>
          </div>
        );
      })}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {exito && <p className="text-sm text-green-700">Respuestas enviadas.</p>}
      <button
        type="submit"
        disabled={cargando}
        className="self-start rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {cargando ? "Enviando..." : "Enviar respuestas"}
      </button>
    </form>
  );
}
