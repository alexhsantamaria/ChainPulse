// Componente — cierra un ciclo de pulso abierto (RF7).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJsonSeguro } from "@/infra/http/fetchJsonSeguro";

export default function CerrarCicloBoton({ cicloId }: { cicloId: string }) {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setCargando(true);
    setError(null);

    const resultado = await fetchJsonSeguro(`/api/ciclos/${cicloId}/cerrar`, { method: "POST" });
    setCargando(false);

    if (!resultado.ok) {
      setError(
        resultado.error === "ERROR_RED"
          ? "No se pudo conectar. Revisá tu conexión e intentá de nuevo."
          : "No se pudo cerrar el ciclo.",
      );
      return;
    }

    router.push(`/dashboard/ciclos/${cicloId}`);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={cargando}
        className="text-xs text-slate-500 underline hover:text-slate-700 disabled:opacity-50"
      >
        {cargando ? "Cerrando..." : "Cerrar ciclo"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
