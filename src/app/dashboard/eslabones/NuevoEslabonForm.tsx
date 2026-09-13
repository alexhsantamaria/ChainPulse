// Componente — declara un eslabon nuevo (RF2).
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function NuevoEslabonForm() {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [esProveedorExterno, setEsProveedorExterno] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);

    const respuesta = await fetch("/api/eslabones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, esProveedorExterno }),
    });
    const resultado = await respuesta.json();
    setCargando(false);

    if (!resultado.ok) {
      setError("No se pudo guardar el eslabón. Revisá el nombre e intentá de nuevo.");
      return;
    }

    setNombre("");
    setEsProveedorExterno(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border border-slate-200 p-4">
      <h2 className="font-medium">Declarar un eslabón nuevo</h2>
      <label className="flex flex-col gap-1 text-sm">
        Nombre (ej. &quot;Compras&quot;, &quot;Producción&quot;, &quot;Proveedor de materia prima&quot;)
        <input
          type="text"
          required
          minLength={2}
          maxLength={120}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={esProveedorExterno}
          onChange={(e) => setEsProveedorExterno(e.target.checked)}
        />
        Es un proveedor o actor externo (no un área interna)
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={cargando}
        className="self-start rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {cargando ? "Guardando..." : "Agregar eslabón"}
      </button>
    </form>
  );
}
