// Componente — abre un nuevo ciclo de pulso (RF5).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AbrirCicloBoton() {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setCargando(true);
    setError(null);

    const respuesta = await fetch("/api/ciclos", { method: "POST" });
    const resultado = await respuesta.json();
    setCargando(false);

    if (!resultado.ok) {
      setError(
        resultado.error === "CICLO_YA_ABIERTO" ? "Ya hay un ciclo abierto." : "No se pudo abrir el ciclo.",
      );
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        onClick={handleClick}
        disabled={cargando}
        className="self-start rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {cargando ? "Abriendo..." : "Abrir nuevo ciclo"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
