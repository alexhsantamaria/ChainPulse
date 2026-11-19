// Componente (cliente) -- asistente de declaracion de OTIF Proveedor,
// nivel 1 (manual, un proveedor) y nivel 2 (pegado tabular, puede
// mezclar VARIOS proveedores en la misma tabla -- Alex, punto 10).
// Incremento 5 PR3 (Alex, 2026-11-18). Mismo patron que
// kpis/otif/DeclaracionOtifWizard.tsx: cada paso llama exactamente a la
// ruta que ya existe, nunca inventa un endpoint nuevo -- POST
// /api/kpis/otif-proveedor/observaciones/previsualizar (pasos 1→2) y
// POST /api/kpis/otif-proveedor/observaciones/confirmar (paso 2→3,
// reenvia el MISMO payload que se previsualizo).
//
// Diferencia de forma respecto del wizard de OTIF normal: el resultado
// de previsualizar/confirmar es un ARREGLO (`resultados`, uno por
// proveedor distinto en la tabla -- vacio solo si el payload no tiene
// ninguna fila, nunca pasa de validacion), no un unico `resultado`;
// el paso "confirmado" lista TODAS las observaciones creadas/actualizadas
// en esta confirmacion, cada una con su propio enlace de detalle.
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchJsonSeguro, type RespuestaApiBase } from "@/infra/http/fetchJsonSeguro";

interface CadenaOpcion {
  id: string;
  nombre: string;
}

interface FilaOtifProveedorUI {
  proveedorAlias: string;
  pedido: string;
  fechaPromesa: string;
  fechaRecepcion: string | null;
  cantidadPedida: number;
  cantidadRecibida: number | null;
}

interface ResultadoCalculoKpiUI {
  valor: number | null;
  numerador: number | null;
  denominador: number | null;
  filasEvaluadas: number;
  filasExcluidas: number;
  cobertura: number;
  advertencias: string[];
  ruleVersion: string;
}

interface ObservacionOtifProveedorCalculadaUI {
  proveedorAlias: string;
  proveedorAliasClave: string;
  resultado: ResultadoCalculoKpiUI;
}

interface ObservacionOtifProveedorConfirmadaUI extends ObservacionOtifProveedorCalculadaUI {
  observacionId: string;
}

// Mismo criterio que RespuestaConDetalleErrorOtif (otif/DeclaracionOtifWizard.tsx)
// -- campos de detalle estructurado que /previsualizar y /confirmar
// pueden agregar junto a `error`, mas los que son NUEVOS de este
// catalogo: `filas` ahora trae pares {proveedorAlias, pedido} (nunca solo
// `pedido`, porque el mismo pedido puede repetirse legitimamente entre
// DOS proveedores distintos) y `conflictos` (ALIAS_PROVEEDOR_CONFLICTIVOS,
// sin equivalente en OTIF normal).
interface RespuestaConDetalleErrorOtifProveedor extends RespuestaApiBase {
  filas?: Array<{ proveedorAlias: string; pedido: string }>;
  conflictos?: Array<{ proveedorAliasClave: string; variantes: string[] }>;
  limite?: number;
  recibidas?: number;
  limiteBytes?: number;
}

interface RespuestaPrevisualizar extends RespuestaConDetalleErrorOtifProveedor {
  resultados?: ObservacionOtifProveedorCalculadaUI[];
  filasInterpretadas?: FilaOtifProveedorUI[];
}

interface RespuestaConfirmar extends RespuestaConDetalleErrorOtifProveedor {
  resultados?: ObservacionOtifProveedorConfirmadaUI[];
}

const MENSAJE_ERROR: Record<string, string> = {
  DATOS_INVALIDOS: "Faltan datos o hay un valor inválido -- revisá el formulario.",
  TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES: "No se interpretó ninguna fila de la tabla pegada.",
  CADENA_INEXISTENTE: "No se encontró la cadena seleccionada.",
  DEFINICION_KPI_NO_DISPONIBLE: "El catálogo de KPIs no está disponible en este momento -- intentá de nuevo en un momento.",
  NO_SESION: "Tu sesión expiró -- volvé a iniciar sesión.",
  NO_AUTORIZADO: "Solo un administrador puede declarar observaciones OTIF Proveedor.",
  ERROR_RED: "No se pudo conectar -- revisá tu conexión e intentá de nuevo.",
  ERROR_INTERNO: "Ocurrió un error inesperado -- intentá de nuevo en un momento.",
  CUERPO_INVALIDO: "La solicitud no tiene un formato válido -- recargá la página e intentá de nuevo.",
};

const INESPERADO = "Ocurrió un error inesperado -- intentá de nuevo en un momento.";

// Mismo tope que OTIF normal -- una carga con miles de filas/proveedores
// duplicados no debe convertir el mensaje de error en un volcado de
// miles de caracteres.
const MAX_ITEMS_EN_MENSAJE = 20;

function formatearListaFilas(filas: Array<{ proveedorAlias: string; pedido: string }>): string {
  const etiquetas = filas.map((f) => `${f.proveedorAlias}/${f.pedido}`);
  if (etiquetas.length <= MAX_ITEMS_EN_MENSAJE) return etiquetas.join(", ");
  const visibles = etiquetas.slice(0, MAX_ITEMS_EN_MENSAJE);
  return `${visibles.join(", ")} y ${etiquetas.length - MAX_ITEMS_EN_MENSAJE} más`;
}

function formatearListaConflictos(conflictos: Array<{ proveedorAliasClave: string; variantes: string[] }>): string {
  const etiquetas = conflictos.map((c) => c.variantes.join(" / "));
  if (etiquetas.length <= MAX_ITEMS_EN_MENSAJE) return etiquetas.join("; ");
  const visibles = etiquetas.slice(0, MAX_ITEMS_EN_MENSAJE);
  return `${visibles.join("; ")} y ${etiquetas.length - MAX_ITEMS_EN_MENSAJE} más`;
}

function formatearBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} bytes`;
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    const kb = bytes / 1024;
    return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
  }
  return `${bytes} bytes`;
}

export interface DetalleErrorOtifProveedorUI {
  error?: string;
  filas?: Array<{ proveedorAlias: string; pedido: string }>;
  conflictos?: Array<{ proveedorAliasClave: string; variantes: string[] }>;
  limite?: number;
  recibidas?: number;
  limiteBytes?: number;
}

// Misma logica que construirMensajeError (otif/DeclaracionOtifWizard.tsx),
// probada de forma aislada (mismo criterio: tipo minimo, sin necesitar
// una respuesta HTTP completa) -- extendida con ALIAS_PROVEEDOR_CONFLICTIVOS
// y con `filas` ahora como pares proveedor/pedido.
export function construirMensajeErrorOtifProveedor(respuesta: DetalleErrorOtifProveedorUI | undefined): string {
  const codigo = respuesta?.error;
  if (!codigo) return MENSAJE_ERROR.ERROR_INTERNO ?? INESPERADO;

  if (codigo === "PEDIDOS_DUPLICADOS") {
    const filas = respuesta?.filas;
    if (filas && filas.length > 0) {
      return `Hay pedidos duplicados dentro del mismo proveedor: ${formatearListaFilas(filas)}. Cada pedido debe aparecer una sola vez por proveedor.`;
    }
    return "Hay pedidos duplicados dentro del mismo proveedor. Cada pedido debe aparecer una sola vez por proveedor.";
  }

  if (codigo === "FILAS_FUERA_DE_PERIODO") {
    const filas = respuesta?.filas;
    if (filas && filas.length > 0) {
      return `Hay filas fuera del período declarado (según la fecha prometida): ${formatearListaFilas(filas)}. Ajustá el período o corregí esas filas.`;
    }
    return "Hay filas fuera del período declarado (según la fecha prometida). Ajustá el período o corregí esas filas.";
  }

  if (codigo === "ALIAS_PROVEEDOR_CONFLICTIVOS") {
    const conflictos = respuesta?.conflictos;
    if (conflictos && conflictos.length > 0) {
      return `Hay un mismo proveedor escrito de formas distintas en la tabla pegada: ${formatearListaConflictos(conflictos)}. Usá siempre la misma forma para el mismo proveedor.`;
    }
    return "Hay un mismo proveedor escrito de formas distintas en la tabla pegada. Usá siempre la misma forma para el mismo proveedor.";
  }

  if (codigo === "DEMASIADAS_FILAS") {
    const { limite, recibidas } = respuesta ?? {};
    if (typeof limite === "number" && typeof recibidas === "number") {
      return `La tabla pegada tiene demasiadas filas: se recibieron ${recibidas}, el límite es ${limite}. Dividí la carga en partes más chicas.`;
    }
    return "La tabla pegada tiene demasiadas filas. Dividí la carga en partes más chicas.";
  }

  if (codigo === "CUERPO_DEMASIADO_GRANDE") {
    const limiteBytes = respuesta?.limiteBytes;
    if (typeof limiteBytes === "number") {
      return `Los datos enviados son demasiado grandes (límite: ${formatearBytes(limiteBytes)}). Dividí la carga en partes más chicas.`;
    }
    return "Los datos enviados son demasiado grandes. Dividí la carga en partes más chicas.";
  }

  return MENSAJE_ERROR[codigo] ?? INESPERADO;
}

// Parser del pegado tabular (nivel 2) -- separador tab o coma, columnas
// fijas en este orden: proveedorAlias, pedido, fechaPromesa,
// fechaRecepcion, cantidadPedida, cantidadRecibida -- UNA columna mas que
// OTIF normal (proveedorAlias al frente), porque una misma tabla pegada
// puede mezclar varios proveedores (Alex, punto 10).
function parsearFilasPegadas(texto: string): FilaOtifProveedorUI[] {
  return texto
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0)
    .map((linea) => {
      const columnas = linea.includes("\t") ? linea.split("\t") : linea.split(",");
      const [proveedorAlias, pedido, fechaPromesa, fechaRecepcion, cantidadPedida, cantidadRecibida] = columnas.map((c) => c.trim());
      return {
        proveedorAlias: proveedorAlias ?? "",
        pedido: pedido ?? "",
        fechaPromesa: fechaPromesa ?? "",
        fechaRecepcion: fechaRecepcion ? fechaRecepcion : null,
        cantidadPedida: Number(cantidadPedida),
        cantidadRecibida: cantidadRecibida ? Number(cantidadRecibida) : null,
      };
    });
}

export default function DeclaracionOtifProveedorWizard({ cadenas }: { cadenas: CadenaOpcion[] }) {
  const router = useRouter();
  const [paso, setPaso] = useState<"formulario" | "previsualizacion" | "confirmado">("formulario");
  const [modo, setModo] = useState<"manual" | "pegado">("manual");
  const [cadenaId, setCadenaId] = useState(cadenas[0]?.id ?? "");
  const [periodoInicio, setPeriodoInicio] = useState("");
  const [periodoFin, setPeriodoFin] = useState("");
  const [proveedorAlias, setProveedorAlias] = useState("");
  const [numerador, setNumerador] = useState("");
  const [denominador, setDenominador] = useState("");
  const [textoPegado, setTextoPegado] = useState("");
  const [resultados, setResultados] = useState<ObservacionOtifProveedorCalculadaUI[] | null>(null);
  const [confirmados, setConfirmados] = useState<ObservacionOtifProveedorConfirmadaUI[] | null>(null);
  const [filasInterpretadas, setFilasInterpretadas] = useState<FilaOtifProveedorUI[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  function construirPayload(): Record<string, unknown> | null {
    if (!cadenaId || !periodoInicio || !periodoFin) return null;
    if (modo === "manual") {
      if (!proveedorAlias.trim()) return null;
      const n = Number(numerador);
      const d = Number(denominador);
      if (Number.isNaN(n) || Number.isNaN(d)) return null;
      return { modo: "manual", cadenaId, periodoInicio, periodoFin, proveedorAlias, numerador: n, denominador: d };
    }
    const filas = parsearFilasPegadas(textoPegado);
    if (filas.length === 0) return null;
    return { modo: "pegado", cadenaId, periodoInicio, periodoFin, filas };
  }

  async function handlePrevisualizar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    const payload = construirPayload();
    if (!payload) {
      setError(construirMensajeErrorOtifProveedor({ error: "DATOS_INVALIDOS" }));
      return;
    }
    setCargando(true);
    const respuesta = await fetchJsonSeguro<RespuestaPrevisualizar>("/api/kpis/otif-proveedor/observaciones/previsualizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setCargando(false);
    if (!respuesta.ok || !respuesta.resultados) {
      setError(construirMensajeErrorOtifProveedor(respuesta));
      return;
    }
    setResultados(respuesta.resultados);
    setFilasInterpretadas(respuesta.filasInterpretadas);
    setPaso("previsualizacion");
  }

  async function handleConfirmar() {
    setError(null);
    const payload = construirPayload();
    if (!payload) {
      setError(construirMensajeErrorOtifProveedor({ error: "DATOS_INVALIDOS" }));
      return;
    }
    setCargando(true);
    const respuesta = await fetchJsonSeguro<RespuestaConfirmar>("/api/kpis/otif-proveedor/observaciones/confirmar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setCargando(false);
    if (!respuesta.ok || !respuesta.resultados) {
      setError(construirMensajeErrorOtifProveedor(respuesta));
      return;
    }
    setConfirmados(respuesta.resultados);
    setPaso("confirmado");
    router.refresh();
  }

  function formatearValor(valor: number | null): string {
    return valor === null ? "--" : `${(valor * 100).toFixed(1)}%`;
  }

  if (paso === "confirmado" && confirmados) {
    return (
      <div className="flex flex-col gap-3 rounded border border-emerald-200 bg-emerald-50 p-4">
        <p className="font-medium text-emerald-800">
          {confirmados.length === 1
            ? "Observación OTIF Proveedor confirmada."
            : `${confirmados.length} observaciones OTIF Proveedor confirmadas.`}
        </p>
        <ul className="flex flex-col gap-1 text-sm text-emerald-700">
          {confirmados.map((c) => (
            <li key={c.observacionId} className="flex items-center justify-between gap-2">
              <span>
                {c.proveedorAlias}: {formatearValor(c.resultado.valor)} · versión de regla: {c.resultado.ruleVersion}
              </span>
              <Link href={`/dashboard/kpis/otif-proveedor/observaciones/${c.observacionId}`} className="shrink-0 underline">
                Ver detalle →
              </Link>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="self-start rounded bg-slate-800 px-3 py-2 text-sm text-white"
          onClick={() => {
            setPaso("formulario");
            setResultados(null);
            setConfirmados(null);
            setFilasInterpretadas(undefined);
          }}
        >
          Declarar otra observación
        </button>
      </div>
    );
  }

  if (paso === "previsualizacion" && resultados) {
    return (
      <div className="flex flex-col gap-4 rounded border border-slate-200 p-4">
        <div>
          <h3 className="font-medium">Previsualización</h3>
          <ul className="mt-1 flex flex-col gap-0.5 text-sm text-slate-600">
            {resultados.map((r) => (
              <li key={r.proveedorAliasClave}>
                <span className="font-medium">{r.proveedorAlias}</span>: {formatearValor(r.resultado.valor)} · numerador:{" "}
                {r.resultado.numerador ?? "--"} · denominador: {r.resultado.denominador ?? "--"} · filas evaluadas:{" "}
                {r.resultado.filasEvaluadas} · filas excluidas: {r.resultado.filasExcluidas}
              </li>
            ))}
          </ul>
        </div>
        {filasInterpretadas && filasInterpretadas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1 pr-3">Proveedor</th>
                  <th className="py-1 pr-3">Pedido</th>
                  <th className="py-1 pr-3">Fecha prometida</th>
                  <th className="py-1 pr-3">Fecha recepción</th>
                  <th className="py-1 pr-3">Cant. pedida</th>
                  <th className="py-1 pr-3">Cant. recibida</th>
                </tr>
              </thead>
              <tbody>
                {filasInterpretadas.map((fila, indice) => (
                  <tr key={indice} className="border-b border-slate-100">
                    <td className="py-1 pr-3">{fila.proveedorAlias}</td>
                    <td className="py-1 pr-3">{fila.pedido}</td>
                    <td className="py-1 pr-3">{fila.fechaPromesa}</td>
                    <td className="py-1 pr-3">{fila.fechaRecepcion ?? "--"}</td>
                    <td className="py-1 pr-3">{fila.cantidadPedida}</td>
                    <td className="py-1 pr-3">{fila.cantidadRecibida ?? "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50"
            onClick={handleConfirmar}
            disabled={cargando}
          >
            {cargando ? "Confirmando…" : "Confirmar y guardar"}
          </button>
          <button type="button" className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={() => setPaso("formulario")}>
            Volver a editar
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handlePrevisualizar} className="flex flex-col gap-4 rounded border border-slate-200 p-4">
      <div className="flex gap-4">
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" checked={modo === "manual"} onChange={() => setModo("manual")} />
          Nivel 1 -- manual (un proveedor)
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" checked={modo === "pegado"} onChange={() => setModo("pegado")} />
          Nivel 2 -- pegado (varios proveedores)
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Cadena
        <select className="rounded border border-slate-300 px-2 py-1" value={cadenaId} onChange={(e) => setCadenaId(e.target.value)}>
          {cadenas.map((cadena) => (
            <option key={cadena.id} value={cadena.id}>
              {cadena.nombre}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Período -- inicio
          <input
            type="date"
            className="rounded border border-slate-300 px-2 py-1"
            value={periodoInicio}
            onChange={(e) => setPeriodoInicio(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Período -- fin
          <input
            type="date"
            className="rounded border border-slate-300 px-2 py-1"
            value={periodoFin}
            onChange={(e) => setPeriodoFin(e.target.value)}
            required
          />
        </label>
      </div>

      {modo === "manual" ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Proveedor
            <input
              type="text"
              className="rounded border border-slate-300 px-2 py-1"
              value={proveedorAlias}
              onChange={(e) => setProveedorAlias(e.target.value)}
              placeholder="Nombre o alias del proveedor"
              required
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Numerador (pedidos OTIF)
              <input
                type="number"
                min={0}
                className="rounded border border-slate-300 px-2 py-1"
                value={numerador}
                onChange={(e) => setNumerador(e.target.value)}
                required
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Denominador (pedidos evaluados)
              <input
                type="number"
                min={1}
                className="rounded border border-slate-300 px-2 py-1"
                value={denominador}
                onChange={(e) => setDenominador(e.target.value)}
                required
              />
            </label>
          </div>
        </>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          Pegá la tabla (una fila por pedido -- columnas: proveedor, pedido, fecha prometida, fecha recepción, cantidad
          pedida, cantidad recibida). Podés mezclar varios proveedores en la misma tabla.
          <textarea
            className="h-32 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            value={textoPegado}
            onChange={(e) => setTextoPegado(e.target.value)}
            placeholder={"Proveedor A\tPED-001\t2026-10-01\t2026-10-01\t100\t100"}
            required
          />
        </label>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" className="self-start rounded bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-50" disabled={cargando}>
        {cargando ? "Calculando…" : "Previsualizar"}
      </button>
    </form>
  );
}
