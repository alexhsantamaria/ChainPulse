// Componente (cliente) -- asistente de declaracion de Lead time, nivel 1
// (manual, un unico valor promedio ya calculado) y nivel 2 (pegado
// tabular por proceso). Incremento 5 (Alex, 2026-11-27/28), primer KPI
// activado de los seis pendientes. Mismo patron que
// kpis/fill-rate/DeclaracionFillRateWizard.tsx y
// kpis/otif/DeclaracionOtifWizard.tsx: cada paso llama exactamente a la
// ruta que ya existe, nunca inventa un endpoint nuevo -- POST
// /api/kpis/lead-time/observaciones/previsualizar (pasos 1→2) y POST
// /api/kpis/lead-time/observaciones/confirmar (paso 2→3, reenvia el MISMO
// payload que se previsualizo, construido por la MISMA funcion
// construirPayloadLeadTime() en ambos casos -- ver mas abajo).
//
// Diferencias deliberadas respecto al patron de OTIF/Fill Rate (decision
// 2026-11-27, "no copies reglas especificas de ratio ni 'proceso
// duplicado'"):
//   1. Lead time NO es un ratio -- no hay numerador/denominador que
//      capturar a mano en el modo manual; se captura DIRECTAMENTE el
//      promedio ya calculado (`valorPromedioDias`), con la unidad
//      ("dias") mostrada FIJA y NO editable (restriccion de UI, no de
//      datos -- ver declarar.ts). numerador/denominador del resultado
//      siempre salen null en modo manual (ver declarar.ts) y se
//      muestran como "--", igual que en el modo pegado cuando
//      corresponda.
//   2. El modo pegado NO tiene ningun error de tipo "PEDIDOS_DUPLICADOS"
//      (la API nunca lo devuelve para Lead time -- no existe ese codigo
//      de error en FalloValidacionLeadTime). En su lugar, los duplicados
//      exactos de proceso+inicio+fin llegan como una advertencia NO
//      BLOQUEANTE por FILA (`fila.advertencia`), ya calculada por el
//      servidor (previsualizarObservacionLeadTime(), declarar.ts) -- este
//      componente solo la MUESTRA (columna "Advertencia" en la tabla de
//      previsualizacion + resumen arriba), nunca la calcula ni la usa
//      para bloquear "Confirmar y guardar".
//
// Nota de infraestructura de pruebas (igual que Fill Rate/OTIF): este
// repositorio no tiene infraestructura para probar componentes React
// interactivos (render + click), asi que la logica realmente
// importante -- el parser del pegado y el constructor del payload -- se
// exporta como funciones puras de modulo (no closures dentro del
// componente, a diferencia del patron original de Fill Rate) para
// poder probarse aisladas en __tests__/construirMensajeError.test.ts.
// Usar la MISMA funcion construirPayloadLeadTime() en
// handlePrevisualizar y handleConfirmar es ademas la garantia
// estructural de que "confirmar" nunca envia un payload distinto al que
// el usuario ya vio en la previsualizacion.
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchJsonSeguro, type RespuestaApiBase } from "@/infra/http/fetchJsonSeguro";

interface CadenaOpcion {
  id: string;
  nombre: string;
}

export interface FilaLeadTimeUI {
  proceso: string;
  inicio: string; // AAAA-MM-DD
  fin: string | null; // AAAA-MM-DD, o null = proceso aun no cerrado
  // Presente SOLO si el servidor detecto que esta fila comparte
  // proceso+inicio+fin (ya saneados) con al menos otra fila de esta
  // misma carga -- ver MENSAJE_ADVERTENCIA_DUPLICADO_LEAD_TIME en
  // infra/kpis/leadTime/declarar.ts. Nunca se calcula en el cliente.
  advertencia?: string;
}

export interface ResultadoCalculoKpiUI {
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
// /confirmar pueden agregar junto a `error` -- mismo patron que
// RespuestaConDetalleErrorFillRate, SIN el campo `pedidos` (Lead time no
// tiene ningun error de tipo "duplicado" -- los duplicados nunca
// rechazan la carga, ver comentario de cabecera).
interface RespuestaConDetalleErrorLeadTime extends RespuestaApiBase {
  limite?: number;
  recibidas?: number;
  limiteBytes?: number;
}

interface RespuestaPrevisualizar extends RespuestaConDetalleErrorLeadTime {
  resultado?: ResultadoCalculoKpiUI;
  filasInterpretadas?: FilaLeadTimeUI[];
}

interface RespuestaConfirmar extends RespuestaConDetalleErrorLeadTime {
  resultado?: ResultadoCalculoKpiUI;
  observacionId?: string;
}

const MENSAJE_ERROR: Record<string, string> = {
  DATOS_INVALIDOS: "Faltan datos o hay un valor inválido -- revisá el formulario.",
  TABLA_VACIA_O_SIN_FILAS_INTERPRETABLES: "No se interpretó ninguna fila de la tabla pegada.",
  CADENA_INEXISTENTE: "No se encontró la cadena seleccionada.",
  DEFINICION_KPI_NO_DISPONIBLE: "El catálogo de KPIs no está disponible en este momento -- intentá de nuevo en un momento.",
  NO_SESION: "Tu sesión expiró -- volvé a iniciar sesión.",
  NO_AUTORIZADO: "Solo un administrador puede declarar observaciones de Lead time.",
  ERROR_RED: "No se pudo conectar -- revisá tu conexión e intentá de nuevo.",
  ERROR_INTERNO: "Ocurrió un error inesperado -- intentá de nuevo en un momento.",
  CUERPO_INVALIDO: "La solicitud no tiene un formato válido -- recargá la página e intentá de nuevo.",
};

const INESPERADO = "Ocurrió un error inesperado -- intentá de nuevo en un momento.";

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

// Tipo minimo que necesita el constructor de mensajes -- mismo criterio
// que DetalleErrorFillRateUI: deliberadamente mas chico que
// RespuestaPrevisualizar/RespuestaConfirmar para poder probarse de forma
// aislada.
export interface DetalleErrorLeadTimeUI {
  error?: string;
  limite?: number;
  recibidas?: number;
  limiteBytes?: number;
}

// Construye el mensaje de error para la UI -- mismo patron que
// construirMensajeError() de OTIF/Fill Rate, SIN ningun caso de
// "duplicado" (PEDIDOS_DUPLICADOS no existe para Lead time -- ver
// comentario de cabecera) ni FILAS_FUERA_DE_PERIODO (tampoco existe).
export function construirMensajeError(respuesta: DetalleErrorLeadTimeUI | undefined): string {
  const codigo = respuesta?.error;
  if (!codigo) return MENSAJE_ERROR.ERROR_INTERNO ?? INESPERADO;

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
// columnas fijas en este orden: proceso, inicio (AAAA-MM-DD), fin
// (AAAA-MM-DD, vacio = null -- proceso aun no cerrado, un dato de
// negocio valido que el motor excluye del promedio, nunca un error de
// forma). Pura -- sin efectos secundarios, exportada para poder
// probarse aislada.
export function parsearFilasPegadasLeadTime(texto: string): FilaLeadTimeUI[] {
  return texto
    .split("\n")
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0)
    .map((linea) => {
      const columnas = linea.includes("\t") ? linea.split("\t") : linea.split(",");
      const [proceso, inicio, fin] = columnas.map((c) => c.trim());
      return {
        proceso: proceso ?? "",
        inicio: inicio ?? "",
        fin: fin ? fin : null,
      };
    });
}

export interface DatosFormularioLeadTime {
  modo: "manual" | "pegado";
  cadenaId: string;
  periodoInicio: string;
  periodoFin: string;
  valorPromedioDiasTexto: string; // input crudo del campo numerico, modo manual
  textoPegado: string; // textarea cruda, modo pegado
}

// Construye el payload exacto que se envia tanto a /previsualizar como a
// /confirmar -- la MISMA funcion en los dos casos (ver comentario de
// cabecera) es la garantia de que "confirmar" nunca manda algo distinto
// de lo que el usuario ya vio. Pura -- nunca llama a fetch, exportada
// para poder probarse aislada (cubre "manual valido/invalido" y "modo
// pegado" sin necesitar renderizar el componente).
export function construirPayloadLeadTime(datos: DatosFormularioLeadTime): Record<string, unknown> | null {
  if (!datos.cadenaId || !datos.periodoInicio || !datos.periodoFin) return null;

  if (datos.modo === "manual") {
    const texto = datos.valorPromedioDiasTexto.trim();
    if (texto === "") return null;
    const valor = Number(texto);
    if (!Number.isFinite(valor)) return null;
    return {
      modo: "manual",
      cadenaId: datos.cadenaId,
      periodoInicio: datos.periodoInicio,
      periodoFin: datos.periodoFin,
      valorPromedioDias: valor,
    };
  }

  const filas = parsearFilasPegadasLeadTime(datos.textoPegado);
  if (filas.length === 0) return null;
  return {
    modo: "pegado",
    cadenaId: datos.cadenaId,
    periodoInicio: datos.periodoInicio,
    periodoFin: datos.periodoFin,
    filas,
  };
}

function formatearDias(valor: number | null): string {
  if (valor === null) return "--";
  return `${valor.toFixed(1)} días`;
}

export default function DeclaracionLeadTimeWizard({ cadenas }: { cadenas: CadenaOpcion[] }) {
  const router = useRouter();
  const [paso, setPaso] = useState<"formulario" | "previsualizacion" | "confirmado">("formulario");
  const [modo, setModo] = useState<"manual" | "pegado">("manual");
  const [cadenaId, setCadenaId] = useState(cadenas[0]?.id ?? "");
  const [periodoInicio, setPeriodoInicio] = useState("");
  const [periodoFin, setPeriodoFin] = useState("");
  const [valorPromedioDiasTexto, setValorPromedioDiasTexto] = useState("");
  const [textoPegado, setTextoPegado] = useState("");
  const [resultado, setResultado] = useState<ResultadoCalculoKpiUI | null>(null);
  const [observacionId, setObservacionId] = useState<string | null>(null);
  const [filasInterpretadas, setFilasInterpretadas] = useState<FilaLeadTimeUI[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  function datosFormulario(): DatosFormularioLeadTime {
    return { modo, cadenaId, periodoInicio, periodoFin, valorPromedioDiasTexto, textoPegado };
  }

  async function handlePrevisualizar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    const payload = construirPayloadLeadTime(datosFormulario());
    if (!payload) {
      setError(construirMensajeError({ error: "DATOS_INVALIDOS" }));
      return;
    }
    setCargando(true);
    const respuesta = await fetchJsonSeguro<RespuestaPrevisualizar>("/api/kpis/lead-time/observaciones/previsualizar", {
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
    // MISMA funcion que handlePrevisualizar, sobre el MISMO estado del
    // formulario -- nunca se reconstruye el payload a partir de
    // `resultado`/`filasInterpretadas` (lo que ya se vio), evitando
    // cualquier desvio entre lo previsualizado y lo confirmado. La
    // advertencia de posible duplicado (si la hay) nunca bloquea este
    // paso: no se lee `fila.advertencia` en ningun punto de esta
    // funcion.
    const payload = construirPayloadLeadTime(datosFormulario());
    if (!payload) {
      setError(construirMensajeError({ error: "DATOS_INVALIDOS" }));
      return;
    }
    setCargando(true);
    const respuesta = await fetchJsonSeguro<RespuestaConfirmar>("/api/kpis/lead-time/observaciones/confirmar", {
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
    setObservacionId(respuesta.observacionId ?? null);
    setPaso("confirmado");
    router.refresh();
  }

  if (paso === "confirmado" && resultado) {
    return (
      <div className="flex flex-col gap-3 rounded border border-emerald-200 bg-emerald-50 p-4">
        <p className="font-medium text-emerald-800">Observación de Lead time confirmada.</p>
        <p className="text-sm text-emerald-700">
          Valor: {formatearDias(resultado.valor)} · versión de regla: {resultado.ruleVersion}
        </p>
        {observacionId && (
          <Link
            href={`/dashboard/kpis/lead-time/observaciones/${observacionId}`}
            className="self-start text-sm text-emerald-800 underline"
          >
            Ver detalle duradero →
          </Link>
        )}
        <button
          type="button"
          className="self-start rounded bg-slate-800 px-3 py-2 text-sm text-white"
          onClick={() => {
            setPaso("formulario");
            setResultado(null);
            setObservacionId(null);
            setFilasInterpretadas(undefined);
          }}
        >
          Declarar otra observación
        </button>
      </div>
    );
  }

  if (paso === "previsualizacion" && resultado) {
    const filasConAdvertencia = (filasInterpretadas ?? []).filter((f) => f.advertencia).length;
    return (
      <div className="flex flex-col gap-4 rounded border border-slate-200 p-4">
        <div>
          <h3 className="font-medium">Previsualización</h3>
          <p className="text-sm text-slate-600">
            Valor: {formatearDias(resultado.valor)} · numerador: {resultado.numerador ?? "--"} · denominador:{" "}
            {resultado.denominador ?? "--"} · cobertura: {(resultado.cobertura * 100).toFixed(0)}% · filas evaluadas:{" "}
            {resultado.filasEvaluadas} · filas excluidas: {resultado.filasExcluidas}
          </p>
        </div>

        {/* Advertencia heuristica de posible duplicado (decision
            2026-11-27) -- NUNCA bloquea "Confirmar y guardar", mas
            abajo: solo informa. Se muestra un resumen si hay al menos
            una fila marcada, ademas de la columna por fila en la
            tabla. */}
        {filasConAdvertencia > 0 && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {filasConAdvertencia} fila(s) con posible duplicado dentro de esta carga -- revisalas abajo antes de
            confirmar. Esto no impide confirmar: todas las filas se conservan tal cual.
          </p>
        )}

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
                  <th className="py-1 pr-3">Proceso</th>
                  <th className="py-1 pr-3">Inicio</th>
                  <th className="py-1 pr-3">Fin</th>
                  <th className="py-1 pr-3">Advertencia</th>
                </tr>
              </thead>
              <tbody>
                {filasInterpretadas.map((fila, indice) => (
                  <tr key={indice} className={"border-b border-slate-100" + (fila.advertencia ? " bg-amber-50" : "")}>
                    <td className="py-1 pr-3">{fila.proceso}</td>
                    <td className="py-1 pr-3">{fila.inicio}</td>
                    <td className="py-1 pr-3">{fila.fin ?? "--"}</td>
                    <td className="py-1 pr-3 text-amber-700">{fila.advertencia ?? ""}</td>
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
          Nivel 1 -- manual (un único promedio ya calculado)
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" checked={modo === "pegado"} onChange={() => setModo("pegado")} />
          Nivel 2 -- pegado (varios procesos)
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
        <label className="flex flex-col gap-1 text-sm">
          Promedio (ya calculado)
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step="any"
              className="rounded border border-slate-300 px-2 py-1"
              value={valorPromedioDiasTexto}
              onChange={(e) => setValorPromedioDiasTexto(e.target.value)}
              required
            />
            {/* Unidad FIJA y NO editable -- restriccion de UI, no de
                datos (decision 2026-11-27, ver declarar.ts). Lead time
                es el unico KPI del catalogo cuya unidad es "dias" en
                este modo. */}
            <span className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-600">días</span>
          </div>
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-sm">
          Pegá la tabla (una fila por proceso -- columnas: proceso, inicio (AAAA-MM-DD), fin (AAAA-MM-DD, vacío si aún
          no cerró))
          <textarea
            className="h-32 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            value={textoPegado}
            onChange={(e) => setTextoPegado(e.target.value)}
            placeholder={"Recepcion de mercaderia\t2026-01-01\t2026-01-03"}
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
