// Componente — boton para marcar la recomendacion (RF8) de una conexion
// como ejecutada (RNF9). El padre solo lo renderiza para administradores
// y solo en conexiones con recomendacion (eslabones mas debiles del
// ciclo) -- este componente asume ambas condiciones ya validadas.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

  if (yaEjecutada) {
    return <p className="text-xs text-emerald-700">Ejecutada el {yaEjecutada}</p>;
  }

  async function marcar() {
    setCargando(true);
    const respuesta = await fetch(`/api/ciclos/${cicloId}/recomendaciones/${conexionId}/ejecutar`, {
      method: "POST",
    });
    setCargando(false);
    if (respuesta.ok) {
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={marcar}
      disabled={cargando}
      className="self-start rounded border border-amber-300 px-2 py-1 text-xs text-amber-800 hover:border-amber-500 disabled:opacity-50"
    >
      {cargando ? "Marcando..." : "Marcar como ejecutada"}
    </button>
  );
}
