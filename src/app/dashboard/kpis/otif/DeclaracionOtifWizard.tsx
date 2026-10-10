// Componente (cliente) -- asistente de declaracion de OTIF, nivel 1
// (manual agregado) y nivel 2 (pegado tabular), piloto Incremento 4
// Bloque B (Alex, 2026-10-08/09). Mismo patron que
// kpis/cobertura/ImportadorCoberturaWizard.tsx: cada paso llama
// exactamente a la ruta que ya existe, nunca inventa un endpoint nuevo --
// POST /api/kpis/otif/observaciones/previsualizar (pasos 1→2) y
// POST /api/kpis/otif/observaciones/confirmar (paso 2→3, reenvia el MISMO
// payload que se previsualizo).
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchJsonSeguro, type RespuestaApiBase } from "@/infra/http/fetchJsonSeguro";

interface CadenaOpcion {
  id: string;
  nombre: string;
}

interface FilaOtifUI {
  pedido: string;
  fechaPrometida: string;
  fechaReal: string | null;
  cantidadPedida: number;
  cantidadEntregada: number | null;
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

// Campos de detalle estructurado que las rutas /previsualizar y
// /confirmar pueden agregar junto a `error` (ver declarar.ts,
// FalloValidacionOtif, y leerCuerpoJsonLimitado.ts) -- la UI los necesita
// para explicar CUAL fila/pedido/limite causo el rechazo, en vez de un
// generico "error inesperado" (Alex 2026-10-10).
interface RespuestaConDetalleErrorOtif extends RespuestaApiBase {
  pedidos?: string[];
  limite?: number;
  recibidas?: number;
  limiteBytes?: number;
}

interface RespuestaPrevisualizar extends RespuestaConDetalleErrorOtif {
  resultado?: ResultadoCalculoKpiUI;
  filasInterpretadas?: FilaOtifUI[];
}

interface RespuestaConfirmar extends RespuestaConDetalleErrorOtif {
  resultado?: ResultadoCalculoKpiUI;
  observacionId?: string;
}

const MENSAJE_ERROR: Record<string, string> = {
  DATOS_INVALIDOS: "Faltan datos o hay un valor inválido -- revisá el formulario.",
  TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES: "No se interpretó ninguna fila de la tabla pegada.",
  CADENA_INEXISTENTE: "No se encontró la cadena seleccionada.",
  DEFINICION_KPI_NO_DISPONIBLE: "El catálogo de KPIs no está disponible en este momento -- intentá de nuevo en un momento.",
  NO_SESION: "Tu sesión expiró -- volvé a iniciar sesión.",
  NO_AUTORIZADO: "Solo un administrador puede declarar observaciones OTIF.",
  ERROR_RED: "No se pudo conectar -- revisá tu conexión e intentá de nuevo.",
  ERROR_INTERNO: "Ocurrió un error inesperado -- intentá de nuevo en un momento.",
  CUERPO_INVALIDO: "La solicitud no tiene un formato válido -- recargá la página e intentá de nuevo.",
};

const INESPERADO = "Ocurrió un error inesperado -- intentá de nuevo en un momento.";

// Tope de pedidos listados en un mensaje de UI -- una carga con miles de
// filas duplicadas o fuera de periodo no debe convertir el mensaje de
// error en un volcado de miles de caracteres (Alex 2026-10-10: "mostrarlos
// de forma segura y comprensible").
const MAX_PEDIDOS_EN_MENSAJE = 20;

function formatearListaPedidos(pedidos: string[]): string {
  if (pedidos.length <= MAX_PEDIDOS_EN_MENSAJE) return pedidos.join(", ");
  const visibles = pedidos.slice(0, MAX_PEDIDOS_EN_MENSAJE);
  return `${visibles.join(", ")} y ${pedidos.length - MAX_PEDIDOS_EN_MENSAJE} más`;
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

// Tipo minimo que necesita el constructor de mensajes -- deliberadamente
// mas chico que RespuestaPrevisualizar/RespuestaConfirmar para que se
// pueda probar de forma aislada (este archivo no tiene infraestructura de
// pruebas de componentes, Alex 2026-10-10) sin construir una respuesta
// HTTP completa.
export interface DetalleErrorOtifUI {
  error?: string;
  pedidos?: string[];
  limite?: number;
  recibidas?: number;
  limiteBytes?: number;
}

// Construye el mensaje de error para la UI. A diferencia de la version
// anterior (que solo miraba el codigo `error`), esta recibe la respuesta
// COMPLETA: PEDIDOS_DUPLICADOS, FILAS_FUERA_DE_PERIODO, DEMASIADAS_FILAS y
// CUERPO_DEMASIADO_GRANDE (agregados Alex 2026-10-10) traen detalle
// estructurado -- pedidos afectados, limite/recibidas, limiteBytes -- que
// el mensaje debe incorporar: no alcanza con que la API reenvie esos
// campos si el mensaje final sigue diciendo "error inesperado".
export function construirMensajeError(respuesta: DetalleErrorOtifUI | undefined): string {
  const codigo = respuesta?.error;
  if (!codigo) return MENSAJE_ERROR.ERROR_INTERNO ?? INESPERADO;

  if (codigo === "PEDIDOS_DUPLICADOS") {
    const pedidos = respuesta?.pedidos;
    if (pedidos && pedidos.length > 0) {
      return `Hay pedidos duplicados en la tabla pegada: ${formatearListaPedidos(pedidos)}. Cada pedido debe aparecer una sola vez.`;
    }
    return "Hay pedidos duplicados en la tabla pegada. Cada pedido debe aparecer una sola vez.";
  }

  if (codigo === "FILAS_FUERA_DE_PERIODO") {
    const pedidos = respuesta?.pedidos;
    if (pedidos && pedidos.length > 0) {
      return `Hay filas fuera del período declarado (según la fecha prometida): ${formatearListaPedidos(pedidos)}. Ajustá el período o corregi esas filas.`;
    }
    return "Hay filas fuera del período declarado (según la fecha prometida). Ajustá el período o corregi esas filas.";
  }

  if (codigo === "DEMASIADAS_FILAS") {
    const { limite, recibidas } = respuesta ?? {};
    if (typeof limite === "number" && typeof recibidas === "number") {
      return `La tabla pegada tiene demasiadas filas: se recibieron ${recibidas}, el límite es ${limite}. Dividi la carga en partes más chicas.`;
    }
    return "La tabla pegada tiene demasiadas filas. Dividi la carga en partes más chicas.";
  }

  if (codigo === "CUERPO_DEMASIADO_GRANDE") {
    const limiteBytes = respuesta?.limiteBytes;
    if (typeof limiteBytes === "number") {
      return `Los datos enviados son demasiado grandes (límite: ${formatearBytes(limiteBytes)}). Dividi la carga en partes más chicas.`;
    }
    return "Los datos enviados son demasiado grandes. Dividi la carga en partes más chicas.";
  }

  return MENSAJE_ERROR[codigo] ?? INESPERADO;
}

// Parser minimo del pegado tabular (nivel 2) -- separador tab o coma,
// columnas fijas en este orden: pedido, fechaPrometida, fechaReal,
// cantidadPedida, cantidadEntregada. "fechaReal"/"cantidadEntregada"
// vacios se interpretan como null (pedido todavia no cerrado, RF-K3 --
// calcularOtif() ya sabe excluirlos, este parser no decide eso).
function parsearFilasPegadas(texto: string): FilaOtifUI[] {
  return texto
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0)
    .map((linea) => {
      const columnas = linea.includes("\t") ? linea.split("\t") : linea.split(",");
      const [pedido, fechaPrometida, fechaReal, cantidadPedida, cantidadEntregada] = columnas.map((c) => c.trim());
      return {
        pedido: pedido ?? "",
        fechaPrometida: fechaPrometida ?? "",
        fechaReal: fechaReal ? fechaReal : null,
        cantidadPedida: Number(cantidadPedida),
        cantidadEntregada: cantidadEntregada ? Number(cantidadEntregada) : null,
      };
    });
}

export default function DeclaracionOtifWizard({ cadenas }: { cadenas: CadenaOpcion[] }) {
  const router = useRouter();
  const [paso, setPaso] = useState<"formulario" | "previsualizacion" | "confirmado">("formulario");
  const [modo, setModo] = useState<"manual" | "pegado">("manual");
  const [cadenaId, setCadenaId] = useState(cadenas[0]?.id ?? "");
  const [periodoInicio, setPeriodoInicio] = useState("");
  const [periodoFin, setPeriodoFin] = useState("");
  const [numerador, setNumerador] = useState("");
  const [denominador, setDenominador] = useState("");
  const [textoPegado, setTextoPegado] = useState("");
  const [resultado, setResultado] = useState<ResultadoCalculoKpiUI | null>(null);
  const [filasInterpretadas, setFilasInterpretadas] = useState<FilaOtifUI[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  function construirPayload(): Record<string, unknown> | null {
    if (!cadenaId || !periodoInicio || !periodoFin) return null;
    if (modo === "manual") {
      const n = Number(numerador);
      const d = Number(denominador);
      if (Number.isNaN(n) || Number.isNaN(d)) return null;
      return { modo: "manual", cadenaId, periodoInicio, periodoFin, numerador: n, denominador: d };
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
      setError(construirMensajeError({ error: "DATOS_INVALIDOS" }));
      return;
    }
    setCargando(true);
    const respuesta = await fetchJsonSeguro<RespuestaPrevisualizar>("/api/kpis/otif/observaciones/previsualizar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setCargando(false);
    if (!respuesta.ok || !respuesta.resultado) {
      setError(construirMensajeError(respuesta));
      return;
    }
    setResultado(respuesta.resultado);
    setFilasInterpretadas(respuesta.filasInterpretadas);
    setPaso("previsualizacion");
  }

  async function handleConfirmar() {
    setError(null);
    const payload = construirPayload();
    if (!payload) {
      setError(construirMensajeError({ error: "DATOS_INVALIDOS" }));
      return;
    }
    setCargando(true);
    const respuesta = await fetchJsonSeguro<RespuestaConfirmar>("/api/kpis/otif/observaciones/confirmar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setCargando(false);
    if (!respuesta.ok || !respuesta.resultado) {
      setError(construirMensajeError(respuesta));
      return;
    }
    setResultado(respuesta.resultado);
    setPaso("confirmado");
    router.refresh();
  }

  if (paso === "confirmado" && resultado) {
    return (
      <div className="flex flex-col gap-3 rounded border border-emerald-200 bg-emerald-50 p-4">
        <p className="font-medium text-emerald-800">Observación OTIF confirmada.</p>
        <p className="text-sm text-emerald-700">
          Valor: {resultado.valor === null ? "--" : `${(resultado.valor * 100).toFixed(1)}%`} · versión de regla: {resultado.ruleVersion}
        </p>
        <button
          type="button"
          className="self-start rounded bg-slate-800 px-3 py-2 text-sm text-white"
          onClick={() => {
            setPaso("formulario");
            setResultado(null);
            setFilasInterpretadas(undefined);
          }}
        >
          Declarar otra observación
        </button>
      </div>
    );
  }

  if (paso === "previsualizacion" && resultado) {
    return (
      <div className="flex flex-col gap-4 rounded border border-slate-200 p-4">
        <div>
          <h3 className="font-medium">Previsualización</h3>
          <p className="text-sm text-slate-600">
            Valor: {resultado.valor === null ? "--" : `${(resultado.valor * 100).toFixed(1)}%`} · numerador: {resultado.numerador ?? "--"} ·
            denominador: {resultado.denominador ?? "--"} · cobertura: {(resultado.cobertura * 100).toFixed(0)}% · filas evaluadas:{" "}
            {resultado.filasEvaluadas} · filas excluidas: {resultado.filasExcluidas}
          </p>
        </div>
        {resultado.advertencias.length > 0 && (
          <ul className="list-inside list-disc text-sm text-amber-700">
            {resultado.advertencias.map((advertencia, indice) => (
              <li key={indice}>{advertencia}</li>
            ))}
          </ul>
        )}
        {filasInterpretadas && filasInterpretadas.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1 pr-3">Pedido</th>
                  <th className="py-1 pr-3">Fecha prometida</th>
                  <th className="py-1 pr-3">Fecha real</th>
                  <th className="py-1 pr-3">Cant. pedida</th>
                  <th className="py-1 pr-3">Cant. entregada</th>
                </tr>
              </thead>
              <tbody>
                {filasInterpretadas.map((fila, indice) => (
                  <tr key={indice} className="border-b border-slate-100">
                    <td className="py-1 pr-3">{fila.pedido}</td>
                    <td className="py-1 pr-3">{fila.fechaPrometida}</td>
                    <td className="py-1 pr-3">{fila.fechaReal ?? "--"}</td>
                    <td className="py-1 pr-3">{fila.cantidadPedida}</td>
                    <td className="py-1 pr-3">{fila.cantidadEntregada ?? "--"}</td>
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
          Nivel 1 -- manual (una observación)
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" checked={modo === "pegado"} onChange={() => setModo("pegado")} />
          Nivel 2 -- pegado (varias filas)
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
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          Pegá la tabla (una fila por pedido -- columnas: pedido, fecha prometida, fecha real, cantidad pedida, cantidad entregada)
          <textarea
            className="h-32 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            value={textoPegado}
            onChange={(e) => setTextoPegado(e.target.value)}
            placeholder={"PED-001\t2026-10-01\t2026-10-01\t100\t100"}
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
