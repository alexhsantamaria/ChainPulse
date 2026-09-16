// Componente — declara o completa una conexion entre dos eslabones (RF2/RF3).
//
// Un solo formulario para los dos casos (crear / completar despues), con
// los 5 datos de RF3 agrupados en tres bloques visuales cortos en vez de
// una lista plana de 5 campos sueltos -- pensado para que se pueda llenar
// de una sola vez sin sentirse largo (RNF2 aplica tambien aca, aunque RF3
// no tiene el limite de 5 minutos explicito de RF6). El grupo de origen y
// destino solo se muestra al crear: en modo "editar" ya estan fijos.
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchJsonSeguro } from "@/infra/http/fetchJsonSeguro";

type Eslabon = { id: string; nombre: string };

type DatosCriticidad = {
  gradoDependencia: string;
  impactoPromesaCliente: string;
  tieneAlternativa: string; // "" | "si" | "no" -- string en el form, boolean | null al enviar
  tiempoTolerable: string;
  tiempoRecuperacion: string;
};

const VACIO: DatosCriticidad = {
  gradoDependencia: "",
  impactoPromesaCliente: "",
  tieneAlternativa: "",
  tiempoTolerable: "",
  tiempoRecuperacion: "",
};

export default function ConexionForm({
  eslabones,
  modo,
  conexionExistente,
}: {
  eslabones: Eslabon[];
  modo: "crear" | "editar";
  conexionExistente?: {
    id: string;
    origenNombre: string;
    destinoNombre: string;
    gradoDependencia: string | null;
    impactoPromesaCliente: string | null;
    tieneAlternativa: boolean | null;
    tiempoTolerable: string | null;
    tiempoRecuperacion: string | null;
  };
}) {
  const router = useRouter();
  const [origenId, setOrigenId] = useState("");
  const [destinoId, setDestinoId] = useState("");
  const [datos, setDatos] = useState<DatosCriticidad>(
    conexionExistente
      ? {
          gradoDependencia: conexionExistente.gradoDependencia ?? "",
          impactoPromesaCliente: conexionExistente.impactoPromesaCliente ?? "",
          tieneAlternativa:
            conexionExistente.tieneAlternativa === true
              ? "si"
              : conexionExistente.tieneAlternativa === false
                ? "no"
                : "",
          tiempoTolerable: conexionExistente.tiempoTolerable ?? "",
          tiempoRecuperacion: conexionExistente.tiempoRecuperacion ?? "",
        }
      : VACIO,
  );
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  function campo<K extends keyof DatosCriticidad>(clave: K, valor: DatosCriticidad[K]) {
    setDatos((prev) => ({ ...prev, [clave]: valor }));
  }

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);

    const payload = {
      ...(modo === "crear" ? { origenId, destinoId } : {}),
      gradoDependencia: datos.gradoDependencia || null,
      impactoPromesaCliente: datos.impactoPromesaCliente || null,
      tieneAlternativa: datos.tieneAlternativa === "" ? null : datos.tieneAlternativa === "si",
      tiempoTolerable: datos.tiempoTolerable || null,
      tiempoRecuperacion: datos.tiempoRecuperacion || null,
    };

    const url = modo === "crear" ? "/api/conexiones" : `/api/conexiones/${conexionExistente!.id}`;
    const method = modo === "crear" ? "POST" : "PATCH";

    const resultado = await fetchJsonSeguro(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setCargando(false);

    if (!resultado.ok) {
      setError(
        resultado.error === "CONEXION_YA_EXISTE"
          ? "Ya existe una conexión declarada entre esos dos eslabones."
          : resultado.error === "ERROR_RED"
            ? "No se pudo conectar. Revisá tu conexión e intentá de nuevo."
            : "No se pudo guardar la conexión. Revisá los datos e intentá de nuevo.",
      );
      return;
    }

    if (modo === "crear") {
      setOrigenId("");
      setDestinoId("");
      setDatos(VACIO);
      router.refresh();
    } else {
      router.push("/dashboard/conexiones");
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 rounded border border-slate-200 p-4">
      {modo === "crear" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium">Conexión</legend>
          <label className="flex flex-col gap-1 text-sm">
            Desde (eslabón origen)
            <select
              required
              value={origenId}
              onChange={(e) => setOrigenId(e.target.value)}
              className="rounded border border-slate-300 px-3 py-2"
            >
              <option value="" disabled>
                Elegir eslabón...
              </option>
              {eslabones.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Hacia (eslabón destino, depende del origen)
            <select
              required
              value={destinoId}
              onChange={(e) => setDestinoId(e.target.value)}
              className="rounded border border-slate-300 px-3 py-2"
            >
              <option value="" disabled>
                Elegir eslabón...
              </option>
              {eslabones.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      ) : (
        <p className="text-sm text-slate-600">
          <span className="font-medium">{conexionExistente!.origenNombre}</span> →{" "}
          <span className="font-medium">{conexionExistente!.destinoNombre}</span>
        </p>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="font-medium">Dependencia</legend>
        <label className="flex flex-col gap-1 text-sm">
          Grado de dependencia
          <select
            value={datos.gradoDependencia}
            onChange={(e) => campo("gradoDependencia", e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          >
            <option value="">Sin confirmar</option>
            <option value="BAJA">Baja</option>
            <option value="MEDIA">Media</option>
            <option value="ALTA">Alta</option>
            <option value="CRITICA">Crítica</option>
          </select>
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-medium">Impacto y continuidad</legend>
        <label className="flex flex-col gap-1 text-sm">
          Impacto de una interrupción sobre la promesa al cliente
          <select
            value={datos.impactoPromesaCliente}
            onChange={(e) => campo("impactoPromesaCliente", e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          >
            <option value="">Sin confirmar</option>
            <option value="BAJO">Bajo</option>
            <option value="MEDIO">Medio</option>
            <option value="ALTO">Alto</option>
            <option value="CRITICO">Crítico</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          ¿Existe una alternativa o sustituto?
          <select
            value={datos.tieneAlternativa}
            onChange={(e) => campo("tieneAlternativa", e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          >
            <option value="">Sin confirmar</option>
            <option value="si">Sí</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tiempo tolerable sin esta conexión
          <select
            value={datos.tiempoTolerable}
            onChange={(e) => campo("tiempoTolerable", e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          >
            <option value="">Sin confirmar</option>
            <option value="CORTO">Corto (menos de 24 horas)</option>
            <option value="MEDIO">Medio (entre 24 horas y 1 semana)</option>
            <option value="LARGO">Largo (más de 1 semana)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tiempo estimado de recuperación
          <select
            value={datos.tiempoRecuperacion}
            onChange={(e) => campo("tiempoRecuperacion", e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          >
            <option value="">Sin confirmar</option>
            <option value="CORTO">Corto (menos de 24 horas)</option>
            <option value="MEDIO">Medio (entre 24 horas y 1 semana)</option>
            <option value="LARGO">Largo (más de 1 semana)</option>
          </select>
        </label>
      </fieldset>

      <p className="text-xs text-slate-500">
        Podés dejar estos datos sin confirmar y completarlos después — mientras falte alguno, la
        conexión queda marcada como incompleta y no entra en el cálculo del eslabón más débil ni
        del índice de integración (RF3).
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={cargando}
        className="self-start rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {cargando ? "Guardando..." : modo === "crear" ? "Declarar conexión" : "Guardar cambios"}
      </button>
    </form>
  );
}
