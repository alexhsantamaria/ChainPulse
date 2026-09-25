// Componente (cliente) -- asistente de 3 pasos para importar Cobertura
// por CSV (Incremento 4 Bloque B, vertical slice). Un solo KPI de punta
// a punta antes de generalizar a los otros 9 (Alex, 2026-09-25).
//
// Pasos: 1) subir archivo -> 2) revisar mapeo/estrategia/contexto de
// consumo + vista previa de retiro -> 3) confirmar. Cada paso llama
// exactamente a la ruta que ya existe (nunca inventa un endpoint nuevo):
// POST /api/kpis/cobertura/importaciones (subir) y
// POST .../[id]/confirmar (dos veces -- soloVistaPrevia:true para el
// paso 2, soloVistaPrevia:false para confirmar de verdad).
"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchJsonSeguro, type RespuestaApiBase } from "@/infra/http/fetchJsonSeguro";
import { CAMPOS_COBERTURA_CSV, type MapeoColumnasCobertura, type CampoCoberturaCsv } from "@/domain/mapeoColumnasCsv";

interface CadenaOpcion {
  id: string;
  nombre: string;
}

interface ColumnaSospechosaUI {
  encabezado: string;
  campo: string;
}

interface CandidataRetiroUI {
  id: string;
  sku: string;
  ubicacion: string;
  fechaCorte: string;
}

const MAPEO_VACIO: MapeoColumnasCobertura = {
  sku: null,
  ubicacion: null,
  fechaCorte: null,
  inventarioDisponible: null,
  unidadInventario: null,
  consumoDiarioEsperado: null,
  unidadConsumoDiario: null,
};

interface RespuestaSubida extends RespuestaApiBase {
  importId?: string;
  encabezados?: string[];
  mapeoPropuesto?: MapeoColumnasCobertura;
  columnasSospechosasDeConsumo?: ColumnaSospechosaUI[];
  filasDetectadas?: number;
  muestra?: Record<string, string>[];
  mensaje?: string;
}

interface RespuestaConfirmar extends RespuestaApiBase {
  importId?: string;
  vistaPrevia?: boolean;
  yaConfirmada?: boolean;
  candidatasRetiro?: CandidataRetiroUI[];
  retiroHash?: string | null;
  mensaje?: string;
}

// Mensajes por codigo de error -- la API los devuelve como string estable
// (ver confirmar/route.ts), acá solo se traducen a texto para el usuario.
const MENSAJE_ERROR_CONFIRMAR: Record<string, string> = {
  DATOS_INVALIDOS: "Faltan datos o hay un valor invalido -- revisá el formulario.",
  MAPEO_INVALIDO: "El mapeo de columnas no coincide con el archivo. Revisá que cada campo apunte a una columna real.",
  COLUMNAS_SOSPECHOSAS_SIN_RESOLVER: "El archivo trae columnas que parecen fuente/período de consumo -- reconocelas antes de seguir.",
  ERROR_LEYENDO_ARCHIVO: "No se pudo volver a leer el archivo original. Intentá de nuevo en un momento.",
  METADATA_CIFRADO_INCOMPLETA: "La importación quedó con datos incompletos -- subí el archivo de nuevo.",
  DEBE_CONFIRMAR_RETIRO: "Tenés que revisar y confirmar explícitamente los registros que se van a retirar.",
  RETIRO_DESACTUALIZADO: "Los datos cambiaron desde la vista previa -- revisá la lista de retiro de nuevo antes de confirmar.",
  YA_CONFIRMADA_CON_OTROS_VALORES: "Esta importación ya fue confirmada con otros valores -- no se puede reconfirmar. Subí un archivo nuevo si necesitás corregir algo.",
  ESTADO_NO_CONFIRMABLE: "Esta importación ya no se puede confirmar desde acá.",
  IMPORTACION_INEXISTENTE: "No se encontró la importación.",
  NO_SE_PUDO_CONFIRMAR: "No se pudo guardar la confirmación. Volvé a intentar.",
  ERROR_INTERNO: "Ocurrió un error inesperado. Intentá de nuevo.",
  ERROR_RED: "No se pudo conectar. Revisá tu conexión e intentá de nuevo.",
};

function mensajeError(resultado: RespuestaApiBase & { mensaje?: string }): string {
  if (resultado.mensaje) return resultado.mensaje;
  const codigo = typeof resultado.error === "string" ? resultado.error : "ERROR_INTERNO";
  return MENSAJE_ERROR_CONFIRMAR[codigo] ?? "No se pudo completar la operación. Intentá de nuevo.";
}

function formatearFecha(fechaISO: string): string {
  return new Date(fechaISO).toLocaleDateString("es-PE", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}

export default function ImportadorCoberturaWizard({ cadenas }: { cadenas: CadenaOpcion[] }) {
  const router = useRouter();
  const enviandoRef = useRef(false);

  const [paso, setPaso] = useState<"subir" | "revisar" | "resultado">("subir");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Paso 1 -- subir.
  const [cadenaId, setCadenaId] = useState(cadenas[0]?.id ?? "");
  const [archivo, setArchivo] = useState<File | null>(null);

  // Datos que devuelve la subida (fijos durante el resto del asistente).
  const [importId, setImportId] = useState<string | null>(null);
  const [encabezados, setEncabezados] = useState<string[]>([]);
  const [muestra, setMuestra] = useState<Record<string, string>[]>([]);
  const [filasDetectadas, setFilasDetectadas] = useState(0);
  const [columnasSospechosas, setColumnasSospechosas] = useState<ColumnaSospechosaUI[]>([]);

  // Paso 2 -- editable por el usuario.
  const [mapeo, setMapeo] = useState<MapeoColumnasCobertura>(MAPEO_VACIO);
  const [columnasReconocidas, setColumnasReconocidas] = useState<Set<string>>(new Set());
  const [fuenteConsumo, setFuenteConsumo] = useState("");
  const [periodoInicio, setPeriodoInicio] = useState("");
  const [periodoFin, setPeriodoFin] = useState("");
  const [estrategia, setEstrategia] = useState<"CARGA_PARCIAL" | "REEMPLAZO_ALCANCE">("CARGA_PARCIAL");
  const [alcanceInicio, setAlcanceInicio] = useState("");
  const [alcanceFin, setAlcanceFin] = useState("");
  const [alcanceUbicacionesTexto, setAlcanceUbicacionesTexto] = useState("");

  // Vista previa de retiro (se recalcula cada vez que se pide -- nunca
  // se confía en una vista previa vieja al confirmar, ver retiroHash).
  const [candidatasRetiro, setCandidatasRetiro] = useState<CandidataRetiroUI[] | null>(null);
  const [retiroHash, setRetiroHash] = useState<string | null>(null);
  const [confirmarRetiro, setConfirmarRetiro] = useState(false);

  const [resultadoImportId, setResultadoImportId] = useState<string | null>(null);
  const [yaConfirmadaAntes, setYaConfirmadaAntes] = useState(false);

  const alcanceUbicaciones = alcanceUbicacionesTexto
    .split(",")
    .map((u) => u.trim().toUpperCase())
    .filter((u) => u.length > 0);

  async function handleSubir(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoRef.current || !archivo || !cadenaId) return;
    enviandoRef.current = true;
    setError(null);
    setCargando(true);
    try {
      const formData = new FormData();
      formData.set("cadenaId", cadenaId);
      formData.set("archivo", archivo);
      const resultado = await fetchJsonSeguro<RespuestaSubida>("/api/kpis/cobertura/importaciones", {
        method: "POST",
        body: formData,
      });
      if (!resultado.ok || !resultado.importId) {
        setError(mensajeError(resultado));
        return;
      }
      setImportId(resultado.importId);
      setEncabezados(resultado.encabezados ?? []);
      setMuestra(resultado.muestra ?? []);
      setFilasDetectadas(resultado.filasDetectadas ?? 0);
      setColumnasSospechosas(resultado.columnasSospechosasDeConsumo ?? []);
      setMapeo(resultado.mapeoPropuesto ?? MAPEO_VACIO);
      setColumnasReconocidas(new Set());
      setCandidatasRetiro(null);
      setRetiroHash(null);
      setConfirmarRetiro(false);
      setPaso("revisar");
    } finally {
      setCargando(false);
      enviandoRef.current = false;
    }
  }

  function construirBodyConfirmar(soloVistaPrevia: boolean) {
    return {
      mapeoColumnas: mapeo,
      columnasSospechosasReconocidas: [...columnasReconocidas],
      estrategia,
      alcanceFechaCorteInicio: estrategia === "REEMPLAZO_ALCANCE" ? alcanceInicio || null : null,
      alcanceFechaCorteFin: estrategia === "REEMPLAZO_ALCANCE" ? alcanceFin || null : null,
      alcanceUbicaciones: estrategia === "REEMPLAZO_ALCANCE" ? alcanceUbicaciones : null,
      confirmarRetiro,
      retiroHash,
      fuenteConsumo,
      periodoReferenciaConsumoInicio: periodoInicio,
      periodoReferenciaConsumoFin: periodoFin,
      soloVistaPrevia,
    };
  }

  async function handleVerVistaPrevia() {
    if (enviandoRef.current || !importId) return;
    enviandoRef.current = true;
    setError(null);
    setCargando(true);
    try {
      const resultado = await fetchJsonSeguro<RespuestaConfirmar>(`/api/kpis/cobertura/importaciones/${importId}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(construirBodyConfirmar(true)),
      });
      if (!resultado.ok) {
        setError(mensajeError(resultado));
        return;
      }
      setCandidatasRetiro(resultado.candidatasRetiro ?? []);
      setRetiroHash(resultado.retiroHash ?? null);
      setConfirmarRetiro(false);
    } finally {
      setCargando(false);
      enviandoRef.current = false;
    }
  }

  async function handleConfirmar() {
    if (enviandoRef.current || !importId) return;
    if (estrategia === "REEMPLAZO_ALCANCE" && (candidatasRetiro === null || !confirmarRetiro)) return;
    enviandoRef.current = true;
    setError(null);
    setCargando(true);
    try {
      const resultado = await fetchJsonSeguro<RespuestaConfirmar>(`/api/kpis/cobertura/importaciones/${importId}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(construirBodyConfirmar(false)),
      });
      if (!resultado.ok) {
        if (resultado.error === "RETIRO_DESACTUALIZADO") {
          // Los datos cambiaron desde la vista previa -- nunca se retira
          // contra una lista vieja (ver comentario del retiroHash en la
          // ruta). Se refresca la vista previa en el mismo paso en vez
          // de confirmar a ciegas.
          setCandidatasRetiro(resultado.candidatasRetiro ?? []);
          setRetiroHash(resultado.retiroHash ?? null);
          setConfirmarRetiro(false);
        }
        setError(mensajeError(resultado));
        return;
      }
      setResultadoImportId(resultado.importId ?? importId);
      setYaConfirmadaAntes(resultado.yaConfirmada === true);
      setPaso("resultado");
    } finally {
      setCargando(false);
      enviandoRef.current = false;
    }
  }

  function actualizarMapeo(campo: CampoCoberturaCsv, valor: string) {
    setMapeo((m) => ({ ...m, [campo]: valor || null }));
    // Cambiar el mapeo invalida cualquier vista previa de retiro anterior
    // -- nunca se confirma contra candidatas calculadas con otro mapeo.
    setCandidatasRetiro(null);
    setRetiroHash(null);
  }

  function alternarColumnaSospechosa(encabezado: string) {
    setColumnasReconocidas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(encabezado)) siguiente.delete(encabezado);
      else siguiente.add(encabezado);
      return siguiente;
    });
  }

  const sospechosasSinReconocer = columnasSospechosas.filter((c) => !columnasReconocidas.has(c.encabezado));
  const faltaContexto = !fuenteConsumo.trim() || !periodoInicio || !periodoFin;
  const faltaAlcance = estrategia === "REEMPLAZO_ALCANCE" && (!alcanceInicio || !alcanceFin || alcanceUbicaciones.length === 0);
  const puedeVerVistaPrevia = sospechosasSinReconocer.length === 0 && !faltaContexto && !faltaAlcance;
  const puedeConfirmar =
    puedeVerVistaPrevia && candidatasRetiro !== null && (estrategia === "CARGA_PARCIAL" || confirmarRetiro);

  if (paso === "resultado") {
    return (
      <div className="flex flex-col gap-4 rounded border border-slate-200 p-4">
        <p className="text-sm font-medium text-emerald-700">
          {yaConfirmadaAntes ? "Esta importación ya estaba confirmada -- no se repitió nada." : "Importación confirmada."}
        </p>
        <p className="text-sm text-slate-600">
          El procesamiento corre en segundo plano (job de fondo) -- las observaciones de Cobertura van a aparecer a medida que
          termine. Podés volver a esta página para subir otra importación.
        </p>
        {resultadoImportId && (
          <p className="text-xs text-slate-400">ID de importación: {resultadoImportId}</p>
        )}
        <button
          type="button"
          onClick={() => router.refresh()}
          className="self-start rounded bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Ver historial
        </button>
      </div>
    );
  }

  if (paso === "subir") {
    return (
      <form onSubmit={handleSubir} className="flex flex-col gap-3 rounded border border-slate-200 p-4">
        <h2 className="font-medium">1. Subir archivo CSV</h2>
        <label className="flex flex-col gap-1 text-sm">
          Cadena
          <select
            required
            value={cadenaId}
            onChange={(e) => setCadenaId(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          >
            {cadenas.length === 0 && <option value="">Declará una cadena primero</option>}
            {cadenas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Archivo (.csv, hasta 4 MB, hasta 10.000 filas)
          <input
            type="file"
            required
            accept=".csv,text/csv"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={cargando || cadenas.length === 0}
          className="self-start rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {cargando ? "Subiendo..." : "Subir y continuar"}
        </button>
      </form>
    );
  }

  // paso === "revisar"
  return (
    <div className="flex flex-col gap-6 rounded border border-slate-200 p-4">
      <div>
        <h2 className="font-medium">2. Revisar mapeo, estrategia y contexto de consumo</h2>
        <p className="text-sm text-slate-600">
          {filasDetectadas} {filasDetectadas === 1 ? "fila detectada" : "filas detectadas"}.
        </p>
      </div>

      {muestra.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-100">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                {encabezados.map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1 text-left font-medium text-slate-600">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {muestra.map((fila, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {encabezados.map((h) => (
                    <td key={h} className="whitespace-nowrap px-2 py-1 text-slate-700">
                      {fila[h]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CAMPOS_COBERTURA_CSV.map((def) => (
          <label key={def.campo} className="flex flex-col gap-1 text-sm">
            {def.etiqueta}
            <select
              value={mapeo[def.campo] ?? ""}
              onChange={(e) => actualizarMapeo(def.campo, e.target.value)}
              className="rounded border border-slate-300 px-3 py-2"
            >
              <option value="">-- Elegir columna --</option>
              {encabezados.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {columnasSospechosas.length > 0 && (
        <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-800">
            Estas columnas del archivo parecen traer la fuente o el período del consumo -- pero acá se piden una sola vez más
            abajo, no por fila. Marcá cada una para confirmar que las revisaste.
          </p>
          {columnasSospechosas.map((c) => (
            <label key={c.encabezado} className="flex items-center gap-2 text-sm text-amber-900">
              <input
                type="checkbox"
                checked={columnasReconocidas.has(c.encabezado)}
                onChange={() => alternarColumnaSospechosa(c.encabezado)}
              />
              &quot;{c.encabezado}&quot; ({c.campo === "fuenteConsumo" ? "fuente de consumo" : "período de consumo"}) -- la voy a
              ignorar, ya la completo abajo.
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-slate-700">
          Fuente y período de referencia del consumo (una sola vez, aplica a todas las filas de este archivo)
        </h3>
        <label className="flex flex-col gap-1 text-sm">
          Fuente del consumo (ej. &quot;ERP mayo 2026&quot;)
          <input
            type="text"
            value={fuenteConsumo}
            onChange={(e) => setFuenteConsumo(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Período de referencia -- inicio
            <input
              type="date"
              value={periodoInicio}
              onChange={(e) => setPeriodoInicio(e.target.value)}
              className="rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Período de referencia -- fin
            <input
              type="date"
              value={periodoFin}
              onChange={(e) => setPeriodoFin(e.target.value)}
              className="rounded border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Si el archivo mezcla fuentes o períodos distintos, dividilo en archivos separados antes de importar.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-slate-700">Estrategia</h3>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="estrategia"
              checked={estrategia === "CARGA_PARCIAL"}
              onChange={() => {
                setEstrategia("CARGA_PARCIAL");
                setCandidatasRetiro(null);
                setRetiroHash(null);
              }}
            />
            <span>
              <strong>Carga parcial</strong> -- agrega o corrige solo lo que trae el archivo. Nunca retira nada.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="estrategia"
              checked={estrategia === "REEMPLAZO_ALCANCE"}
              onChange={() => {
                setEstrategia("REEMPLAZO_ALCANCE");
                setCandidatasRetiro(null);
                setRetiroHash(null);
              }}
            />
            <span>
              <strong>Reemplazo de alcance (corrección)</strong> -- retira lo que estaba vigente dentro de un rango de fechas y
              ubicaciones que este archivo no vuelve a traer.
            </span>
          </label>
        </div>

        {estrategia === "REEMPLAZO_ALCANCE" && (
          <div className="flex flex-col gap-3 rounded border border-slate-200 p-3">
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Alcance -- fecha de corte desde
                <input
                  type="date"
                  value={alcanceInicio}
                  onChange={(e) => {
                    setAlcanceInicio(e.target.value);
                    setCandidatasRetiro(null);
                    setRetiroHash(null);
                  }}
                  className="rounded border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                Alcance -- fecha de corte hasta
                <input
                  type="date"
                  value={alcanceFin}
                  onChange={(e) => {
                    setAlcanceFin(e.target.value);
                    setCandidatasRetiro(null);
                    setRetiroHash(null);
                  }}
                  className="rounded border border-slate-300 px-3 py-2"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Ubicaciones incluidas en el alcance (separadas por coma)
              <input
                type="text"
                placeholder="LIMA, AREQUIPA"
                value={alcanceUbicacionesTexto}
                onChange={(e) => {
                  setAlcanceUbicacionesTexto(e.target.value);
                  setCandidatasRetiro(null);
                  setRetiroHash(null);
                }}
                className="rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <p className="text-xs text-slate-500">
              Solo se retira lo que esté vigente en este rango de fechas Y en una de estas ubicaciones. Una ubicación vigente
              que no esté en esta lista nunca se toca, aunque su fecha caiga en el rango.
            </p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleVerVistaPrevia}
          disabled={cargando || !puedeVerVistaPrevia}
          className="rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
        >
          {cargando ? "Calculando..." : estrategia === "REEMPLAZO_ALCANCE" ? "Ver vista previa del retiro" : "Ver vista previa"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPaso("subir");
            setImportId(null);
          }}
          className="text-sm text-slate-500 underline"
        >
          Subir otro archivo
        </button>
      </div>

      {candidatasRetiro !== null && estrategia === "REEMPLAZO_ALCANCE" && (
        <div className="flex flex-col gap-3 rounded border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-800">
            {candidatasRetiro.length === 0
              ? "No hay ningún registro vigente en este alcance que el archivo no vuelva a traer -- no se retira nada."
              : `Se van a retirar ${candidatasRetiro.length} ${candidatasRetiro.length === 1 ? "registro vigente" : "registros vigentes"} que este archivo no trae:`}
          </p>
          {candidatasRetiro.length > 0 && (
            <ul className="max-h-48 overflow-y-auto text-xs text-red-900">
              {candidatasRetiro.map((c) => (
                <li key={c.id} className="border-t border-red-100 py-1 first:border-t-0">
                  {c.sku} · {c.ubicacion} · {formatearFecha(c.fechaCorte)}
                </li>
              ))}
            </ul>
          )}
          {candidatasRetiro.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-red-900">
              <input type="checkbox" checked={confirmarRetiro} onChange={(e) => setConfirmarRetiro(e.target.checked)} />
              Revisé esta lista y confirmo que se retiren estos registros.
            </label>
          )}
        </div>
      )}

      {candidatasRetiro !== null && (
        <button
          type="button"
          onClick={handleConfirmar}
          disabled={cargando || !puedeConfirmar}
          className="self-start rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {cargando ? "Confirmando..." : "3. Confirmar importación"}
        </button>
      )}
    </div>
  );
}
