// Componente (cliente) -- Incremento 5. Selecciona UNA de las 6
// preguntas del catalogo cerrado (radio buttons, nunca un campo de texto
// libre -- I5-07/I5-08), la cadena y, si la pregunta lo requiere, un
// periodo, y llama a POST /api/consultas/ejecutar. Misma convencion que
// kpis/otif/DeclaracionOtifWizard.tsx: fetchJsonSeguro() para que un
// fallo de red o un cuerpo no-JSON nunca deje el estado de carga pegado.
"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { fetchJsonSeguro, type RespuestaApiBase } from "@/infra/http/fetchJsonSeguro";
import type { CatalogoConsultaId, MetadatosCatalogoConsulta } from "@/domain/queries/tipos";

interface CadenaOpcion {
  id: string;
  nombre: string;
}

interface RespuestaEjecutarOk extends RespuestaApiBase {
  ok: true;
  catalogoId: CatalogoConsultaId;
  respuestaDirecta: string;
  periodo: { inicio: string; fin: string };
  filtros: Record<string, string | number | boolean>;
  fuente: string;
  formula: string;
  numerador: number | null;
  denominador: number | null;
  calidad: { faltantes: string[]; cobertura: number };
  hecho: string;
  interpretacion: string;
  accion: string;
  comoComprobar: string;
  ruleVersion: string;
}

interface RespuestaEjecutarSinDatos extends RespuestaApiBase {
  ok: false;
  error: "SIN_DATOS_SUFICIENTES";
  catalogoId: CatalogoConsultaId;
  mensaje: string;
  camposFaltantes: string[];
  comoIngresarlos: string;
}

type RespuestaEjecutar = RespuestaEjecutarOk | RespuestaEjecutarSinDatos | RespuestaApiBase;

const MENSAJE_ERROR: Record<string, string> = {
  CATALOGO_ID_INVALIDO: "La pregunta seleccionada no es válida -- recargá la página e intentá de nuevo.",
  CADENA_INEXISTENTE: "No se encontró la cadena seleccionada.",
  PERMISO_DENEGADO: "Tu rol no tiene permiso para esta pregunta.",
  PERIODO_REQUERIDO: "Esta pregunta necesita un período -- completá inicio y fin.",
  PERIODO_INVALIDO: "El período no es válido -- revisá que el inicio sea anterior al fin.",
  PERIODO_DEMASIADO_LARGO: "El período es demasiado largo para esta consulta -- acotalo.",
  DATOS_INVALIDOS: "Faltan datos o hay un valor inválido -- revisá el formulario.",
  NO_SESION: "Tu sesión expiró -- volvé a iniciar sesión.",
  NO_AUTORIZADO: "No tenés permiso para esta acción.",
  ERROR_RED: "No se pudo conectar -- revisá tu conexión e intentá de nuevo.",
  ERROR_INTERNO: "Ocurrió un error inesperado -- intentá de nuevo en un momento.",
  CUERPO_INVALIDO: "La solicitud no tiene un formato válido -- recargá la página e intentá de nuevo.",
};

const INESPERADO = "Ocurrió un error inesperado -- intentá de nuevo en un momento.";

/** Pura -- aislada y probada por separado (mismo criterio que
 * DeclaracionOtifWizard.tsx: el repositorio no tiene infraestructura
 * para probar componentes React, ver
 * dashboard/consultas/__tests__/construirMensajeError.test.ts). Nunca
 * recibe "SIN_DATOS_SUFICIENTES" -- ese caso no es un error de ruta, se
 * muestra con su propio bloque (ver el render de abajo). */
export function construirMensajeError(codigo: string | undefined): string {
  if (!codigo) return INESPERADO;
  return MENSAJE_ERROR[codigo] ?? INESPERADO;
}

function formatearFechaIso(fecha: string): string {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return fecha;
  return d.toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit" });
}

export default function ConsultasPanel({ cadenas, catalogo }: { cadenas: CadenaOpcion[]; catalogo: MetadatosCatalogoConsulta[] }) {
  const idBase = useId();
  const [catalogoId, setCatalogoId] = useState<CatalogoConsultaId | "">(catalogo[0]?.id ?? "");
  const [cadenaId, setCadenaId] = useState(cadenas[0]?.id ?? "");
  const [periodoInicio, setPeriodoInicio] = useState("");
  const [periodoFin, setPeriodoFin] = useState("");
  const [estado, setEstado] = useState<"idle" | "cargando" | "error" | "resultado">("idle");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<RespuestaEjecutarOk | RespuestaEjecutarSinDatos | null>(null);

  const metadatosSeleccionados = useMemo(() => catalogo.find((m) => m.id === catalogoId) ?? null, [catalogo, catalogoId]);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!catalogoId || !cadenaId) return;
    if (metadatosSeleccionados?.requierePeriodo && (!periodoInicio || !periodoFin)) {
      setEstado("error");
      setError(construirMensajeError("PERIODO_REQUERIDO"));
      return;
    }

    setEstado("cargando");
    setError(null);
    setResultado(null);

    const payload: Record<string, string> = { catalogoId, cadenaId };
    if (metadatosSeleccionados?.requierePeriodo) {
      payload.periodoInicio = periodoInicio;
      payload.periodoFin = periodoFin;
    }

    const respuesta = await fetchJsonSeguro<RespuestaEjecutar>("/api/consultas/ejecutar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!respuesta.ok && respuesta.error !== "SIN_DATOS_SUFICIENTES") {
      setEstado("error");
      setError(construirMensajeError(respuesta.error));
      return;
    }

    setResultado(respuesta as RespuestaEjecutarOk | RespuestaEjecutarSinDatos);
    setEstado("resultado");
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded border border-slate-200 p-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Pregunta</legend>
          {catalogo.map((metadatos) => (
            <label key={metadatos.id} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={`${idBase}-catalogo`}
                checked={catalogoId === metadatos.id}
                onChange={() => {
                  setCatalogoId(metadatos.id);
                  setEstado("idle");
                  setResultado(null);
                  setError(null);
                }}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{metadatos.titulo}</span>
                <br />
                <span className="text-xs text-slate-500">{metadatos.descripcion}</span>
              </span>
            </label>
          ))}
        </fieldset>

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

        {metadatosSeleccionados?.requierePeriodo ? (
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
        ) : null}

        <button
          type="submit"
          className="self-start rounded bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={estado === "cargando" || !catalogoId || !cadenaId}
        >
          {estado === "cargando" ? "Consultando…" : "Consultar"}
        </button>
      </form>

      <div aria-live="polite" className="flex flex-col gap-4">
        {estado === "error" && error ? <p className="text-sm text-red-600">{error}</p> : null}

        {estado === "resultado" && resultado && !resultado.ok ? (
          <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
            <p className="font-medium text-amber-900">{resultado.mensaje}</p>
            {resultado.camposFaltantes.length > 0 ? (
              <ul className="list-inside list-disc text-amber-800">
                {resultado.camposFaltantes.map((campo) => (
                  <li key={campo}>{campo}</li>
                ))}
              </ul>
            ) : null}
            <p className="text-amber-800">{resultado.comoIngresarlos}</p>
          </div>
        ) : null}

        {estado === "resultado" && resultado && resultado.ok ? (
          <div className="flex flex-col gap-4 rounded border border-slate-200 p-4 text-sm">
            <p className="text-base font-semibold">{resultado.respuestaDirecta}</p>

            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hecho</h2>
                <p>{resultado.hecho}</p>
              </div>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Interpretación</h2>
                <p>{resultado.interpretacion}</p>
              </div>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Acción sugerida</h2>
                <p>{resultado.accion}</p>
              </div>
            </div>

            <div className="rounded bg-slate-50 p-3 text-xs text-slate-600">
              <p>
                Período: {formatearFechaIso(resultado.periodo.inicio)} – {formatearFechaIso(resultado.periodo.fin)}
              </p>
              <p>Fuente: {resultado.fuente}</p>
              <p>Fórmula: {resultado.formula}</p>
              {resultado.numerador !== null && resultado.denominador !== null ? (
                <p>
                  Numerador/denominador: {resultado.numerador} / {resultado.denominador}
                </p>
              ) : null}
              <p>Cobertura de datos: {Math.round(resultado.calidad.cobertura * 100)}%</p>
              {resultado.calidad.faltantes.length > 0 ? <p>Faltantes: {resultado.calidad.faltantes.join(", ")}</p> : null}
              <p>Cómo comprobarlo: {resultado.comoComprobar}</p>
              <p>Versión de regla: {resultado.ruleVersion}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
