// Componente — mapa visual de una Cadena con React Flow (RF34). Por
// ahora es de solo lectura: muestra los nodos y conexiones ya existentes
// (crear/editar directamente sobre el canvas, RF34, es el siguiente paso
// del Bloque B). Las posiciones no se persisten todavia -- el schema no
// tiene columnas de posicion en Nodo (PLAN-DE-TRABAJO.md no las incluyo
// en el Bloque A) -- se recalcula un layout simple en grilla en cada
// carga; una vez que exista edicion interactiva (arrastrar nodos) hace
// falta agregar esa columna para persistir la posicion elegida.
"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

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

const ETIQUETA_FLUJO: Record<TipoFlujoV2, string> = {
  PRODUCTO_SERVICIO: "Producto/servicio",
  INFORMACION: "Información",
  DINERO: "Dinero",
  DECISION: "Decisión",
  DEVOLUCION: "Devolución",
};

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
  }));
}

export default function MapaCadenaCanvas({
  nodos,
  conexiones,
}: {
  nodos: NodoProp[];
  conexiones: ConexionProp[];
}) {
  const nodosFlow = useMemo(() => construirNodos(nodos), [nodos]);
  const aristasFlow = useMemo(() => construirAristas(conexiones), [conexiones]);

  return (
    <div className="h-[480px] w-full rounded border border-slate-200">
      <ReactFlow nodes={nodosFlow} edges={aristasFlow} fitView proOptions={{ hideAttribution: true }}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
