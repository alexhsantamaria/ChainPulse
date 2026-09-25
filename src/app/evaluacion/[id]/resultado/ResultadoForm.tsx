// Componente cliente — resultado de la evaluacion expres v2 (RF12/RF13,
// V2 Sec. 8): 5 hallazgos por dimension, ya priorizados por el servidor
// (GET .../result nunca recalcula, ver ADR-0001). Sin correo no se ve mas
// que el macro (dimension/status/statement); el formulario de desbloqueo
// llama a POST .../unlock con los textos de consentimiento EXACTOS de
// src/infra/public/textoConsentimiento.ts (no se reescriben aqui, para
// que el snapshot que persiste el servidor coincida siempre con lo que
// el visitante realmente leyo).
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { desbloquearDetalle, obtenerResultado } from "@/lib/evaluacionExpres/api";
import { etiquetaDimension, etiquetaEstadoEvidencia, mensajeError } from "@/lib/evaluacionExpres/etiquetas";
import {
  TEXTO_CONSENTIMIENTO_DIAGNOSTICO,
  TEXTO_CONSENTIMIENTO_INVESTIGACION,
} from "@/infra/public/textoConsentimiento";
import type { HallazgoDetalle, HallazgoMacro } from "@/lib/evaluacionExpres/tipos";
import {
  banderaPais,
  PAIS_TELEFONO_DEFECTO,
  PAISES_TELEFONO,
  paisTelefonoPorCodigo,
} from "@/lib/evaluacionExpres/paisesTelefono";

type EstadoResultado =
  | { fase: "cargando" }
  | { fase: "error"; codigo: string }
  | { fase: "listo"; detalleDesbloqueado: boolean; hallazgos: HallazgoMacro[] | HallazgoDetalle[] };

function esDetalle(h: HallazgoMacro | HallazgoDetalle): h is HallazgoDetalle {
  return "evidenceState" in h;
}

export default function ResultadoForm({ evaluacionId }: { evaluacionId: string }) {
  const [estado, setEstado] = useState<EstadoResultado>({ fase: "cargando" });
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  const cargar = useCallback(async () => {
    setEstado({ fase: "cargando" });
    const resultado = await obtenerResultado(evaluacionId);
    if (!resultado.ok) {
      setEstado({ fase: "error", codigo: resultado.error });
      return;
    }
    setEstado({
      fase: "listo",
      detalleDesbloqueado: resultado.datos.detalleDesbloqueado,
      hallazgos: resultado.datos.hallazgos,
    });
  }, [evaluacionId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (estado.fase === "cargando") {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4">
        <p className="text-sm text-slate-500">Calculando tu primer plano...</p>
      </main>
    );
  }

  if (estado.fase === "error") {
    const puedeContinuar = estado.codigo === "EVALUACION_NO_COMPLETADA";
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">No pudimos mostrar tu resultado</h1>
        <p className="text-sm text-slate-600">{mensajeError(estado.codigo)}</p>
        {puedeContinuar ? (
          <Link href={`/evaluacion/${evaluacionId}`} className="rounded bg-slate-900 px-4 py-2 text-sm text-white">
            Continuar evaluación
          </Link>
        ) : (
          <Link href="/evaluacion" className="rounded bg-slate-900 px-4 py-2 text-sm text-white">
            Comenzar de nuevo
          </Link>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">Tu primer plano preliminar</h1>
        <p className="text-sm text-slate-500">
          Esto refleja lo que declaraste, no un dato verificado de forma independiente.
        </p>
      </header>

      <ol className="flex flex-col gap-4">
        {estado.hallazgos.map((hallazgo, indice) => (
          <li key={`${hallazgo.dimension}-${indice}`} className="rounded border border-slate-200 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {etiquetaDimension(hallazgo.dimension)}
            </p>
            <p className="mt-1 text-sm text-slate-900">{hallazgo.statement}</p>
            {esDetalle(hallazgo) && (
              <dl className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <div className="flex justify-between gap-2">
                  <dt>Estado de la evidencia</dt>
                  <dd>{etiquetaEstadoEvidencia(hallazgo.evidenceState)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Cobertura</dt>
                  <dd>{Math.round(hallazgo.confidenceCoverage * 100)}%</dd>
                </div>
                {hallazgo.missingEvidence.length > 0 && (
                  <div>
                    <dt>Falta comprobar</dt>
                    <dd>{hallazgo.missingEvidence.join(" · ")}</dd>
                  </div>
                )}
                {hallazgo.nextCheck && (
                  <div>
                    <dt>Siguiente verificación</dt>
                    <dd>{hallazgo.nextCheck}</dd>
                  </div>
                )}
              </dl>
            )}
          </li>
        ))}
      </ol>

      {!estado.detalleDesbloqueado &&
        (mostrarFormulario ? (
          <FormularioDesbloqueo evaluacionId={evaluacionId} onDesbloqueado={cargar} />
        ) : (
          <button
            type="button"
            onClick={() => setMostrarFormulario(true)}
            className="rounded bg-slate-900 px-4 py-3 text-sm text-white"
          >
            Ver diagnóstico completo
          </button>
        ))}

      <Link href="/" className="text-center text-sm text-slate-500 underline">
        Volver a la página principal
      </Link>
    </main>
  );
}

function FormularioDesbloqueo({
  evaluacionId,
  onDesbloqueado,
}: {
  evaluacionId: string;
  onDesbloqueado: () => void;
}) {
  const [correo, setCorreo] = useState("");
  const [nombreCompleto, setNombreCompleto] = useState("");
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [codigoPaisTelefono, setCodigoPaisTelefono] = useState(PAIS_TELEFONO_DEFECTO);
  const [aceptaDiagnostico, setAceptaDiagnostico] = useState(false);
  const [aceptaInvestigacion, setAceptaInvestigacion] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!aceptaDiagnostico) return;
    setEnviando(true);
    setError(null);
    const telefonoRecortado = telefono.trim();
    const indicativoPais = paisTelefonoPorCodigo(codigoPaisTelefono)?.indicativo ?? "";
    const resultado = await desbloquearDetalle(evaluacionId, {
      correo,
      nombreCompleto,
      empresaNombre,
      telefono: telefonoRecortado ? `${indicativoPais} ${telefonoRecortado}` : undefined,
      consentimientoDiagnostico: true,
      consentimientoInvestigacion: aceptaInvestigacion,
    });
    setEnviando(false);
    if (!resultado.ok) {
      setError(mensajeError(resultado.error));
      return;
    }
    onDesbloqueado();
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4 rounded border border-slate-200 p-4">
      <h2 className="text-base font-semibold text-slate-900">Recibe el diagnóstico completo</h2>
      <label className="flex flex-col gap-1 text-sm">
        Nombre completo
        <input
          type="text"
          required
          value={nombreCompleto}
          onChange={(e) => setNombreCompleto(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Correo
        <input
          type="email"
          required
          autoComplete="email"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Empresa
        <input
          type="text"
          required
          value={empresaNombre}
          onChange={(e) => setEmpresaNombre(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="telefono-numero">Teléfono (opcional)</label>
        <div className="flex gap-2">
          <select
            value={codigoPaisTelefono}
            onChange={(e) => setCodigoPaisTelefono(e.target.value)}
            aria-label="Código de país del teléfono"
            className="w-28 shrink-0 rounded border border-slate-300 px-2 py-2 text-sm"
          >
            {PAISES_TELEFONO.map((pais) => (
              <option key={pais.codigoIso2} value={pais.codigoIso2}>
                {banderaPais(pais.codigoIso2)} {pais.indicativo}
              </option>
            ))}
          </select>
          <input
            id="telefono-numero"
            type="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="987 654 321"
            className="flex-1 rounded border border-slate-300 px-3 py-2"
          />
        </div>
      </div>
      <label className="flex items-start gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          required
          checked={aceptaDiagnostico}
          onChange={(e) => setAceptaDiagnostico(e.target.checked)}
          className="mt-0.5"
        />
        {TEXTO_CONSENTIMIENTO_DIAGNOSTICO}
      </label>
      <label className="flex items-start gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={aceptaInvestigacion}
          onChange={(e) => setAceptaInvestigacion(e.target.checked)}
          className="mt-0.5"
        />
        {TEXTO_CONSENTIMIENTO_INVESTIGACION}
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={enviando || !aceptaDiagnostico}
        className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {enviando ? "Enviando..." : "Ver diagnóstico completo"}
      </button>
    </form>
  );
}
