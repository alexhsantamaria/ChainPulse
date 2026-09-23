// Componente — mapa visual de una Cadena con React Flow (RF34). Nodos y
// conexiones se crean directamente sobre este canvas: un boton "+ Nodo"
// abre un panel chico encima del mapa (nunca una pantalla/ruta separada,
// ver el comentario de cabecera de NuevaCadenaForm.tsx sobre por que
// RF34 excluye eso), y arrastrar de un nodo a otro dispara `onConnect`
// de React Flow, que abre un segundo panel chico para elegir los flujos
// de esa conexion antes de guardarla. Las posiciones no se persisten
// todavia -- el schema no tiene columnas de posicion en Nodo
// (PLAN-DE-TRABAJO.md, Bloque A no las incluyo) -- se recalcula un
// layout simple en grilla en cada carga/alta; una vez que exista arrastre
// de nodos con memoria hace falta agregar esa columna para persistir la
// posicion elegida.
"use client";

import { useCallback, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MarkerType, type Node, type Edge, type Connection } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { fetchJsonSeguro } from "@/infra/http/fetchJsonSeguro";
import type { RespuestaApiBase } from "@/infra/http/fetchJsonSeguro";

type TipoNodo = "ORGANIZACION" | "AREA" | "INSTALACION" | "PROCESO" | "PERSONA_DECISORA" | "SISTEMA";
type TipoFlujoV2 = "PRODUCTO_SERVICIO" | "INFORMACION" | "DINERO" | "DECISION" | "DEVOLUCION";

interface NodoProp {
  id: string;
  nombre: string;
  tipo: TipoNodo;
}

interface ConexionProp {
  id: string;
  origenNodoId: string;
  destinoNodoId: string;
  flujos: { tipo: TipoFlujoV2 }[];
}

interface RespuestaNodoApi extends RespuestaApiBase {
  nodo?: { id: string; nombre: string; tipo: TipoNodo };
}

interface RespuestaConexionApi extends RespuestaApiBase {
  conexionCadenaId?: string;
}

// Colores por tipo de nodo -- distinguir visualmente organizacion/area/
// instalacion/proceso/persona decisora/sistema (RF28/MVP-DEFINITIVO §9.1),
// con Tailwind a mano (no hay ninguna libreria de componentes UI instalada
// en el proyecto, ver PLAN-DE-TRABAJO.md Seccion 14).
const ESTILO_TIPO: Record<TipoNodo, { fondo: string; borde: string; etiqueta: string }> = {
  ORGANIZACION: { fondo: "#eff6ff", borde: "#3b82f6", etiqueta: "Organización" },
  AREA: { fondo: "#f0fdf4", borde: "#22c55e", etiqueta: "Área" },
  INSTALACION: { fondo: "#fefce8", borde: "#eab308", etiqueta: "Instalación" },
  PROCESO: { fondo: "#faf5ff", borde: "#a855f7", etiqueta: "Proceso" },
  PERSONA_DECISORA: { fondo: "#fff7ed", borde: "#f97316", etiqueta: "Persona decisora" },
  SISTEMA: { fondo: "#f1f5f9", borde: "#64748b", etiqueta: "Sistema" },
};

const TIPOS_NODO: TipoNodo[] = ["ORGANIZACION", "AREA", "INSTALACION", "PROCESO", "PERSONA_DECISORA", "SISTEMA"];

const ETIQUETA_FLUJO: Record<TipoFlujoV2, string> = {
  PRODUCTO_SERVICIO: "Producto/servicio",
  INFORMACION: "Información",
  DINERO: "Dinero",
  DECISION: "Decisión",
  DEVOLUCION: "Devolución",
};

const TIPOS_FLUJO: TipoFlujoV2[] = ["PRODUCTO_SERVICIO", "INFORMACION", "DINERO", "DECISION", "DEVOLUCION"];

const COLUMNAS = 4;
const ANCHO_COLUMNA = 220;
const ALTO_FILA = 130;

function construirNodos(nodos: NodoProp[]): Node[] {
  return nodos.map((nodo, indice) => {
    const estilo = ESTILO_TIPO[nodo.tipo];
    return {
      id: nodo.id,
      position: { x: (indice % COLUMNAS) * ANCHO_COLUMNA, y: Math.floor(indice / COLUMNAS) * ALTO_FILA },
      data: { label: `${nodo.nombre}\n${estilo.etiqueta}` },
      style: {
        background: estilo.fondo,
        border: `2px solid ${estilo.borde}`,
        borderRadius: 8,
        padding: 8,
        fontSize: 12,
        whiteSpace: "pre-line" as const,
        width: 180,
      },
    };
  });
}

function construirAristas(conexiones: ConexionProp[]): Edge[] {
  return conexiones.map((conexion) => ({
    id: conexion.id,
    source: conexion.origenNodoId,
    target: conexion.destinoNodoId,
    label: conexion.flujos.map((f) => ETIQUETA_FLUJO[f.tipo]).join(", "),
    labelStyle: { fontSize: 10 },
    animated: false,
    // Punto D del documento de revision -- sin flecha no se distingue
    // origen de destino a simple vista, sobre todo con el layout en
    // grilla (no siempre queda claro que fila "sigue" a cual).
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    style: { strokeWidth: 1.5 },
  }));
}

export default function MapaCadenaCanvas({
  cadenaId,
  nodosIniciales,
  conexionesIniciales,
}: {
  cadenaId: string;
  nodosIniciales: NodoProp[];
  conexionesIniciales: ConexionProp[];
}) {
  const [nodos, setNodos] = useState<NodoProp[]>(nodosIniciales);
  const [conexiones, setConexiones] = useState<ConexionProp[]>(conexionesIniciales);

  const nodosFlow = useMemo(() => construirNodos(nodos), [nodos]);
  const aristasFlow = useMemo(() => construirAristas(conexiones), [conexiones]);

  // Panel "+ Nodo".
  const [panelNodoAbierto, setPanelNodoAbierto] = useState(false);
  const [nombreNodo, setNombreNodo] = useState("");
  const [tipoNodo, setTipoNodo] = useState<TipoNodo | "">("");
  const [cargandoNodo, setCargandoNodo] = useState(false);
  const [errorNodo, setErrorNodo] = useState<string | null>(null);

  async function crearNodo() {
    if (!tipoNodo) return;
    setErrorNodo(null);
    setCargandoNodo(true);
    const resultado = await fetchJsonSeguro<RespuestaNodoApi>(`/api/cadenas/${cadenaId}/nodos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: nombreNodo, tipo: tipoNodo }),
    });
    setCargandoNodo(false);

    if (!resultado.ok || !resultado.nodo) {
      setErrorNodo(
        resultado.error === "ERROR_RED"
          ? "No se pudo conectar. Revisá tu conexión e intentá de nuevo."
          : "No se pudo crear el nodo. Revisá el nombre e intentá de nuevo.",
      );
      return;
    }

    setNodos((previos) => [...previos, resultado.nodo!]);
    setNombreNodo("");
    setTipoNodo("");
    setPanelNodoAbierto(false);
  }

  // Panel de flujos -- se abre cuando el usuario arrastra de un nodo a
  // otro (onConnect de React Flow), antes de guardar nada.
  const [pendiente, setPendiente] = useState<{ origenNodoId: string; destinoNodoId: string } | null>(null);
  const [flujosElegidos, setFlujosElegidos] = useState<TipoFlujoV2[]>([]);
  const [cargandoConexion, setCargandoConexion] = useState(false);
  const [errorConexion, setErrorConexion] = useState<string | null>(null);

  const onConnect = useCallback(
    (conexion: Connection) => {
      if (!conexion.source || !conexion.target || conexion.source === conexion.target) return;
      setErrorConexion(null);
      setFlujosElegidos([]);
      setPendiente({ origenNodoId: conexion.source, destinoNodoId: conexion.target });
    },
    [],
  );

  function alternarFlujo(tipo: TipoFlujoV2) {
    setFlujosElegidos((previos) =>
      previos.includes(tipo) ? previos.filter((t) => t !== tipo) : [...previos, tipo],
    );
  }

  async function confirmarConexion() {
    if (!pendiente || flujosElegidos.length === 0) return;
    setErrorConexion(null);
    setCargandoConexion(true);
    const resultado = await fetchJsonSeguro<RespuestaConexionApi>(`/api/cadenas/${cadenaId}/conexiones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origenNodoId: pendiente.origenNodoId,
        destinoNodoId: pendiente.destinoNodoId,
        flujos: flujosElegidos,
      }),
    });
    setCargandoConexion(false);

    if (!resultado.ok || !resultado.conexionCadenaId) {
      setErrorConexion(
        resultado.error === "CONEXION_CADENA_DUPLICADA"
          ? "Ya existe una conexión entre estos dos nodos."
          : resultado.error === "ERROR_RED"
            ? "No se pudo conectar. Revisá tu conexión e intentá de nuevo."
            : "No se pudo guardar la conexión. Intentá de nuevo.",
      );
      return;
    }

    setConexiones((previas) => [
      ...previas,
      {
        id: resultado.conexionCadenaId!,
        origenNodoId: pendiente.origenNodoId,
        destinoNodoId: pendiente.destinoNodoId,
        flujos: flujosElegidos.map((tipo) => ({ tipo })),
      },
    ]);
    setPendiente(null);
    setFlujosElegidos([]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Agregá un nodo con el botón, o arrastrá desde el borde de un nodo hasta otro para
          declarar una conexión.
        </p>
        <button
          type="button"
          onClick={() => {
            setErrorNodo(null);
            setPanelNodoAbierto((abierto) => !abierto);
          }}
          className="shrink-0 rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
        >
          + Nodo
        </button>
      </div>

      {panelNodoAbierto && (
        <div className="flex flex-col gap-2 rounded border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              placeholder="Nombre del nodo"
              required
              minLength={2}
              maxLength={160}
              value={nombreNodo}
              onChange={(e) => setNombreNodo(e.target.value)}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={tipoNodo}
              onChange={(e) => setTipoNodo(e.target.value as TipoNodo)}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Tipo...
              </option>
              {TIPOS_NODO.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {ESTILO_TIPO[tipo].etiqueta}
                </option>
              ))}
            </select>
          </div>
          {errorNodo && <p className="text-sm text-red-600">{errorNodo}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={cargandoNodo || nombreNodo.trim().length < 2 || !tipoNodo}
              onClick={crearNodo}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {cargandoNodo ? "Guardando..." : "Agregar nodo"}
            </button>
            <button
              type="button"
              onClick={() => setPanelNodoAbierto(false)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="h-[480px] w-full rounded border border-slate-200">
        <ReactFlow
          nodes={nodosFlow}
          edges={aristasFlow}
          onConnect={onConnect}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      {pendiente && (
        <div className="flex flex-col gap-2 rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-medium">¿Qué fluye por esta conexión? (elegí uno o más)</p>
          <div className="flex flex-wrap gap-3">
            {TIPOS_FLUJO.map((tipo) => (
              <label key={tipo} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={flujosElegidos.includes(tipo)}
                  onChange={() => alternarFlujo(tipo)}
                />
                {ETIQUETA_FLUJO[tipo]}
              </label>
            ))}
          </div>
          {errorConexion && <p className="text-sm text-red-600">{errorConexion}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={cargandoConexion || flujosElegidos.length === 0}
              onClick={confirmarConexion}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {cargandoConexion ? "Guardando..." : "Conectar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendiente(null);
                setFlujosElegidos([]);
              }}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
