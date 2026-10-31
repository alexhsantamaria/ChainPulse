// Componente — crea el borrador derivado de una version (POST
// /api/plataforma/rf20/versiones/[versionId]/corregir, §7.4) y redirige
// al editor del borrador nuevo. corregirCuestionarioVersion() ya copia
// las preguntas del origen -- este boton no repite esa logica, solo
// dispara el POST y navega.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CorregirVersionBoton({ versionId }: { versionId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleClick() {
    setError(null);
    setCargando(true);

    const respuesta = await fetch(`/api/plataforma/rf20/versiones/${versionId}/corregir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const resultado = await respuesta.json().catch(() => null);
    setCargando(false);

    if (!respuesta.ok || !resultado?.ok) {
      setError(
        resultado?.motivo ?? resultado?.error ?? `No se pudo corregir (HTTP ${respuesta.status}).`,
      );
      return;
    }

    router.push(`/plataforma/rf20/versiones/${resultado.id}`);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={cargando}
        className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-400 disabled:opacity-50"
      >
        {cargando ? "Corrigiendo..." : "Corregir (nuevo borrador)"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
