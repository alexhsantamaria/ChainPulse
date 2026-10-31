// Componente — edita notasCambio de un borrador (PATCH
// /api/plataforma/rf20/versiones/[versionId], §7.5).
// editar_metadata_cuestionario_version() ya rechaza si la version no
// esta en BORRADOR -- el disabled de aqui es solo UX (evita un POST que
// el servidor va a rechazar igual), nunca la unica barrera real.
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function MetadataForm({
  versionId,
  notasCambioInicial,
  editable,
}: {
  versionId: string;
  notasCambioInicial: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [notas, setNotas] = useState(notasCambioInicial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setOk(false);
    setCargando(true);

    const respuesta = await fetch(`/api/plataforma/rf20/versiones/${versionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notasCambio: notas.trim().length === 0 ? null : notas }),
    });
    const resultado = await respuesta.json().catch(() => null);
    setCargando(false);

    if (!respuesta.ok || !resultado?.ok) {
      setError(resultado?.motivo ?? resultado?.error ?? `No se pudo guardar (HTTP ${respuesta.status}).`);
      return;
    }
    setOk(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Notas de cambio
        <textarea
          value={notas}
          disabled={!editable}
          onChange={(e) => setNotas(e.target.value)}
          rows={3}
          className="rounded border border-slate-300 px-3 py-2 disabled:bg-slate-50 disabled:text-slate-400"
        />
      </label>
      {editable && (
        <button
          type="submit"
          disabled={cargando}
          className="w-fit rounded border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-400 disabled:opacity-50"
        >
          {cargando ? "Guardando..." : "Guardar notas"}
        </button>
      )}
      {!editable && (
        <p className="text-xs text-slate-400">
          Solo se puede editar la metadata de una versión en BORRADOR.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {ok && !error && <p className="text-sm text-emerald-700">Guardado.</p>}
    </form>
  );
}
