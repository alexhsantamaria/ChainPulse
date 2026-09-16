// Componente — boton para marcar la recomendacion (RF8) de una conexion
// como ejecutada (RNF9). El padre solo lo renderiza para administradores
// y solo en conexiones con recomendacion (eslabones mas debiles del
// ciclo) -- este componente asume ambas condiciones ya validadas.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJsonSeguro } from "@/infra/http/fetchJsonSeguro";

export default function MarcarEjecutadaBoton({
  cicloId,
  conexionId,
  yaEjecutada,
}: {
  cicloId: string;
  conexionId: string;
  /** Fecha ya formateada para mostrar, o null si todavía no se marcó. */
  yaEjecutada: string | null;
}) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (yaEjecutada) {
    return <p className="text-xs text-emerald-700">Ejecutada el {yaEjecutada}</p>;
  }

  async function marcar() {
    setCargando(true);
    setError(null);
    const resultado = await fetchJsonSeguro(
      `/api/ciclos/${cicloId}/recomendaciones/${conexionId}/ejecutar`,
      { method: "POST" },
    );
    setCargando(false);
    if (resultado.ok) {
      router.refresh();
      return;
    }
    setError("No se pudo marcar. Intentá de nuevo.");
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={marcar}
        disabled={cargando}
        className="self-start rounded border border-amber-300 px-2 py-1 text-xs text-amber-800 hover:border-amber-500 disabled:opacity-50"
      >
        {cargando ? "Marcando..." : "Marcar como ejecutada"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
