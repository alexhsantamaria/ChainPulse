// Componente — formulario publico de respuesta a una invitacion de RF36.
// Una sola pantalla (no el wizard de 7 pasos de la evaluacion expres v2:
// aca son a lo sumo 2-4 preguntas por alcance, RF37 ya las acota de
// antemano) con guardado explicito al tocar "Enviar". Cada select puede
// quedar sin responder ("Prefiero no responder" -> null), mismo criterio
// de minimalismo ya usado en ConexionForm.tsx ("Sin confirmar") -- RF38
// contempla un cuarto estado de comparacion, "sin respuesta suficiente",
// precisamente para no forzar una respuesta que el invitado no tiene.
"use client";

import { useState, type FormEvent } from "react";

interface RespuestaExistente {
  prioridadElegida: string | null;
  nodoCriticoId: string | null;
  conocimientoEntradasSalidas: string | null;
  momentoInformacion: string | null;
  fuenteDatos: string | null;
  tieneAlternativa: boolean | null;
  alternativaProbada: boolean | null;
}

function boolATexto(valor: boolean | null): "" | "si" | "no" {
  if (valor === true) return "si";
  if (valor === false) return "no";
  return "";
}

function textoABool(valor: string): boolean | null {
  if (valor === "si") return true;
  if (valor === "no") return false;
  return null;
}

const estiloSelect = "rounded border border-slate-300 px-3 py-2";
const estiloLabel = "flex flex-col gap-1 text-sm";

export default function ResponderCadenaForm({
  token,
  empresaNombre,
  cadenaNombre,
  alcanceTexto,
  nodos,
  esCadenaCompleta,
  respuestaExistente,
}: {
  token: string;
  empresaNombre: string;
  cadenaNombre: string;
  alcanceTexto: string;
  nodos: { id: string; nombre: string }[];
  esCadenaCompleta: boolean;
  respuestaExistente: RespuestaExistente | null;
}) {
  const [prioridadElegida, setPrioridadElegida] = useState(respuestaExistente?.prioridadElegida ?? "");
  const [nodoCriticoId, setNodoCriticoId] = useState(respuestaExistente?.nodoCriticoId ?? "");
  const [conocimientoEntradasSalidas, setConocimientoEntradasSalidas] = useState(
    respuestaExistente?.conocimientoEntradasSalidas ?? "",
  );
  const [momentoInformacion, setMomentoInformacion] = useState(respuestaExistente?.momentoInformacion ?? "");
  const [fuenteDatos, setFuenteDatos] = useState(respuestaExistente?.fuenteDatos ?? "");
  const [tieneAlternativa, setTieneAlternativa] = useState(boolATexto(respuestaExistente?.tieneAlternativa ?? null));
  const [alternativaProbada, setAlternativaProbada] = useState(
    boolATexto(respuestaExistente?.alternativaProbada ?? null),
  );

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);

    const respuesta = await fetch("/api/invitacion-cadena/responder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        prioridadElegida: prioridadElegida || null,
        nodoCriticoId: nodoCriticoId || null,
        conocimientoEntradasSalidas: conocimientoEntradasSalidas || null,
        momentoInformacion: momentoInformacion || null,
        fuenteDatos: fuenteDatos || null,
        tieneAlternativa: textoABool(tieneAlternativa),
        alternativaProbada: textoABool(alternativaProbada),
      }),
    });
    const resultado = await respuesta.json();
    setEnviando(false);

    if (!resultado.ok) {
      setError(
        resultado.error === "TOKEN_INVALIDO"
          ? "El enlace venció o ya no es válido. Pedile a quien te invitó que te mande uno nuevo."
          : "No se pudo guardar tu respuesta. Intentá de nuevo.",
      );
      return;
    }

    setEnviado(true);
  }

  if (enviado) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">¡Gracias!</h1>
        <p className="text-sm text-slate-600">
          Tu respuesta quedó registrada. Si necesitás corregir algo, podés volver a abrir este mismo enlace.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Tu percepción de la cadena</h1>
        <p className="text-sm text-slate-600">
          Te invitaron a responder sobre {alcanceTexto} de la cadena <strong>{cadenaNombre}</strong> en{" "}
          <strong>{empresaNombre}</strong>. No hace falta crear cuenta. Tus respuestas se comparan con las de
          otras personas invitadas para detectar diferencias de percepción — nunca para señalar quién tiene
          razón.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {esCadenaCompleta ? (
          <>
            <label className={estiloLabel}>
              ¿Cuál es el resultado más importante que esta cadena debe entregar al cliente?
              <select
                value={prioridadElegida}
                onChange={(e) => setPrioridadElegida(e.target.value)}
                className={estiloSelect}
              >
                <option value="">Prefiero no responder</option>
                <option value="DISPONIBILIDAD">Disponibilidad</option>
                <option value="RAPIDEZ">Rapidez</option>
                <option value="CUMPLIMIENTO_FECHA_CANTIDAD">Cumplimiento de fecha y cantidad</option>
                <option value="CALIDAD_CONSISTENCIA">Calidad y consistencia</option>
                <option value="PRECIO_EFICIENCIA">Precio o eficiencia</option>
                <option value="PERSONALIZACION">Personalización</option>
                <option value="CONTINUIDAD_INTERRUPCIONES">Continuidad ante interrupciones</option>
                <option value="NO_DEFINIDA">No está claramente definido</option>
              </select>
            </label>
            <label className={estiloLabel}>
              ¿Cuál es el nodo más crítico de esta cadena — aquel cuya falla causaría el mayor problema?
              <select
                value={nodoCriticoId}
                onChange={(e) => setNodoCriticoId(e.target.value)}
                className={estiloSelect}
              >
                <option value="">Prefiero no responder</option>
                {nodos.map((nodo) => (
                  <option key={nodo.id} value={nodo.id}>
                    {nodo.nombre}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className={estiloLabel}>
              ¿Sabés qué necesita recibir esta conexión, qué debe entregar y a quién afecta si no cumple?
              <select
                value={conocimientoEntradasSalidas}
                onChange={(e) => setConocimientoEntradasSalidas(e.target.value)}
                className={estiloSelect}
              >
                <option value="">Prefiero no responder</option>
                <option value="DEFINIDO_Y_USADO">Sí, está definido y se utiliza</option>
                <option value="CLARO_PARA_ALGUNAS_AREAS">Está claro para algunas áreas</option>
                <option value="DEPENDE_DE_PERSONAS">Depende de la experiencia de ciertas personas</option>
                <option value="NO_CLARO">No está claro</option>
                <option value="NO_SABE">No lo sé</option>
              </select>
            </label>
            <label className={estiloLabel}>
              ¿Con cuánta anticipación te llega la información necesaria para esta conexión?
              <select
                value={momentoInformacion}
                onChange={(e) => setMomentoInformacion(e.target.value)}
                className={estiloSelect}
              >
                <option value="">Prefiero no responder</option>
                <option value="CORTO">Corto (menos de 24 horas)</option>
                <option value="MEDIO">Medio (entre 24 horas y 1 semana)</option>
                <option value="LARGO">Largo (más de 1 semana)</option>
              </select>
            </label>
            <label className={estiloLabel}>
              ¿Cuál es la fuente principal que usan hoy para esa información?
              <select value={fuenteDatos} onChange={(e) => setFuenteDatos(e.target.value)} className={estiloSelect}>
                <option value="">Prefiero no responder</option>
                <option value="SAP_ERP">SAP / ERP</option>
                <option value="EXCEL">Excel</option>
                <option value="WMS_TMS_APS">WMS / TMS / APS</option>
                <option value="CORREO_MENSAJERIA">Correo / mensajería</option>
                <option value="VARIOS_SISTEMAS">Varios sistemas</option>
                <option value="SIN_FUENTE_DEFINIDA">Sin fuente definida</option>
              </select>
            </label>
            <label className={estiloLabel}>
              ¿Existe una alternativa o sustituto para esta conexión?
              <select
                value={tieneAlternativa}
                onChange={(e) => {
                  setTieneAlternativa(e.target.value as "" | "si" | "no");
                  if (e.target.value !== "si") setAlternativaProbada("");
                }}
                className={estiloSelect}
              >
                <option value="">Prefiero no responder</option>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </label>
            {tieneAlternativa === "si" && (
              <label className={estiloLabel}>
                ¿Esa alternativa fue probada alguna vez?
                <select
                  value={alternativaProbada}
                  onChange={(e) => setAlternativaProbada(e.target.value as "" | "si" | "no")}
                  className={estiloSelect}
                >
                  <option value="">Prefiero no responder</option>
                  <option value="si">Sí</option>
                  <option value="no">No</option>
                </select>
              </label>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={enviando}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {enviando ? "Enviando..." : "Enviar mis respuestas"}
        </button>
      </form>
    </main>
  );
}
