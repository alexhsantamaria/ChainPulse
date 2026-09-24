// Componente — declara una Cadena nueva (RF27). Solo los 4 campos de la
// Cadena en si -- nodos y conexiones se agregan despues, directamente
// sobre el mapa visual (RF34), nunca en este formulario.
"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchJsonSeguro } from "@/infra/http/fetchJsonSeguro";

const TIPOS_OPERACION: { valor: string; etiqueta: string }[] = [
  { valor: "manufactura", etiqueta: "Manufactura" },
  { valor: "distribucion", etiqueta: "Distribución" },
  { valor: "comercio", etiqueta: "Comercio" },
  { valor: "servicios", etiqueta: "Servicios" },
  { valor: "otra", etiqueta: "Otra" },
];

export default function NuevaCadenaForm() {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [productoServicio, setProductoServicio] = useState("");
  const [periodoInicio, setPeriodoInicio] = useState("");
  const [periodoFin, setPeriodoFin] = useState("");
  const [tipoOperacion, setTipoOperacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Bug encontrado por Alex (2026-09-24): al declarar una cadena, a veces
  // quedaban 2 filas identicas (mismo nombre/periodo, una con nodos y otra
  // con 0). `disabled={cargando}` en el boton NO alcanza para evitar un
  // doble envio real: `cargando` es estado de React, que se pinta en el
  // DOM recien despues de que el navegador ya proceso el evento -- dos
  // clicks (o Enter + click) muy seguidos pueden disparar handleSubmit()
  // dos veces antes de que el boton se vea/este deshabilitado de verdad, y
  // como Cadena no tiene ninguna restriccion de unicidad (RF27 no la
  // pide), el backend crea las 2 sin quejarse. Un `ref` es sincronico --
  // se lee/escribe al toque, sin esperar un repintado -- asi que bloquea
  // el segundo envio pase lo que pase con el render.
  const enviandoRef = useRef(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setError(null);
    setCargando(true);

    try {
      const resultado = await fetchJsonSeguro("/api/cadenas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, productoServicio, periodoInicio, periodoFin, tipoOperacion }),
      });

      if (!resultado.ok) {
        setError(
          resultado.error === "ERROR_RED"
            ? "No se pudo conectar. Revisá tu conexión e intentá de nuevo."
            : "No se pudo guardar la cadena. Revisá que el período de fin sea posterior al de inicio e intentá de nuevo.",
        );
        return;
      }

      if (typeof resultado.cadenaId === "string") {
        router.push(`/dashboard/cadenas/${resultado.cadenaId}`);
        return;
      }
      setNombre("");
      setProductoServicio("");
      setPeriodoInicio("");
      setPeriodoFin("");
      setTipoOperacion("");
      router.refresh();
    } finally {
      setCargando(false);
      enviandoRef.current = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border border-slate-200 p-4">
      <h2 className="font-medium">Declarar una cadena nueva</h2>
      <label className="flex flex-col gap-1 text-sm">
        Nombre (ej. &quot;Exportación de arándanos 2026&quot;)
        <input
          type="text"
          required
          minLength={2}
          maxLength={160}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Producto o servicio concreto que abarca
        <input
          type="text"
          required
          minLength={2}
          maxLength={200}
          value={productoServicio}
          onChange={(e) => setProductoServicio(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
      </label>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Período — inicio
          <input
            type="date"
            required
            value={periodoInicio}
            onChange={(e) => setPeriodoInicio(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Período — fin
          <input
            type="date"
            required
            value={periodoFin}
            onChange={(e) => setPeriodoFin(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Tipo de operación
        <select
          required
          value={tipoOperacion}
          onChange={(e) => setTipoOperacion(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        >
          <option value="" disabled>
            Elegir...
          </option>
          {TIPOS_OPERACION.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.etiqueta}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={cargando}
        className="self-start rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {cargando ? "Guardando..." : "Declarar cadena"}
      </button>
    </form>
  );
}
