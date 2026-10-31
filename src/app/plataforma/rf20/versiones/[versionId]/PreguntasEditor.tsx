// Componente — CRUD + reordenamiento de preguntas de un borrador (§7.5,
// §7.6). Todas las invariantes (estado BORRADOR, duplicados, secuencia
// 1..N, estructura de "opciones") viven exclusivamente en las funciones
// SECURITY DEFINER -- este componente solo junta el payload y muestra el
// {ok:false, motivo} que la API ya tradujo. "opciones" se edita como
// JSON crudo a proposito (no se repite aqui el parser/validador que ya
// existe en el servidor); el boton "Validar estructura" invoca
// EXACTAMENTE la misma funcion que publicar usara despues
// (/api/plataforma/rf20/validar-opciones), para que el curador pueda
// corregir antes de publicar sin adivinar.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const DIMENSIONES = ["ALINEACION", "COORDINACION", "INTEGRACION", "EVIDENCIA", "RESILIENCIA"] as const;

export interface PreguntaEditable {
  id: string;
  codigo: string;
  orden: number;
  texto: string;
  dimension: string;
  opciones: unknown;
  esNoPuntuable: boolean;
}

// Exportada (deuda de revision del PR 8, hallazgo Medio) para que las
// pruebas focalizadas puedan ejercer el try/catch sin jsdom -- es una
// funcion standalone, sin hooks ni JSX, así que es segura de exportar
// sin cambiar ningún comportamiento del componente.
export async function validarOpciones(opcionesTexto: string): Promise<string> {
  let opciones: unknown;
  try {
    opciones = JSON.parse(opcionesTexto);
  } catch {
    return "JSON invalido.";
  }
  // try/catch (deuda de revision del PR 8, hallazgo Medio): un fallo de
  // red en fetch() (no una respuesta HTTP de error, ya cubierta mas
  // abajo) quedaba sin manejar -- la promesa del onClick que llama a
  // esta funcion quedaba rechazada sin capturar. El comportamiento para
  // cualquier respuesta HTTP valida no cambia. Esta funcion no maneja
  // ningún estado "cargando" propio (lo decide quien la llama), así
  // que no hace falta ningún finally aquí.
  try {
    const respuesta = await fetch("/api/plataforma/rf20/validar-opciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opciones }),
    });
    const resultado = await respuesta.json().catch(() => null);
    if (!respuesta.ok || !resultado?.ok) {
      return resultado?.error ?? `No se pudo validar (HTTP ${respuesta.status}).`;
    }
    return resultado.valido ? "Estructura válida." : `Inválida: ${resultado.motivo}`;
  } catch {
    return "No se pudo conectar. Revisá tu conexión e intentá de nuevo.";
  }
}

function CamposPregunta({
  codigoEditable,
  valores,
  onChange,
}: {
  codigoEditable: boolean;
  valores: { codigo: string; texto: string; dimension: string; opcionesTexto: string; esNoPuntuable: boolean };
  onChange: (v: typeof valores) => void;
}) {
  const [resultadoValidacion, setResultadoValidacion] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Código (Q1..Q7, estable entre versiones)
        <input
          type="text"
          required
          disabled={!codigoEditable}
          value={valores.codigo}
          onChange={(e) => onChange({ ...valores, codigo: e.target.value })}
          className="rounded border border-slate-300 px-3 py-2 disabled:bg-slate-50 disabled:text-slate-400"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Texto
        <textarea
          required
          rows={2}
          value={valores.texto}
          onChange={(e) => onChange({ ...valores, texto: e.target.value })}
          className="rounded border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Dimensión
        <select
          value={valores.dimension}
          onChange={(e) => onChange({ ...valores, dimension: e.target.value })}
          className="rounded border border-slate-300 px-3 py-2"
        >
          {DIMENSIONES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={valores.esNoPuntuable}
          onChange={(e) => onChange({ ...valores, esNoPuntuable: e.target.checked })}
        />
        Es no puntuable
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Opciones (JSON)
        <textarea
          required
          rows={4}
          value={valores.opcionesTexto}
          onChange={(e) => onChange({ ...valores, opcionesTexto: e.target.value })}
          className="rounded border border-slate-300 px-3 py-2 font-mono text-xs"
        />
      </label>
      <button
        type="button"
        onClick={async () => setResultadoValidacion(await validarOpciones(valores.opcionesTexto))}
        className="w-fit rounded border border-slate-300 px-2 py-1 text-xs hover:border-slate-400"
      >
        Validar estructura de opciones
      </button>
      {resultadoValidacion && <p className="text-xs text-slate-600">{resultadoValidacion}</p>}
    </div>
  );
}

function FilaPregunta({
  versionId,
  pregunta,
  editable,
  esPrimera,
  esUltima,
  todasLasOrdenes,
}: {
  versionId: string;
  pregunta: PreguntaEditable;
  editable: boolean;
  esPrimera: boolean;
  esUltima: boolean;
  todasLasOrdenes: Array<{ id: string; orden: number }>;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valores, setValores] = useState({
    codigo: pregunta.codigo,
    texto: pregunta.texto,
    dimension: pregunta.dimension,
    opcionesTexto: JSON.stringify(pregunta.opciones, null, 2),
    esNoPuntuable: pregunta.esNoPuntuable,
  });
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function guardar() {
    setError(null);
    let opciones: unknown;
    try {
      opciones = JSON.parse(valores.opcionesTexto);
    } catch {
      setError("El campo opciones no es JSON válido.");
      return;
    }
    setCargando(true);
    // try/catch/finally (deuda de revision del PR 8, hallazgo Medio) --
    // mismo motivo que CrearCuestionarioForm.tsx: un fallo de red en
    // fetch() (no una respuesta HTTP de error) dejaba el boton trabado
    // y la promesa sin manejar. El comportamiento para cualquier
    // respuesta HTTP valida no cambia.
    try {
      const respuesta = await fetch(`/api/plataforma/rf20/preguntas/${pregunta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: valores.texto,
          dimension: valores.dimension,
          opciones,
          esNoPuntuable: valores.esNoPuntuable,
        }),
      });
      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok || !resultado?.ok) {
        setError(resultado?.motivo ?? resultado?.error ?? `No se pudo guardar (HTTP ${respuesta.status}).`);
        return;
      }
      setEditando(false);
      router.refresh();
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  async function eliminar() {
    setError(null);
    setCargando(true);
    // try/catch/finally (deuda de revision del PR 8, hallazgo Medio) --
    // mismo motivo que guardar() arriba.
    try {
      const respuesta = await fetch(`/api/plataforma/rf20/preguntas/${pregunta.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok || !resultado?.ok) {
        setError(resultado?.motivo ?? resultado?.error ?? `No se pudo eliminar (HTTP ${respuesta.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  async function mover(direccion: "arriba" | "abajo") {
    setError(null);
    const indice = todasLasOrdenes.findIndex((o) => o.id === pregunta.id);
    const vecino = direccion === "arriba" ? indice - 1 : indice + 1;
    if (vecino < 0 || vecino >= todasLasOrdenes.length) return;

    const ordenes = todasLasOrdenes.map((o) => ({ ...o }));
    const ordenPropio = ordenes[indice]!.orden;
    ordenes[indice]!.orden = ordenes[vecino]!.orden;
    ordenes[vecino]!.orden = ordenPropio;

    setCargando(true);
    // try/catch/finally (deuda de revision del PR 8, hallazgo Medio) --
    // mismo motivo que guardar() arriba.
    try {
      const respuesta = await fetch(`/api/plataforma/rf20/versiones/${versionId}/reordenar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordenes }),
      });
      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok || !resultado?.ok) {
        setError(resultado?.motivo ?? resultado?.error ?? `No se pudo reordenar (HTTP ${respuesta.status}).`);
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
    <div className="flex flex-col gap-2 border-b border-slate-200 py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {pregunta.orden}. [{pregunta.codigo}] {pregunta.texto}
          </p>
          <p className="text-xs text-slate-500">
            {pregunta.dimension}
            {pregunta.esNoPuntuable && " · no puntuable"}
          </p>
        </div>
        {editable && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              disabled={esPrimera || cargando}
              onClick={() => mover("arriba")}
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={esUltima || cargando}
              onClick={() => mover("abajo")}
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => setEditando((v) => !v)}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              {editando ? "Cancelar" : "Editar"}
            </button>
            <button
              type="button"
              disabled={cargando}
              onClick={eliminar}
              className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
            >
              Eliminar
            </button>
          </div>
        )}
      </div>
      {editando && (
        <div className="rounded border border-slate-200 bg-slate-50 p-3">
          <CamposPregunta codigoEditable={false} valores={valores} onChange={setValores} />
          <button
            type="button"
            onClick={guardar}
            disabled={cargando}
            className="mt-2 w-fit rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {cargando ? "Guardando..." : "Guardar pregunta"}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function AgregarPreguntaForm({ versionId, siguienteOrden }: { versionId: string; siguienteOrden: number }) {
  const router = useRouter();
  const [valores, setValores] = useState({
    codigo: "",
    texto: "",
    dimension: DIMENSIONES[0] as string,
    opcionesTexto: "[]",
    esNoPuntuable: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function agregar() {
    setError(null);
    let opciones: unknown;
    try {
      opciones = JSON.parse(valores.opcionesTexto);
    } catch {
      setError("El campo opciones no es JSON válido.");
      return;
    }
    setCargando(true);
    // try/catch/finally (deuda de revision del PR 8, hallazgo Medio) --
    // mismo motivo que guardar() arriba.
    try {
      const respuesta = await fetch(`/api/plataforma/rf20/versiones/${versionId}/preguntas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo: valores.codigo,
          orden: siguienteOrden,
          texto: valores.texto,
          dimension: valores.dimension,
          opciones,
          esNoPuntuable: valores.esNoPuntuable,
        }),
      });
      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok || !resultado?.ok) {
        setError(resultado?.motivo ?? resultado?.error ?? `No se pudo agregar (HTTP ${respuesta.status}).`);
        return;
      }
      setValores({ codigo: "", texto: "", dimension: DIMENSIONES[0], opcionesTexto: "[]", esNoPuntuable: false });
      router.refresh();
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="rounded border border-dashed border-slate-300 p-3">
      <p className="mb-2 text-sm font-medium text-slate-700">
        Agregar pregunta (orden {siguienteOrden})
      </p>
      <CamposPregunta codigoEditable valores={valores} onChange={setValores} />
      <button
        type="button"
        onClick={agregar}
        disabled={cargando || valores.codigo.trim().length === 0 || valores.texto.trim().length === 0}
        className="mt-2 w-fit rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {cargando ? "Agregando..." : "Agregar pregunta"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function PreguntasEditor({
  versionId,
  preguntas,
  editable,
}: {
  versionId: string;
  preguntas: PreguntaEditable[];
  editable: boolean;
}) {
  const ordenadas = [...preguntas].sort((a, b) => a.orden - b.orden);
  const todasLasOrdenes = ordenadas.map((p) => ({ id: p.id, orden: p.orden }));
  const siguienteOrden = ordenadas.length === 0 ? 1 : Math.max(...ordenadas.map((p) => p.orden)) + 1;

  return (
    <div className="flex flex-col gap-4">
      {ordenadas.length === 0 && <p className="text-sm text-slate-500">Esta versión no tiene preguntas.</p>}
      <div className="rounded border border-slate-200 px-4">
        {ordenadas.map((p, i) => (
          <FilaPregunta
            key={p.id}
            versionId={versionId}
            pregunta={p}
            editable={editable}
            esPrimera={i === 0}
            esUltima={i === ordenadas.length - 1}
            todasLasOrdenes={todasLasOrdenes}
          />
        ))}
      </div>
      {editable && <AgregarPreguntaForm versionId={versionId} siguienteOrden={siguienteOrden} />}
      {!editable && (
        <p className="text-xs text-slate-400">
          Solo se pueden agregar, editar, eliminar o reordenar preguntas en una versión BORRADOR.
        </p>
      )}
    </div>
  );
}
