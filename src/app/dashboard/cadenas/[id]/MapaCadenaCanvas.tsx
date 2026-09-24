// Componente — mapa visual de una Cadena con React Flow (RF34). Nodos y
// conexiones se crean directamente sobre este canvas: un boton "+ Nodo"
// abre un panel chico encima del mapa (nunca una pantalla/ruta separada,
// ver el comentario de cabecera de NuevaCadenaForm.tsx sobre por que
// RF34 excluye eso), y arrastrar de un nodo a otro dispara `onConnect`
// de React Flow, que abre un segundo panel chico para elegir los flujos
// de esa conexion antes de guardarla. La posicion de cada nodo se
// persiste al soltar el arrastre (`onNodeDragStop` -> PATCH
// /api/cadenas/:id/nodos/:nodoId, migracion
// 20260923050000_nodo_posicion_canvas) -- un nodo que todavia no se
// arrastro nunca (posX/posY null, todo nodo previo a esta migracion y
// cualquier nodo recien creado) cae a un layout en grilla recalculado en
// el cliente, mismo criterio que antes.
//
// Puntos de conexion en los 4 lados (NodoCadenaVisual, tipo de nodo
// "nodoCadena"): el nodo "default" de React Flow solo trae un punto
// arriba (target) y uno abajo (source), lo que fuerza un flujo
// puramente vertical -- Alex probo el mapa (2026-09-23) y encontro que
// eso no alcanza para cadenas que se arman mejor de lado a lado. Se
// agregan 4 Handle (arriba/abajo/izquierda/derecha), todos "source", con
// `connectionMode="loose"` en el ReactFlow padre para que cualquier
// punto pueda iniciar o recibir una conexion sin importar el tipo
// declarado -- el usuario arrastra desde el punto que le quede mas
// comodo segun como acomodo los nodos, nunca solo desde abajo.
//
// Por que la linea igual se dibujaba siempre arriba (2026-09-23, segundo
// reporte de Alex despues de subir connectionRadius a 40): el arrastre
// funcionaba, pero `construirAristas()` no guardaba por cual de los 4
// Handle se habia conectado cada extremo -- un Edge de React Flow sin
// `sourceHandle`/`targetHandle` explicitos usa "el primer handle
// declarado" del nodo (confirmado leyendo `getHandle$1()` en
// @xyflow/system), que en NodoCadenaVisual es "top" porque se declara
// primero. La conexion en si quedaba bien guardada (origen/destino
// correctos), solo el lado visual estaba mal. Fix real: se captura
// `sourceHandle`/`targetHandle` de `onConnect` y se persisten en
// ConexionCadena (`origenHandleId`/`destinoHandleId`, migracion
// 20260923070000_conexion_cadena_handle_lados, nullable -- conexiones
// creadas antes de este fix quedan en null y caen al viejo
// comportamiento hasta que se recreen).
//
// Borrar/editar una conexion existente: Alex probo conectar nodos y
// pregunto como se borra o cambia una conexion ya creada, porque no habia
// ninguna forma de alterar una linea ya guardada (2026-09-23). Un click
// sobre una arista (`onEdgeClick`) abre el mismo panel de checkboxes que
// se usa al crear una conexion nueva, precargado con los flujos actuales
// -- "Guardar cambios" hace PATCH, "Eliminar conexion" (o la tecla Supr/
// Backspace mientras el panel esta abierto) pide confirmacion con
// `window.confirm` y hace DELETE. Se eligio un listener de teclado propio
// en vez de la maquinaria nativa de seleccion de React Flow
// (`onEdgesChange`/`edge.selected`) para no tener que sincronizar ese
// estado contra `aristasFlow` (recalculado en cada render via useMemo) --
// mas simple: la tecla actua sobre `conexionEditando`, que ya es la unica
// fuente de verdad de "que conexion esta con el panel abierto".
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Handle,
  Position,
  ConnectionMode,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { fetchJsonSeguro } from "@/infra/http/fetchJsonSeguro";
import type { RespuestaApiBase } from "@/infra/http/fetchJsonSeguro";

type TipoNodo = "ORGANIZACION" | "AREA" | "INSTALACION" | "PROCESO" | "PERSONA_DECISORA" | "SISTEMA";
type TipoFlujoV2 = "PRODUCTO_SERVICIO" | "INFORMACION" | "DINERO" | "DECISION" | "DEVOLUCION";

// RF30-33 -- mismos valores que los enums DuracionCategorica/NivelImpacto/
// EstadoEvidencia (prisma/schema.prisma), repetidos como union de strings,
// mismo criterio que TipoFlujoV2 de arriba (ADR-0003).
type DuracionCategoricaV2 = "CORTO" | "MEDIO" | "LARGO";
type NivelImpactoV2 = "BAJO" | "MEDIO" | "ALTO" | "CRITICO";
type EstadoEvidenciaV2Valor = "DECLARADO" | "CONFIRMADO_POR_OTROS" | "VERIFICADO_CON_DATOS";

interface NodoProp {
  id: string;
  nombre: string;
  tipo: TipoNodo;
  posX: number | null;
  posY: number | null;
}

interface ConexionProp {
  id: string;
  origenNodoId: string;
  destinoNodoId: string;
  flujos: { tipo: TipoFlujoV2 }[];
  // "top"/"right"/"bottom"/"left" -- ver el comentario de cabecera sobre
  // por que esto hace falta (React Flow, sin esto, dibuja siempre arriba).
  origenHandleId: string | null;
  destinoHandleId: string | null;
  // RF30-33 -- datos de la conexion del mapa, existian en el schema desde
  // el Bloque A pero nunca se exponian en ningun formulario hasta ahora.
  requerimientoCantidad: boolean;
  requerimientoFecha: boolean;
  requerimientoEspecificacion: boolean;
  requerimientoAprobacion: boolean;
  requerimientoPago: boolean;
  coincidePrioridad: boolean | null;
  coincideCantidad: boolean | null;
  coincideFecha: boolean | null;
  oportunidadInformacion: DuracionCategoricaV2 | null;
  responsableDecision: string | null;
  impactoFalla: NivelImpactoV2 | null;
  tieneAlternativa: boolean | null;
  alternativaProbada: boolean | null;
  tiempoTolerable: DuracionCategoricaV2 | null;
  tiempoRecuperacion: DuracionCategoricaV2 | null;
  estadoEvidencia: EstadoEvidenciaV2Valor;
  // RF35 -- string ISO (no Date): pasar un Date de Server a Client
  // Component no es un tipo serializable garantizado por React Flight,
  // asi que page.tsx ya lo convierte antes de pasarlo como prop.
  updatedAt: string;
}

interface RespuestaNodoApi extends RespuestaApiBase {
  nodo?: { id: string; nombre: string; tipo: TipoNodo; posX: number | null; posY: number | null };
}

interface RespuestaConexionApi extends RespuestaApiBase {
  conexionCadenaId?: string;
}

// RF30-33 -- mismas etiquetas ya usadas para los 5 campos equivalentes de
// Conexion v1 (ConexionForm.tsx) y para EstadoEvidenciaV2 en el
// cuestionario publico (src/lib/evaluacionExpres/etiquetas.ts), para no
// inventar un segundo vocabulario para el mismo concepto.
const ETIQUETA_DURACION: Record<DuracionCategoricaV2, string> = {
  CORTO: "Corto (menos de 24 horas)",
  MEDIO: "Medio (entre 24 horas y 1 semana)",
  LARGO: "Largo (más de 1 semana)",
};
const DURACIONES: DuracionCategoricaV2[] = ["CORTO", "MEDIO", "LARGO"];

const ETIQUETA_IMPACTO: Record<NivelImpactoV2, string> = {
  BAJO: "Bajo",
  MEDIO: "Medio",
  ALTO: "Alto",
  CRITICO: "Crítico",
};
const NIVELES_IMPACTO: NivelImpactoV2[] = ["BAJO", "MEDIO", "ALTO", "CRITICO"];

const ETIQUETA_ESTADO_EVIDENCIA: Record<EstadoEvidenciaV2Valor, string> = {
  DECLARADO: "Declarado",
  CONFIRMADO_POR_OTROS: "Confirmado por otros",
  VERIFICADO_CON_DATOS: "Verificado con datos",
};
const ESTADOS_EVIDENCIA: EstadoEvidenciaV2Valor[] = ["DECLARADO", "CONFIRMADO_POR_OTROS", "VERIFICADO_CON_DATOS"];

// Estado del formulario de RF30-33 -- mismo criterio que DatosCriticidad
// de ConexionForm.tsx (v1): selects/booleans nulos representados como ""
// en el form, convertidos a boolean | null recien al armar el payload.
interface DatosConexionForm {
  requerimientoCantidad: boolean;
  requerimientoFecha: boolean;
  requerimientoEspecificacion: boolean;
  requerimientoAprobacion: boolean;
  requerimientoPago: boolean;
  coincidePrioridad: string;
  coincideCantidad: string;
  coincideFecha: string;
  oportunidadInformacion: DuracionCategoricaV2 | "";
  responsableDecision: string;
  impactoFalla: NivelImpactoV2 | "";
  tieneAlternativa: string;
  alternativaProbada: string;
  tiempoTolerable: DuracionCategoricaV2 | "";
  tiempoRecuperacion: DuracionCategoricaV2 | "";
  estadoEvidencia: EstadoEvidenciaV2Valor;
}

const DATOS_CONEXION_VACIOS: DatosConexionForm = {
  requerimientoCantidad: false,
  requerimientoFecha: false,
  requerimientoEspecificacion: false,
  requerimientoAprobacion: false,
  requerimientoPago: false,
  coincidePrioridad: "",
  coincideCantidad: "",
  coincideFecha: "",
  oportunidadInformacion: "",
  responsableDecision: "",
  impactoFalla: "",
  tieneAlternativa: "",
  alternativaProbada: "",
  tiempoTolerable: "",
  tiempoRecuperacion: "",
  estadoEvidencia: "DECLARADO",
};

function boolAString(valor: boolean | null): string {
  return valor === true ? "si" : valor === false ? "no" : "";
}

function stringABool(valor: string): boolean | null {
  return valor === "" ? null : valor === "si";
}

function datosFormDesdeConexion(conexion: ConexionProp): DatosConexionForm {
  return {
    requerimientoCantidad: conexion.requerimientoCantidad,
    requerimientoFecha: conexion.requerimientoFecha,
    requerimientoEspecificacion: conexion.requerimientoEspecificacion,
    requerimientoAprobacion: conexion.requerimientoAprobacion,
    requerimientoPago: conexion.requerimientoPago,
    coincidePrioridad: boolAString(conexion.coincidePrioridad),
    coincideCantidad: boolAString(conexion.coincideCantidad),
    coincideFecha: boolAString(conexion.coincideFecha),
    oportunidadInformacion: conexion.oportunidadInformacion ?? "",
    responsableDecision: conexion.responsableDecision ?? "",
    impactoFalla: conexion.impactoFalla ?? "",
    tieneAlternativa: boolAString(conexion.tieneAlternativa),
    alternativaProbada: boolAString(conexion.alternativaProbada),
    tiempoTolerable: conexion.tiempoTolerable ?? "",
    tiempoRecuperacion: conexion.tiempoRecuperacion ?? "",
    estadoEvidencia: conexion.estadoEvidencia,
  };
}

// Forma -> payload del PATCH (campo "datos", ver actualizarFlujosConexionCadena.ts).
function datosFormAPayload(form: DatosConexionForm) {
  return {
    requerimientoCantidad: form.requerimientoCantidad,
    requerimientoFecha: form.requerimientoFecha,
    requerimientoEspecificacion: form.requerimientoEspecificacion,
    requerimientoAprobacion: form.requerimientoAprobacion,
    requerimientoPago: form.requerimientoPago,
    coincidePrioridad: stringABool(form.coincidePrioridad),
    coincideCantidad: stringABool(form.coincideCantidad),
    coincideFecha: stringABool(form.coincideFecha),
    oportunidadInformacion: form.oportunidadInformacion || null,
    responsableDecision: form.responsableDecision.trim() || null,
    impactoFalla: form.impactoFalla || null,
    tieneAlternativa: stringABool(form.tieneAlternativa),
    alternativaProbada: stringABool(form.alternativaProbada),
    tiempoTolerable: form.tiempoTolerable || null,
    tiempoRecuperacion: form.tiempoRecuperacion || null,
    estadoEvidencia: form.estadoEvidencia,
  };
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

// Nodo con un punto de conexion en cada lado (ver comentario de cabecera).
// Declarado fuera del componente -- un objeto nuevo en cada render de
// MapaCadenaCanvas dispara el warning de React Flow de "nodeTypes changed"
// y fuerza un remount innecesario de todos los nodos.
function NodoCadenaVisual({ data }: NodeProps) {
  return (
    <>
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />
      {/* El nodo "default" de React Flow centra el texto solo -- al pasar a
          un tipo de nodo custom hay que declararlo a mano. El padding
          horizontal ademas separa el texto de los puntos de conexion
          izquierdo/derecho: sin el, el texto queda pegado justo donde
          viven esos dos puntos y termina "robandose" el click en vez de
          arrastrar la conexion (bug real que reporto Alex, 2026-09-23). */}
      <div style={{ textAlign: "center", padding: "0 8px" }}>{String(data.label ?? "")}</div>
    </>
  );
}

const TIPOS_NODO_REACT_FLOW = { nodoCadena: NodoCadenaVisual };

function construirNodos(nodos: NodoProp[], nodoSeleccionadoId: string | null): Node[] {
  return nodos.map((nodo, indice) => {
    const estilo = ESTILO_TIPO[nodo.tipo];
    // Posicion elegida por el usuario si ya arrastro este nodo alguna
    // vez; si no, layout en grilla recalculado (comportamiento previo).
    const posicion =
      nodo.posX !== null && nodo.posY !== null
        ? { x: nodo.posX, y: nodo.posY }
        : { x: (indice % COLUMNAS) * ANCHO_COLUMNA, y: Math.floor(indice / COLUMNAS) * ALTO_FILA };
    // Resaltado de seleccion (Alex, 2026-09-24: "cuando senalamos o
    // seleccionamos un proceso o conexion seria bueno que se resalte") --
    // React Flow trae seleccion nativa via onNodesChange/`node.selected`,
    // pero este canvas ya es "controlado" desde el estado propio `nodos`
    // sin onNodesChange conectado (mismo criterio que el comentario de
    // cabecera sobre `conexionEditando` en vez de `edge.selected`: mas
    // simple resaltar a mano que sincronizar contra el estado interno de
    // seleccion de la libreria).
    const seleccionado = nodo.id === nodoSeleccionadoId;
    return {
      id: nodo.id,
      type: "nodoCadena",
      position: posicion,
      data: { label: `${nodo.nombre}\n${estilo.etiqueta}` },
      style: {
        background: estilo.fondo,
        border: `2px solid ${estilo.borde}`,
        borderRadius: 8,
        padding: 8,
        fontSize: 12,
        whiteSpace: "pre-line" as const,
        width: 180,
        boxShadow: seleccionado ? `0 0 0 3px ${estilo.borde}66` : "none",
      },
    };
  });
}

function construirAristas(conexiones: ConexionProp[], conexionSeleccionadaId: string | null): Edge[] {
  return conexiones.map((conexion) => {
    // Mismo resaltado que construirNodos() -- a mano, sin depender de
    // `edge.selected` de React Flow (ver el comentario de cabecera del
    // archivo sobre por que ya se evita sincronizar contra el estado
    // interno de seleccion de la libreria).
    const seleccionada = conexion.id === conexionSeleccionadaId;
    const colorResaltado = "#2563eb";
    return {
      id: conexion.id,
      source: conexion.origenNodoId,
      target: conexion.destinoNodoId,
      // undefined (no null) para conexiones viejas sin esto guardado -- ver
      // el comentario de cabecera del archivo.
      sourceHandle: conexion.origenHandleId ?? undefined,
      targetHandle: conexion.destinoHandleId ?? undefined,
      label: conexion.flujos.map((f) => ETIQUETA_FLUJO[f.tipo]).join(", "),
      labelStyle: { fontSize: 10, fontWeight: seleccionada ? 700 : 400 },
      animated: false,
      // Punto D del documento de revision -- sin flecha no se distingue
      // origen de destino a simple vista, sobre todo con el layout en
      // grilla (no siempre queda claro que fila "sigue" a cual).
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: seleccionada ? colorResaltado : undefined,
      },
      style: { strokeWidth: seleccionada ? 3 : 1.5, stroke: seleccionada ? colorResaltado : undefined },
    };
  });
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

  // Id del nodo resaltado por click (ver el comentario de construirNodos()
  // sobre por que esto se maneja a mano en vez de con `node.selected` de
  // React Flow). Nulo = ningun nodo resaltado.
  const [nodoSeleccionadoId, setNodoSeleccionadoId] = useState<string | null>(null);

  const nodosFlow = useMemo(() => construirNodos(nodos, nodoSeleccionadoId), [nodos, nodoSeleccionadoId]);

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
  // otro (onConnect de React Flow), antes de guardar nada. Guarda tambien
  // por cual Handle de cada nodo se arrastro (sourceHandle/targetHandle
  // de React Flow) -- sin esto el mapa vuelve a dibujar todo arriba, ver
  // el comentario de cabecera del archivo.
  const [pendiente, setPendiente] = useState<{
    origenNodoId: string;
    destinoNodoId: string;
    origenHandleId: string | null;
    destinoHandleId: string | null;
  } | null>(null);
  const [flujosElegidos, setFlujosElegidos] = useState<TipoFlujoV2[]>([]);
  const [cargandoConexion, setCargandoConexion] = useState(false);
  const [errorConexion, setErrorConexion] = useState<string | null>(null);

  const onConnect = useCallback(
    (conexion: Connection) => {
      if (!conexion.source || !conexion.target || conexion.source === conexion.target) return;
      setErrorConexion(null);
      setFlujosElegidos([]);
      setPendiente({
        origenNodoId: conexion.source,
        destinoNodoId: conexion.target,
        origenHandleId: conexion.sourceHandle ?? null,
        destinoHandleId: conexion.targetHandle ?? null,
      });
    },
    [],
  );

  // Persiste la posicion al soltar el arrastre -- no en cada frame
  // intermedio (onNodesChange dispararia una escritura por pixel). Falla
  // silenciosa aceptada a proposito: si el PATCH no llega, el nodo vuelve
  // al layout en grilla en la proxima carga (misma degradacion, sin
  // bloquear al usuario con un error por soltar un nodo).
  const onNodeDragStop = useCallback((_evento: unknown, nodoArrastrado: Node) => {
    const { x, y } = nodoArrastrado.position;
    setNodos((previos) =>
      previos.map((nodo) => (nodo.id === nodoArrastrado.id ? { ...nodo, posX: x, posY: y } : nodo)),
    );
    void fetchJsonSeguro(`/api/cadenas/${cadenaId}/nodos/${nodoArrastrado.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posX: x, posY: y }),
    });
  }, [cadenaId]);

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
        origenHandleId: pendiente.origenHandleId,
        destinoHandleId: pendiente.destinoHandleId,
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
        origenHandleId: pendiente.origenHandleId,
        destinoHandleId: pendiente.destinoHandleId,
        // RF30-33/RF35 -- una conexion recien creada todavia no tiene
        // ningun dato declarado, mismos valores por defecto que el schema.
        requerimientoCantidad: false,
        requerimientoFecha: false,
        requerimientoEspecificacion: false,
        requerimientoAprobacion: false,
        requerimientoPago: false,
        coincidePrioridad: null,
        coincideCantidad: null,
        coincideFecha: null,
        oportunidadInformacion: null,
        responsableDecision: null,
        impactoFalla: null,
        tieneAlternativa: null,
        alternativaProbada: null,
        tiempoTolerable: null,
        tiempoRecuperacion: null,
        estadoEvidencia: "DECLARADO",
        updatedAt: new Date().toISOString(),
      },
    ]);
    setPendiente(null);
    setFlujosElegidos([]);
  }

  // Edicion/borrado de una conexion existente -- se abre al hacer click
  // sobre una arista ya guardada (onEdgeClick de React Flow), distinto de
  // `pendiente` (conexion nueva, se abre al arrastrar). Mismo panel de
  // checkboxes que crear, precargado con los flujos actuales de la
  // conexion clickeada.
  const [conexionEditando, setConexionEditando] = useState<ConexionProp | null>(null);
  const [flujosEdicion, setFlujosEdicion] = useState<TipoFlujoV2[]>([]);
  // RF30-33 -- estado del formulario de datos de la conexion, precargado
  // en onEdgeClick y reseteado junto con flujosEdicion en cada lugar que
  // cierra el panel (mismo ciclo de vida que flujosEdicion).
  const [datosEdicion, setDatosEdicion] = useState<DatosConexionForm>(DATOS_CONEXION_VACIOS);
  const [cargandoEdicion, setCargandoEdicion] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);

  // Resaltado de la conexion con el panel de edicion abierto -- mismo
  // criterio que nodoSeleccionadoId mas arriba. Va aca (no junto a
  // nodosFlow) porque depende de conexionEditando, declarado recien acá.
  const aristasFlow = useMemo(
    () => construirAristas(conexiones, conexionEditando?.id ?? null),
    [conexiones, conexionEditando],
  );

  const onNodeClick = useCallback((_evento: unknown, nodo: Node) => {
    setNodoSeleccionadoId(nodo.id);
    // Un click sobre un nodo mientras el panel de edicion de una conexion
    // esta abierto lo cierra -- solo una cosa resaltada/editandose a la
    // vez, mismo criterio que onPaneClick de mas abajo.
    setConexionEditando(null);
    setFlujosEdicion([]);
    setDatosEdicion(DATOS_CONEXION_VACIOS);
  }, []);

  const onEdgeClick = useCallback(
    (_evento: unknown, arista: Edge) => {
      const conexion = conexiones.find((c) => c.id === arista.id);
      if (!conexion) return;
      setNodoSeleccionadoId(null);
      setErrorEdicion(null);
      setFlujosEdicion(conexion.flujos.map((f) => f.tipo));
      setDatosEdicion(datosFormDesdeConexion(conexion));
      setConexionEditando(conexion);
    },
    [conexiones],
  );

  // Click en el fondo del canvas (no sobre un nodo/arista) cierra el panel
  // de edicion sin guardar, mismo criterio que "Cancelar", y quita el
  // resaltado de nodo si habia uno.
  const onPaneClick = useCallback(() => {
    setConexionEditando(null);
    setFlujosEdicion([]);
    setDatosEdicion(DATOS_CONEXION_VACIOS);
    setNodoSeleccionadoId(null);
  }, []);

  function alternarFlujoEdicion(tipo: TipoFlujoV2) {
    setFlujosEdicion((previos) =>
      previos.includes(tipo) ? previos.filter((t) => t !== tipo) : [...previos, tipo],
    );
  }

  function campoDatos<K extends keyof DatosConexionForm>(clave: K, valor: DatosConexionForm[K]) {
    setDatosEdicion((previo) => ({ ...previo, [clave]: valor }));
  }

  async function guardarEdicionFlujos() {
    if (!conexionEditando || flujosEdicion.length === 0) return;
    setErrorEdicion(null);
    setCargandoEdicion(true);
    const datosPayload = datosFormAPayload(datosEdicion);
    const resultado = await fetchJsonSeguro(`/api/cadenas/${cadenaId}/conexiones/${conexionEditando.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flujos: flujosEdicion, datos: datosPayload }),
    });
    setCargandoEdicion(false);

    if (!resultado.ok) {
      setErrorEdicion(
        resultado.error === "ERROR_RED"
          ? "No se pudo conectar. Revisá tu conexión e intentá de nuevo."
          : "No se pudo guardar el cambio. Intentá de nuevo.",
      );
      return;
    }

    const conexionId = conexionEditando.id;
    // RF35 -- updatedAt se aproxima en el cliente (en vez de releer del
    // servidor) para que el badge de "foto puntual" muestre la fecha del
    // guardado recien hecho sin recargar la pagina; el servidor fija el
    // valor real con `@updatedAt` practicamente en el mismo instante.
    setConexiones((previas) =>
      previas.map((c) =>
        c.id === conexionId
          ? {
              ...c,
              flujos: flujosEdicion.map((tipo) => ({ tipo })),
              ...datosPayload,
              updatedAt: new Date().toISOString(),
            }
          : c,
      ),
    );
    setConexionEditando(null);
    setFlujosEdicion([]);
    setDatosEdicion(DATOS_CONEXION_VACIOS);
  }

  // Borrado de una conexion -- accion irreversible (RF34 extension, ver
  // comentario de cabecera), siempre pasa por `window.confirm` antes de
  // mandar el DELETE, ya sea desde el boton del panel o desde Supr/
  // Backspace (listener de abajo).
  const eliminarConexion = useCallback(
    async (conexionId: string) => {
      setErrorEdicion(null);
      setCargandoEdicion(true);
      const resultado = await fetchJsonSeguro(`/api/cadenas/${cadenaId}/conexiones/${conexionId}`, {
        method: "DELETE",
      });
      setCargandoEdicion(false);

      if (!resultado.ok) {
        setErrorEdicion("No se pudo borrar la conexión. Intentá de nuevo.");
        return;
      }

      setConexiones((previas) => previas.filter((c) => c.id !== conexionId));
      setConexionEditando(null);
      setFlujosEdicion([]);
      setDatosEdicion(DATOS_CONEXION_VACIOS);
    },
    [cadenaId],
  );

  // useCallback (no una funcion suelta) para que el useEffect de abajo
  // pueda declararla como dependencia real -- exhaustive-deps la marcaba
  // como referencia inestable cuando era una funcion normal.
  const confirmarYEliminarConexion = useCallback(
    (conexionId: string) => {
      if (window.confirm("¿Eliminar esta conexión? Esta acción no se puede deshacer.")) {
        void eliminarConexion(conexionId);
      }
    },
    [eliminarConexion],
  );

  // Invitacion (RF36, Bloque C) -- un mismo panel sirve para invitar a
  // toda la Cadena (boton del toolbar, invitarConexionCadenaId null) o a
  // una ConexionCadena puntual (boton dentro del panel de edicion de
  // abajo, invitarConexionCadenaId = conexionEditando.id). El invitado
  // nunca crea cuenta -- ver el comentario de cabecera de invitacion.ts.
  const [invitarAbierto, setInvitarAbierto] = useState(false);
  const [invitarConexionCadenaId, setInvitarConexionCadenaId] = useState<string | null>(null);
  const [emailInvitar, setEmailInvitar] = useState("");
  const [cargandoInvitar, setCargandoInvitar] = useState(false);
  const [errorInvitar, setErrorInvitar] = useState<string | null>(null);
  const [exitoInvitar, setExitoInvitar] = useState(false);

  function abrirInvitar(conexionCadenaId: string | null) {
    setInvitarConexionCadenaId(conexionCadenaId);
    setEmailInvitar("");
    setErrorInvitar(null);
    setExitoInvitar(false);
    setInvitarAbierto(true);
  }

  async function enviarInvitacion() {
    if (!emailInvitar.trim()) return;
    setErrorInvitar(null);
    setExitoInvitar(false);
    setCargandoInvitar(true);
    const resultado = await fetchJsonSeguro(`/api/cadenas/${cadenaId}/invitar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailInvitar, conexionCadenaId: invitarConexionCadenaId }),
    });
    setCargandoInvitar(false);

    if (!resultado.ok) {
      setErrorInvitar(
        resultado.error === "ERROR_ENVIO_CORREO"
          ? "No se pudo enviar el correo. Revisá la configuración de Resend e intentá de nuevo."
          : resultado.error === "ERROR_RED"
            ? "No se pudo conectar. Revisá tu conexión e intentá de nuevo."
            : "No se pudo enviar la invitación. Revisá el email e intentá de nuevo.",
      );
      return;
    }

    setExitoInvitar(true);
    setEmailInvitar("");
  }

  // Supr/Backspace borra la conexion seleccionada -- solo mientras el
  // panel de edicion esta abierto (conexionEditando != null), para no
  // interceptar esas teclas en ningun otro momento (ej. mientras se
  // escribe en el input de "+ Nodo"). Bug encontrado por Alex
  // (2026-09-24, probando Bloque C Paso 2): el panel "Invitar a esta
  // conexion" se abre DESDE DENTRO del panel de edicion sin limpiar
  // conexionEditando, asi que su input de email queda con este listener
  // activo -- cada Backspace/Supr tipeado ahi disparaba el
  // window.confirm() de "eliminar conexion" en vez de borrar el
  // caracter, obligando a cerrar el panel y escribir el email de nuevo
  // desde cero. Fix: ignorar la tecla si el foco esta en un campo de
  // texto/editable, para que el atajo solo actue cuando el foco esta en
  // el lienzo (o en cualquier otro lugar que no sea un input).
  useEffect(() => {
    if (!conexionEditando) return;
    const conexionId = conexionEditando.id;
    function alPresionarTecla(evento: KeyboardEvent) {
      if (evento.key !== "Delete" && evento.key !== "Backspace") return;
      const objetivo = evento.target;
      const enCampoEditable =
        objetivo instanceof HTMLInputElement ||
        objetivo instanceof HTMLTextAreaElement ||
        objetivo instanceof HTMLSelectElement ||
        (objetivo instanceof HTMLElement && objetivo.isContentEditable);
      if (enCampoEditable) return;
      evento.preventDefault();
      confirmarYEliminarConexion(conexionId);
    }
    window.addEventListener("keydown", alPresionarTecla);
    return () => window.removeEventListener("keydown", alPresionarTecla);
  }, [conexionEditando, confirmarYEliminarConexion]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Agregá un nodo con el botón, o arrastrá desde el borde de un nodo hasta otro para
          declarar una conexión.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => abrirInvitar(null)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            Invitar
          </button>
          <button
            type="button"
            onClick={() => {
              setErrorNodo(null);
              setPanelNodoAbierto((abierto) => !abierto);
            }}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            + Nodo
          </button>
        </div>
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
          nodeTypes={TIPOS_NODO_REACT_FLOW}
          connectionMode={ConnectionMode.Loose}
          // Default de la libreria es 20px -- muy poco para acertarle a
          // un punto de conexion de 12px sin hacer zoom (confirmado
          // leyendo @xyflow/system: la seleccion del handle de destino
          // es puramente por distancia al soltar el mouse, sin ningun
          // sesgo hacia un lado -- Alex solo lograba conectar por arriba
          // porque ahi es donde el mouse quedaba mas cerca del punto).
          connectionRadius={40}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
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

      {conexionEditando && (
        <div className="flex flex-col gap-2 rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-medium">
            Editar conexión -- ¿qué fluye por acá? (elegí uno o más, o eliminá la conexión)
          </p>
          <div className="flex flex-wrap gap-3">
            {TIPOS_FLUJO.map((tipo) => (
              <label key={tipo} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={flujosEdicion.includes(tipo)}
                  onChange={() => alternarFlujoEdicion(tipo)}
                />
                {ETIQUETA_FLUJO[tipo]}
              </label>
            ))}
          </div>

          {/* RF30-33/RF35 -- datos de la conexion, existian en el schema
              desde el Bloque A pero nunca se exponian en ningun
              formulario. Un solo badge de "foto puntual" para toda la
              seccion (no uno por campo): todos estos campos viven en la
              misma fila de ConexionCadena, sin timestamp independiente
              por campo, asi que repetirlo 15 veces seria ruido sin
              agregar informacion -- ver el comentario de cabecera de
              actualizarFlujosConexionCadena.ts. */}
          <div className="flex flex-col gap-3 border-t border-slate-200 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                Foto puntual
              </span>
              <p className="text-xs text-slate-500">
                Una sola declaración en un momento dado, no un monitoreo continuo -- actualizado el{" "}
                {new Date(conexionEditando.updatedAt).toLocaleDateString("es-PE")}.
              </p>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Requerimiento recibido (marcá lo que aplique)</legend>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={datosEdicion.requerimientoCantidad}
                    onChange={(e) => campoDatos("requerimientoCantidad", e.target.checked)}
                  />
                  Cantidad
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={datosEdicion.requerimientoFecha}
                    onChange={(e) => campoDatos("requerimientoFecha", e.target.checked)}
                  />
                  Fecha
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={datosEdicion.requerimientoEspecificacion}
                    onChange={(e) => campoDatos("requerimientoEspecificacion", e.target.checked)}
                  />
                  Especificación
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={datosEdicion.requerimientoAprobacion}
                    onChange={(e) => campoDatos("requerimientoAprobacion", e.target.checked)}
                  />
                  Aprobación
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={datosEdicion.requerimientoPago}
                    onChange={(e) => campoDatos("requerimientoPago", e.target.checked)}
                  />
                  Pago
                </label>
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">¿Lo recibido coincidió con lo pedido?</legend>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  Prioridad
                  <select
                    value={datosEdicion.coincidePrioridad}
                    onChange={(e) => campoDatos("coincidePrioridad", e.target.value)}
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Sin confirmar</option>
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  Cantidad
                  <select
                    value={datosEdicion.coincideCantidad}
                    onChange={(e) => campoDatos("coincideCantidad", e.target.value)}
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Sin confirmar</option>
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  Fecha
                  <select
                    value={datosEdicion.coincideFecha}
                    onChange={(e) => campoDatos("coincideFecha", e.target.value)}
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Sin confirmar</option>
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                </label>
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-medium">Oportunidad y decisión</legend>
              <label className="flex flex-col gap-1 text-sm">
                Oportunidad con la que llega la información
                <select
                  value={datosEdicion.oportunidadInformacion}
                  onChange={(e) => campoDatos("oportunidadInformacion", e.target.value as DuracionCategoricaV2 | "")}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Sin confirmar</option>
                  {DURACIONES.map((valor) => (
                    <option key={valor} value={valor}>
                      {ETIQUETA_DURACION[valor]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Responsable de la decisión (opcional, no hace falta el nombre real)
                <input
                  type="text"
                  maxLength={160}
                  value={datosEdicion.responsableDecision}
                  onChange={(e) => campoDatos("responsableDecision", e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Cargo o alias"
                />
              </label>
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-medium">Impacto y continuidad</legend>
              <label className="flex flex-col gap-1 text-sm">
                Impacto de una falla en esta conexión
                <select
                  value={datosEdicion.impactoFalla}
                  onChange={(e) => campoDatos("impactoFalla", e.target.value as NivelImpactoV2 | "")}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Sin confirmar</option>
                  {NIVELES_IMPACTO.map((valor) => (
                    <option key={valor} value={valor}>
                      {ETIQUETA_IMPACTO[valor]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                ¿Existe una alternativa o sustituto?
                <select
                  value={datosEdicion.tieneAlternativa}
                  onChange={(e) => campoDatos("tieneAlternativa", e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Sin confirmar</option>
                  <option value="si">Sí</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                ¿Esa alternativa fue probada?
                <select
                  value={datosEdicion.alternativaProbada}
                  onChange={(e) => campoDatos("alternativaProbada", e.target.value)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Sin confirmar</option>
                  <option value="si">Sí</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Tiempo tolerable sin esta conexión
                <select
                  value={datosEdicion.tiempoTolerable}
                  onChange={(e) => campoDatos("tiempoTolerable", e.target.value as DuracionCategoricaV2 | "")}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Sin confirmar</option>
                  {DURACIONES.map((valor) => (
                    <option key={valor} value={valor}>
                      {ETIQUETA_DURACION[valor]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Tiempo estimado de recuperación
                <select
                  value={datosEdicion.tiempoRecuperacion}
                  onChange={(e) => campoDatos("tiempoRecuperacion", e.target.value as DuracionCategoricaV2 | "")}
                  className="rounded border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Sin confirmar</option>
                  {DURACIONES.map((valor) => (
                    <option key={valor} value={valor}>
                      {ETIQUETA_DURACION[valor]}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium">Estado de evidencia</legend>
              <select
                value={datosEdicion.estadoEvidencia}
                onChange={(e) => campoDatos("estadoEvidencia", e.target.value as EstadoEvidenciaV2Valor)}
                className="rounded border border-slate-300 px-3 py-2 text-sm"
              >
                {ESTADOS_EVIDENCIA.map((valor) => (
                  <option key={valor} value={valor}>
                    {ETIQUETA_ESTADO_EVIDENCIA[valor]}
                  </option>
                ))}
              </select>
            </fieldset>
          </div>

          {errorEdicion && <p className="text-sm text-red-600">{errorEdicion}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={cargandoEdicion || flujosEdicion.length === 0}
              onClick={guardarEdicionFlujos}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {cargandoEdicion ? "Guardando..." : "Guardar cambios"}
            </button>
            <button
              type="button"
              disabled={cargandoEdicion}
              onClick={() => confirmarYEliminarConexion(conexionEditando.id)}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
            >
              Eliminar conexión
            </button>
            <button
              type="button"
              onClick={() => abrirInvitar(conexionEditando.id)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Invitar a esta conexión
            </button>
            <button
              type="button"
              onClick={() => {
                setConexionEditando(null);
                setFlujosEdicion([]);
                setDatosEdicion(DATOS_CONEXION_VACIOS);
              }}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Cancelar
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Tip: con este panel abierto también podés presionar Supr o Backspace para eliminar la
            conexión.
          </p>
        </div>
      )}

      {invitarAbierto && (
        <div className="flex flex-col gap-2 rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-medium">
            {invitarConexionCadenaId
              ? "Invitar a responder sobre esta conexión"
              : "Invitar a responder sobre toda la cadena"}
          </p>
          <p className="text-xs text-slate-500">
            La persona invitada recibe un correo con un enlace para responder unas pocas
            preguntas, sin crear ninguna cuenta.
          </p>
          <input
            type="email"
            placeholder="Email de la persona invitada"
            required
            value={emailInvitar}
            onChange={(e) => setEmailInvitar(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          {errorInvitar && <p className="text-sm text-red-600">{errorInvitar}</p>}
          {exitoInvitar && <p className="text-sm text-green-700">Invitación enviada.</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={cargandoInvitar || !emailInvitar.trim()}
              onClick={enviarInvitacion}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {cargandoInvitar ? "Enviando..." : "Enviar invitación"}
            </button>
            <button
              type="button"
              onClick={() => setInvitarAbierto(false)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
