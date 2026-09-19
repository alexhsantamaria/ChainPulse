// Componente cliente — el cuestionario de 7 pasos de la evaluacion expres
// v2 (V2 Sec. 7.3): una pregunta por pantalla, una seleccion por toque,
// avance automatico, boton Atras, progreso "n de 7" y guardado automatico
// (cada respuesta se persiste en el servidor via POST .../answers, que ya
// es idempotente por diseño -- volver atras y cambiar una respuesta no
// crea filas duplicadas).
//
// Guardado OPTIMISTA (2026-09-19, feedback de Alex tras la primera prueba
// en Windows: cada toque se sentia lento porque esperaba 2-3 consultas a
// Neon antes de avanzar). Ahora cada tap avanza de inmediato -- la
// respuesta se guarda local (sessionStorage) al toque y el POST a
// .../answers se dispara en segundo plano, sin bloquear la UI. Antes de
// llamar a POST .../complete en el ultimo paso se espera (Promise.allSettled)
// a que TODOS los guardados en segundo plano hayan terminado, para que el
// servidor vea el set completo de respuestas; si alguno realmente fallo,
// /complete responde PREGUNTAS_INCOMPLETAS y el flujo ya sabe volver a esa
// pregunta puntual (ver mas abajo) -- la correctitud no se sacrifica, solo
// se deja de bloquear la UI en el camino feliz (la inmensa mayoria de los
// casos).
//
// La subpregunta no puntuable de Q5 ("fuente principal") se agrupa en el
// mismo paso que su pregunta principal en vez de contar como un paso
// aparte, para que el contador siga siendo "n de 7" aunque el API
// devuelva 8 PreguntaVersion. La agrupacion es generica (cualquier
// pregunta esNoPuntuable se cuelga de la anterior), no un caso especial
// de "Q5" a mano.
//
// No existe un endpoint publico para releer las preguntas de una
// evaluacion ya creada -- si no hay progreso guardado en este navegador
// (sessionStorage, ver lib/evaluacionExpres/storage.ts) para este id, se
// muestra un mensaje para empezar de nuevo en vez de inventar una copia
// duplicada del cuestionario en el cliente (ver claude/lecciones-aprendidas.md
// sobre el riesgo de mantener dos copias del mismo contenido que se
// puedan desalinear).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completarEvaluacion, enviarRespuesta } from "@/lib/evaluacionExpres/api";
import { mensajeError } from "@/lib/evaluacionExpres/etiquetas";
import {
  guardarRespuestaLocal,
  leerProgreso,
  type ProgresoEvaluacion,
  type RespuestaLocal,
} from "@/lib/evaluacionExpres/storage";
import type { OpcionPreguntaPublica, PreguntaPublica } from "@/lib/evaluacionExpres/tipos";

interface Paso {
  principal: PreguntaPublica;
  sub?: PreguntaPublica;
}

function construirPasos(preguntas: PreguntaPublica[]): Paso[] {
  const ordenadas = [...preguntas].sort((a, b) => a.orden - b.orden);
  const pasos: Paso[] = [];
  for (const pregunta of ordenadas) {
    const anterior = pasos[pasos.length - 1];
    if (pregunta.esNoPuntuable && anterior) {
      anterior.sub = pregunta;
      continue;
    }
    pasos.push({ principal: pregunta });
  }
  return pasos;
}

function primerPasoPendiente(pasos: Paso[], respuestas: Record<string, RespuestaLocal>): number {
  for (let i = 0; i < pasos.length; i++) {
    const paso = pasos[i];
    if (!paso) continue;
    const faltaPrincipal = !respuestas[paso.principal.codigo];
    const faltaSub = paso.sub !== undefined && !respuestas[paso.sub.codigo];
    if (faltaPrincipal || faltaSub) return i;
  }
  return Math.max(0, pasos.length - 1);
}

export default function CuestionarioForm({ evaluacionId }: { evaluacionId: string }) {
  const router = useRouter();
  const [progreso, setProgreso] = useState<ProgresoEvaluacion | null | undefined>(undefined);
  const [indice, setIndice] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guardia sincrona (ref, no state) contra un doble-tap sobre la MISMA
  // pregunta mientras el guardado optimista avanza el paso -- un `useState`
  // no sirve aca porque su actualizacion no es sincrona dentro del mismo
  // evento de click. Se libera cuando cambia `indice` (nueva pregunta).
  const bloqueadoRef = useRef(false);
  useEffect(() => {
    bloqueadoRef.current = false;
  }, [indice]);

  // Guardados en segundo plano todavia sin resolver -- se esperan todos
  // (Promise.allSettled) antes de pedir POST .../complete en el ultimo
  // paso, para que el servidor vea el set completo de respuestas.
  const pendientesRef = useRef<Promise<unknown>[]>([]);

  useEffect(() => {
    const guardado = leerProgreso(evaluacionId);
    setProgreso(guardado);
    if (guardado) {
      setIndice(primerPasoPendiente(construirPasos(guardado.preguntas), guardado.respuestas));
    }
  }, [evaluacionId]);

  const pasos = useMemo(() => (progreso ? construirPasos(progreso.preguntas) : []), [progreso]);
  const paso = pasos[indice];

  if (progreso === undefined || (progreso && !paso)) {
    return <EstadoCarga />;
  }
  if (progreso === null) {
    return <EvaluacionNoDisponible />;
  }
  if (!paso) {
    return <EstadoCarga />;
  }

  // TS no propaga el narrowing de `paso` (ya garantizado no-undefined por
  // los guards de arriba) hacia las funciones anidadas de abajo -- este
  // alias const si conserva el tipo estrecho dentro de sus cierres.
  const pasoActual = paso;

  const respuestas = progreso.respuestas;
  const respuestaPrincipal = respuestas[paso.principal.codigo];
  const respuestaSub = paso.sub ? respuestas[paso.sub.codigo] : undefined;

  async function avanzar() {
    if (indice < pasos.length - 1) {
      setIndice((i) => i + 1);
      return;
    }
    setEnviando(true);
    // Espera a que todo guardado en segundo plano haya terminado (exito o
    // error) antes de pedir el calculo -- sin esto, la ultima respuesta
    // podria seguir en vuelo cuando el servidor ya esta armando el
    // diagnostico.
    await Promise.allSettled(pendientesRef.current);
    const resultado = await completarEvaluacion(evaluacionId);
    setEnviando(false);
    if (!resultado.ok) {
      if (resultado.error === "PREGUNTAS_INCOMPLETAS" && resultado.preguntasFaltantes?.length) {
        const codigoFaltante = resultado.preguntasFaltantes[0];
        const indiceFaltante = pasos.findIndex(
          (p) => p.principal.codigo === codigoFaltante || p.sub?.codigo === codigoFaltante,
        );
        if (indiceFaltante >= 0) {
          setIndice(indiceFaltante);
          setError("Una respuesta no llegó a guardarse. Vuelve a seleccionarla para continuar.");
          return;
        }
      }
      setError(mensajeError(resultado.error));
      return;
    }
    router.push(`/evaluacion/${evaluacionId}/resultado`);
  }

  function elegirOpcionPrincipal(valor: string) {
    if (bloqueadoRef.current) return;
    bloqueadoRef.current = true;
    setError(null);

    // Optimista: guarda local y avanza de inmediato, sin esperar la red.
    guardarRespuestaLocal(evaluacionId, pasoActual.principal.codigo, { opcionValor: valor });
    setProgreso((anterior) =>
      anterior
        ? { ...anterior, respuestas: { ...anterior.respuestas, [pasoActual.principal.codigo]: { opcionValor: valor } } }
        : anterior,
    );

    const guardado = enviarRespuesta(evaluacionId, { codigoPregunta: pasoActual.principal.codigo, opcionValor: valor }).then(
      (resultado) => {
        if (!resultado.ok) {
          setError(mensajeError(resultado.error));
        }
      },
    );
    pendientesRef.current.push(guardado);

    if (!pasoActual.sub) {
      void avanzar();
    }
  }

  function elegirOpcionSub(opcion: OpcionPreguntaPublica) {
    const sub = pasoActual.sub;
    if (bloqueadoRef.current || !sub) return;
    bloqueadoRef.current = true;
    setError(null);

    guardarRespuestaLocal(evaluacionId, sub.codigo, { contextoLibre: opcion.texto });
    setProgreso((anterior) =>
      anterior
        ? { ...anterior, respuestas: { ...anterior.respuestas, [sub.codigo]: { contextoLibre: opcion.texto } } }
        : anterior,
    );

    const guardado = enviarRespuesta(evaluacionId, { codigoPregunta: sub.codigo, contextoLibre: opcion.texto }).then(
      (resultado) => {
        if (!resultado.ok) {
          setError(mensajeError(resultado.error));
        }
      },
    );
    pendientesRef.current.push(guardado);

    void avanzar();
  }

  function retroceder() {
    setError(null);
    setIndice((i) => Math.max(0, i - 1));
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 py-10">
      <ProgresoPreguntas indice={indice} total={pasos.length} />

      <div aria-live="polite" className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-3" disabled={enviando}>
          <legend className="text-lg font-semibold text-slate-900">{paso.principal.texto}</legend>
          <div role="radiogroup" aria-label={paso.principal.texto} className="flex flex-col gap-2">
            {[...paso.principal.opciones]
              .sort((a, b) => a.orden - b.orden)
              .map((opcion) => (
                <OpcionBoton
                  key={opcion.valor}
                  texto={opcion.texto}
                  seleccionada={respuestaPrincipal?.opcionValor === opcion.valor}
                  onSeleccionar={() => elegirOpcionPrincipal(opcion.valor)}
                />
              ))}
          </div>
        </fieldset>

        {paso.sub && respuestaPrincipal && (
          <fieldset className="flex flex-col gap-3 border-t border-slate-200 pt-6" disabled={enviando}>
            <legend className="text-base font-medium text-slate-700">{paso.sub.texto}</legend>
            <div role="radiogroup" aria-label={paso.sub.texto} className="flex flex-col gap-2">
              {[...paso.sub.opciones]
                .sort((a, b) => a.orden - b.orden)
                .map((opcion) => (
                  <OpcionBoton
                    key={opcion.valor}
                    texto={opcion.texto}
                    seleccionada={respuestaSub?.contextoLibre === opcion.texto}
                    onSeleccionar={() => elegirOpcionSub(opcion)}
                  />
                ))}
            </div>
          </fieldset>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={retroceder}
          disabled={indice === 0 || enviando}
          className="text-sm text-slate-500 underline disabled:opacity-0"
        >
          Atrás
        </button>
        <p className="text-right text-xs text-slate-400">
          {enviando ? "Calculando tu resultado..." : "Esto refleja tu percepción individual, no un dato verificado."}
        </p>
      </div>
    </main>
  );
}

function ProgresoPreguntas({ indice, total }: { indice: number; total: number }) {
  const porcentaje = total > 0 ? Math.round(((indice + 1) / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-slate-500">
        Pregunta {indice + 1} de {total}
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-slate-900 transition-all" style={{ width: `${porcentaje}%` }} />
      </div>
    </div>
  );
}

function OpcionBoton({
  texto,
  seleccionada,
  onSeleccionar,
}: {
  texto: string;
  seleccionada: boolean;
  onSeleccionar: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={seleccionada}
      onClick={onSeleccionar}
      className={`rounded border px-4 py-3 text-left text-sm transition-colors ${
        seleccionada
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-300 bg-white text-slate-900 hover:border-slate-400"
      }`}
    >
      {texto}
    </button>
  );
}

function EstadoCarga() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4">
      <p className="text-sm text-slate-500">Cargando...</p>
    </main>
  );
}

function EvaluacionNoDisponible() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Esta evaluación no está disponible aquí</h1>
      <p className="text-sm text-slate-600">
        Solo se puede continuar desde el mismo navegador donde la empezaste. Puedes comenzar una nueva.
      </p>
      <Link href="/evaluacion" className="rounded bg-slate-900 px-4 py-2 text-sm text-white">
        Comenzar evaluación
      </Link>
    </main>
  );
}
