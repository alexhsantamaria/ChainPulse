// Componente (cliente) -- registro y seguimiento de AccionDecisionKpi
// para UN origen (una ObservacionKpi de OTIF/Fill Rate, o una
// ImportacionCsv de Cobertura). Incremento 4 PR3: reemplaza, en ambas
// paginas de detalle (DetalleObservacionKpi.tsx y Cobertura
// [id]/page.tsx), el aviso "el registro y seguimiento de acciones
// estara disponible en una proxima version".
//
// Compartido por los 2 KPIs con detalle habilitado (OTIF, Fill Rate) Y
// por Cobertura -- la forma de la accion (responsable, fecha objetivo,
// prioridad, estado, historial) es identica en los 3 casos, solo cambia
// CUAL es el origen (observacionKpiId vs. importacionCsvId) -- de ahi el
// tipo discriminado `origen` en vez de 2 componentes casi iguales.
//
// `usuarios` (candidatos a responsable/quien figura como creador o
// finalizador) viene del SERVIDOR (la pagina ya hace tenantClient() --
// este componente nunca consulta usuarios por su cuenta, ni falta que le
// hace: los nombres de creadaPor/finalizadaPor que trae el historial se
// resuelven buscando el id en esta misma lista, nunca con una consulta
// aparte).
"use client";

import { useEffect, useState } from "react";
import { fetchJsonSeguro, type RespuestaApiBase } from "@/infra/http/fetchJsonSeguro";
import type { EstadoAccionKpi, OrigenAccionKpi, PrioridadRecomendacionAccionKpi } from "@/infra/kpis/acciones/tipos";
import {
  ESTILO_ESTADO_ACCION,
  ESTILO_PRIORIDAD_ACCION,
  ETIQUETA_ESTADO_ACCION,
  ETIQUETA_PRIORIDAD_ACCION,
  estadosSiguientesPosibles,
  mensajeParaError,
  validarFormularioCrearAccion,
  type FormularioCrearAccion,
} from "./accionesDecisionKpiUi";

export interface UsuarioCandidato {
  id: string;
  nombre: string;
  email: string;
}

/** Forma de una fila tal como la devuelve la API (JSON) -- las fechas
 * llegan como string ISO, nunca como Date (NextResponse.json() las
 * serializa asi). */
interface AccionApi {
  id: string;
  observacionKpiId: string | null;
  importacionCsvId: string | null;
  ruleVersionOrigen: string;
  prioridadOrigen: PrioridadRecomendacionAccionKpi;
  descripcionAccion: string;
  responsableId: string;
  fechaObjetivo: string;
  estado: EstadoAccionKpi;
  creadaPorId: string;
  finalizadaEn: string | null;
  finalizadaPorId: string | null;
  createdAt: string;
}

interface RespuestaListar extends RespuestaApiBase {
  acciones?: AccionApi[];
}

interface RespuestaAccion extends RespuestaApiBase {
  accion?: AccionApi;
}

function paramOrigen(origen: OrigenAccionKpi): string {
  return origen.tipo === "OBSERVACION_KPI"
    ? `observacionKpiId=${encodeURIComponent(origen.observacionKpiId)}`
    : `importacionCsvId=${encodeURIComponent(origen.importacionCsvId)}`;
}

function nombreUsuario(usuarios: UsuarioCandidato[], id: string): string {
  return usuarios.find((u) => u.id === id)?.nombre ?? "(usuario ya no disponible)";
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { year: "numeric", month: "short", day: "2-digit" });
}

/** Correccion de ronda de revision (bloqueante 4): antes, TODO el
 * componente (historial incluido) se montaba solo cuando habia una
 * recomendacion ALTA/MEDIA vigente -- eso ocultaba acciones YA
 * registradas si, para la siguiente vez que se abria la pagina, el
 * analisis ya no sugeria nada nuevo (por ejemplo, la ultima variacion
 * fue ESTABLE). Ahora el componente SIEMPRE se monta (y siempre carga
 * el historial); `recomendacionActual` en null es lo UNICO que oculta
 * el formulario de alta ("Registrar accion") -- nunca el historial. */
export interface RecomendacionActualAccionKpi {
  prioridad: PrioridadRecomendacionAccionKpi;
  ruleVersion: string;
  descripcionSugerida: string;
}

export default function AccionesDecisionKpi({
  origen,
  recomendacionActual,
  usuarios,
}: {
  origen: OrigenAccionKpi;
  recomendacionActual: RecomendacionActualAccionKpi | null;
  usuarios: UsuarioCandidato[];
}) {
  const [acciones, setAcciones] = useState<AccionApi[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const puedeRegistrar = recomendacionActual !== null;
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [form, setForm] = useState<FormularioCrearAccion>({
    descripcionAccion: recomendacionActual?.descripcionSugerida ?? "",
    responsableId: "",
    fechaObjetivo: "",
  });
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargarAcciones() {
    const resultado = await fetchJsonSeguro<RespuestaListar>(`/api/kpis/acciones?${paramOrigen(origen)}`);
    if (!resultado.ok) {
      setErrorCarga(mensajeParaError(resultado.error));
      return;
    }
    setErrorCarga(null);
    setAcciones(resultado.acciones ?? []);
  }

  useEffect(() => {
    cargarAcciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- origen es estable para la vida de la pagina (viene de la URL)
  }, []);

  async function handleCrear(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const validacion = validarFormularioCrearAccion(form);
    if (!validacion.ok) {
      setErrorForm(validacion.error);
      return;
    }

    setErrorForm(null);
    setGuardando(true);
    // Correccion de ronda de revision (bloqueante 1): el body YA NO
    // declara ruleVersionOrigen/prioridadOrigen -- el servidor los
    // deriva el mismo (ver derivarOrigenActual.ts), volviendo a correr
    // el analisis sobre el origen actual en vez de confiar en lo que
    // esta pagina calculo antes de que el usuario termine de completar
    // el formulario.
    const resultado = await fetchJsonSeguro<RespuestaAccion>("/api/kpis/acciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origen,
        descripcionAccion: form.descripcionAccion.trim(),
        responsableId: form.responsableId,
        fechaObjetivo: form.fechaObjetivo,
      }),
    });
    setGuardando(false);

    if (!resultado.ok) {
      setErrorForm(mensajeParaError(resultado.error));
      return;
    }

    setForm({ descripcionAccion: "", responsableId: "", fechaObjetivo: "" });
    setMostrarFormulario(false);
    await cargarAcciones();
  }

  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <div className="flex items-center justify-between">
        <p className="font-medium">Acciones de decisión</p>
        {puedeRegistrar && !mostrarFormulario && (
          <button
            type="button"
            onClick={() => setMostrarFormulario(true)}
            className="rounded bg-amber-900 px-2 py-1 text-xs text-white"
          >
            Registrar acción
          </button>
        )}
      </div>

      {recomendacionActual && (
        <p className="mt-1 text-amber-800">
          Siguiente acción propuesta: <span className="italic">{recomendacionActual.descripcionSugerida}</span>
        </p>
      )}

      {!puedeRegistrar && (
        <p className="mt-1 text-amber-700">El análisis actual no sugiere registrar una acción nueva.</p>
      )}

      {puedeRegistrar && mostrarFormulario && (
        <form onSubmit={handleCrear} className="mt-3 flex flex-col gap-2 rounded border border-amber-300 bg-white p-3">
          <label className="flex flex-col gap-1">
            Descripción
            <textarea
              value={form.descripcionAccion}
              onChange={(e) => setForm((f) => ({ ...f, descripcionAccion: e.target.value }))}
              rows={2}
              className="rounded border border-slate-300 px-2 py-1 text-slate-800"
            />
          </label>
          <label className="flex flex-col gap-1">
            Responsable
            <select
              value={form.responsableId}
              onChange={(e) => setForm((f) => ({ ...f, responsableId: e.target.value }))}
              className="rounded border border-slate-300 px-2 py-1 text-slate-800"
            >
              <option value="">Elegí un responsable...</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre} ({u.email})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Fecha objetivo
            <input
              type="date"
              value={form.fechaObjetivo}
              onChange={(e) => setForm((f) => ({ ...f, fechaObjetivo: e.target.value }))}
              className="rounded border border-slate-300 px-2 py-1 text-slate-800"
            />
          </label>
          {errorForm && <p className="text-red-600">{errorForm}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={guardando} className="rounded bg-amber-900 px-3 py-1 text-white disabled:opacity-50">
              {guardando ? "Guardando..." : "Guardar acción"}
            </button>
            <button type="button" onClick={() => setMostrarFormulario(false)} className="rounded border border-slate-300 px-3 py-1 text-slate-600">
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="mt-3">
        {errorCarga && <p className="text-red-600">{errorCarga}</p>}
        {!errorCarga && acciones === null && <p className="text-amber-700">Cargando historial de acciones...</p>}
        {!errorCarga && acciones !== null && acciones.length === 0 && (
          <p className="text-amber-700">Todavía no se registró ninguna acción para este resultado.</p>
        )}
        {!errorCarga && acciones !== null && acciones.length > 0 && (
          <ul className="flex flex-col gap-2">
            {acciones.map((accion) => (
              <FilaAccion key={accion.id} accion={accion} usuarios={usuarios} onCambiada={cargarAcciones} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FilaAccion({
  accion,
  usuarios,
  onCambiada,
}: {
  accion: AccionApi;
  usuarios: UsuarioCandidato[];
  onCambiada: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [nuevoEstado, setNuevoEstado] = useState<EstadoAccionKpi | "">("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const siguientes = estadosSiguientesPosibles(accion.estado);

  async function handleCambiarEstado() {
    if (!nuevoEstado) return;
    setError(null);
    setGuardando(true);
    const resultado = await fetchJsonSeguro<RespuestaAccion>(`/api/kpis/acciones/${accion.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: nuevoEstado }),
    });
    setGuardando(false);

    if (!resultado.ok) {
      setError(mensajeParaError(resultado.error));
      return;
    }

    setEditando(false);
    setNuevoEstado("");
    await onCambiada();
  }

  return (
    <li className="rounded border border-amber-200 bg-white p-2 text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className={"rounded px-2 py-0.5 text-xs font-medium " + ESTILO_ESTADO_ACCION[accion.estado]}>
          {ETIQUETA_ESTADO_ACCION[accion.estado]}
        </span>
        <span className={"rounded px-2 py-0.5 text-xs font-medium " + ESTILO_PRIORIDAD_ACCION[accion.prioridadOrigen]}>
          {ETIQUETA_PRIORIDAD_ACCION[accion.prioridadOrigen]}
        </span>
        <span className="text-xs text-slate-500">Objetivo: {formatearFecha(accion.fechaObjetivo)}</span>
      </div>
      <p className="mt-1">{accion.descripcionAccion}</p>
      <p className="mt-1 text-xs text-slate-500">
        Responsable: {nombreUsuario(usuarios, accion.responsableId)} · Creada por {nombreUsuario(usuarios, accion.creadaPorId)} el{" "}
        {formatearFecha(accion.createdAt)}
        {accion.finalizadaEn && accion.finalizadaPorId && (
          <>
            {" "}
            · Finalizada por {nombreUsuario(usuarios, accion.finalizadaPorId)} el {formatearFecha(accion.finalizadaEn)}
          </>
        )}
      </p>

      {siguientes.length > 0 && (
        <div className="mt-2">
          {!editando ? (
            <button type="button" onClick={() => setEditando(true)} className="text-xs text-amber-900 underline">
              Cambiar estado
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={nuevoEstado}
                onChange={(e) => setNuevoEstado(e.target.value as EstadoAccionKpi)}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-800"
              >
                <option value="">Elegí el nuevo estado...</option>
                {siguientes.map((estado) => (
                  <option key={estado} value={estado}>
                    {ETIQUETA_ESTADO_ACCION[estado]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCambiarEstado}
                disabled={guardando || !nuevoEstado}
                className="rounded bg-amber-900 px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                {guardando ? "Guardando..." : "Confirmar"}
              </button>
              <button type="button" onClick={() => setEditando(false)} className="text-xs text-slate-500 underline">
                Cancelar
              </button>
            </div>
          )}
          {error && <p className="mt-1 text-red-600">{error}</p>}
        </div>
      )}
    </li>
  );
}
