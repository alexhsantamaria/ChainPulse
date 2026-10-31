// Componente — crea la primera version (BORRADOR) de un codigo nuevo
// (POST /api/plataforma/rf20/cuestionarios). Mismo patron de fetch que
// ActivarMfaForm.tsx: content-type explicito (lo exige
// validarSolicitudEscrituraPlataforma) y refresh en vez de reinventar
// el estado que el Server Component ya cargo.
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function CrearCuestionarioForm() {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);

    // try/catch/finally (deuda de revision del PR 8, hallazgo Medio): un
    // fallo de RED (no una respuesta HTTP de error, que el bloque de
    // abajo ya cubre, sino que fetch() mismo rechace -- sin conexion,
    // DNS, CORS) quedaba sin manejar -- el boton se trababa en
    // "Creando..." para siempre y la promesa de handleSubmit quedaba
    // rechazada sin capturar. Mismo criterio que LoginForm.tsx/
    // CodigoMfaPlataformaForm.tsx: nunca se expone el detalle crudo del
    // error, solo un mensaje generico. El comportamiento para cualquier
    // respuesta HTTP valida (ok o no) no cambia.
    try {
      const respuesta = await fetch("/api/plataforma/rf20/cuestionarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      const resultado = await respuesta.json().catch(() => null);

      if (!respuesta.ok || !resultado?.ok) {
        setError(
          resultado?.motivo ?? resultado?.error ?? `No se pudo crear (HTTP ${respuesta.status}).`,
        );
        return;
      }

      setCodigo("");
      router.push(`/plataforma/rf20/cuestionarios/${encodeURIComponent(codigo)}`);
      router.refresh();
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Código (ej. evaluacion-expres-v2)
        <input
          type="text"
          required
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={cargando || codigo.trim().length === 0}
        className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {cargando ? "Creando..." : "Crear versión 1 (borrador)"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
