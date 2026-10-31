// Componente — publica (§7.8) o retira manualmente (§7.8, retiro
// manual) una version. Solo se renderiza para ADMINISTRADOR_PLATAFORMA
// (decision de autorizacion de PR 8, igual que el guard de las rutas) --
// ver requireAdministradorPlataformaRuta() en las rutas publicar/retirar.
// "versionVigenteActualId" viaja desde el Server Component (no se
// recalcula aqui) para que publicar_cuestionario_version() pueda
// detectar con IS DISTINCT FROM una vigente cambiada entre que la
// pagina cargo y que el curador confirmo.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PublicarRetirarPanel({
  versionId,
  estado,
  versionVigenteActualId,
}: {
  versionId: string;
  estado: string;
  versionVigenteActualId: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function publicar() {
    setError(null);
    setCargando(true);
    // try/catch/finally (deuda de revision del PR 8, hallazgo Medio) --
    // publicar/retirar son las acciones de mayor impacto de todo el
    // modulo: un fallo de red en fetch() (no una respuesta HTTP de
    // error) dejaba el boton trabado y la promesa sin manejar. El
    // comportamiento para cualquier respuesta HTTP valida no cambia.
    try {
      const respuesta = await fetch(`/api/plataforma/rf20/versiones/${versionId}/publicar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionVigenteEsperadaId: versionVigenteActualId }),
      });
      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok || !resultado?.ok) {
        setError(resultado?.motivo ?? resultado?.error ?? `No se pudo publicar (HTTP ${respuesta.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  async function retirar() {
    setError(null);
    setCargando(true);
    // try/catch/finally (deuda de revision del PR 8, hallazgo Medio) --
    // mismo motivo que publicar() arriba.
    try {
      const respuesta = await fetch(`/api/plataforma/rf20/versiones/${versionId}/retirar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok || !resultado?.ok) {
        setError(resultado?.motivo ?? resultado?.error ?? `No se pudo retirar (HTTP ${respuesta.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-slate-200 p-4">
      <p className="text-sm font-medium text-slate-700">Gobernanza (solo administrador)</p>
      <div className="flex gap-3">
        {estado === "BORRADOR" && (
          <button
            type="button"
            onClick={publicar}
            disabled={cargando}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {cargando ? "Publicando..." : "Publicar"}
          </button>
        )}
        {estado === "PUBLICADA" && (
          <button
            type="button"
            onClick={retirar}
            disabled={cargando}
            className="rounded bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {cargando ? "Retirando..." : "Retirar"}
          </button>
        )}
        {estado === "RETIRADA" && <p className="text-sm text-slate-400">Versión retirada, sin acciones.</p>}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
