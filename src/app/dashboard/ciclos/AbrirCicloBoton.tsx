// Componente — abre un nuevo ciclo de pulso (RF5).
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJsonSeguro } from "@/infra/http/fetchJsonSeguro";

export default function AbrirCicloBoton() {
  const router = useRouter();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultadoEnvio, setResultadoEnvio] = useState<string | null>(null);

  async function handleClick() {
    setCargando(true);
    setError(null);
    setResultadoEnvio(null);

    const resultado = await fetchJsonSeguro("/api/ciclos", { method: "POST" });
    setCargando(false);

    if (!resultado.ok) {
      setError(
        resultado.error === "CICLO_YA_ABIERTO"
          ? "Ya hay un ciclo abierto."
          : resultado.error === "ERROR_RED"
            ? "No se pudo conectar. Revisá tu conexión e intentá de nuevo."
            : "No se pudo abrir el ciclo.",
      );
      return;
    }

    const notificados = typeof resultado.responsablesNotificados === "number" ? resultado.responsablesNotificados : 0;
    const total = typeof resultado.totalResponsables === "number" ? resultado.totalResponsables : 0;
    setResultadoEnvio(
      total === 0
        ? "Ciclo abierto. No había responsables elegibles para notificar."
        : `Ciclo abierto. Resend aceptó ${notificados} de ${total} ${total === 1 ? "correo" : "correos"} para envío.`,
    );
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
      {resultadoEnvio && <p className="text-sm text-emerald-700">{resultadoEnvio}</p>}
    </div>
  );
}
