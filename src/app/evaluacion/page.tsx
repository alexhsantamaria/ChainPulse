// Pagina — inicio de la evaluacion expres v2 (RF11/RF21, V2 Sec. 7.1):
// contexto previo minimo (principio "valor antes del registro" -- ningun
// campo pide cuenta ni correo). Solo productoServicio y tipoOperacion son
// obligatorios; el resto queda detras de "Agregar contexto (opcional)"
// para respetar el minimalismo de UX (cada campo de mas reduce quien
// termina). Pais queda fijo en Peru (unico pais aprobado, ver
// MVP-DEFINITIVO.md Seccion 13 decision #5) -- el backend ya lo asume por
// defecto si no se envia, asi que ni se muestra. RF18: aviso breve de
// minimizacion junto a los campos de texto libre del contexto opcional --
// guia, nunca bloquea el envio.
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { crearEvaluacion } from "@/lib/evaluacionExpres/api";
import { mensajeError } from "@/lib/evaluacionExpres/etiquetas";
import { guardarProgreso } from "@/lib/evaluacionExpres/storage";

const TIPOS_OPERACION = [
  { valor: "manufactura", texto: "Manufactura" },
  { valor: "distribucion", texto: "Distribución" },
  { valor: "comercio", texto: "Comercio" },
  { valor: "servicios", texto: "Servicios" },
  { valor: "otra", texto: "Otra" },
];

const RANGOS_TAMANO = [
  { valor: "1-10", texto: "1 a 10 personas" },
  { valor: "11-50", texto: "11 a 50 personas" },
  { valor: "51-200", texto: "51 a 200 personas" },
  { valor: "201-500", texto: "201 a 500 personas" },
  { valor: "500+", texto: "Más de 500 personas" },
];

export default function EvaluacionInicioPage() {
  const router = useRouter();
  const [productoServicio, setProductoServicio] = useState("");
  const [tipoOperacion, setTipoOperacion] = useState("");
  const [region, setRegion] = useState("");
  const [sector, setSector] = useState("");
  const [subsector, setSubsector] = useState("");
  const [rolParticipante, setRolParticipante] = useState("");
  const [rangoTamano, setRangoTamano] = useState("");
  const [mostrarContexto, setMostrarContexto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);

    const resultado = await crearEvaluacion({
      productoServicio,
      tipoOperacion,
      region: region || undefined,
      sector: sector || undefined,
      subsector: subsector || undefined,
      rangoTamano: rangoTamano || undefined,
      rolParticipante: rolParticipante || undefined,
    });

    setCargando(false);
    if (!resultado.ok) {
      setError(mensajeError(resultado.error));
      return;
    }

    guardarProgreso(resultado.datos.evaluacionExpresV2Id, {
      preguntas: resultado.datos.preguntas,
      respuestas: {},
    });
    router.push(`/evaluacion/${resultado.datos.evaluacionExpresV2Id}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Evalúa tu cadena en 60 segundos</h1>
        <p className="text-sm text-slate-500">
          Sin crear cuenta. Al final verás un primer plano preliminar de tu cadena.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          ¿Qué producto, servicio o familia vas a evaluar?
          <input
            type="text"
            required
            placeholder="Ej: Repuestos línea B"
            value={productoServicio}
            onChange={(e) => setProductoServicio(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tipo de operación
          <select
            required
            value={tipoOperacion}
            onChange={(e) => setTipoOperacion(e.target.value)}
            className="rounded border border-slate-300 bg-white px-3 py-2"
          >
            <option value="" disabled>
              Selecciona una opción
            </option>
            {TIPOS_OPERACION.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.texto}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setMostrarContexto((valor) => !valor)}
          className="self-start text-sm text-slate-500 underline"
        >
          {mostrarContexto ? "Ocultar contexto opcional" : "Agregar contexto (opcional)"}
        </button>

        {mostrarContexto && (
          <div className="flex flex-col gap-4 rounded border border-slate-200 p-4">
            <p className="text-xs text-slate-400">
              No es necesario escribir nombres reales de proveedores o clientes — si necesitas mencionar a
              alguno, usa un alias genérico como &quot;Proveedor A&quot; o &quot;Cliente B&quot;.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              Región
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Sector
              <input
                type="text"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                className="rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Subsector
              <input
                type="text"
                value={subsector}
                onChange={(e) => setSubsector(e.target.value)}
                className="rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Tu rol
              <input
                type="text"
                placeholder="Ej: Operaciones"
                value={rolParticipante}
                onChange={(e) => setRolParticipante(e.target.value)}
                className="rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Tamaño de la empresa
              <select
                value={rangoTamano}
                onChange={(e) => setRangoTamano(e.target.value)}
                className="rounded border border-slate-300 bg-white px-3 py-2"
              >
                <option value="">Prefiero no decirlo</option>
                {RANGOS_TAMANO.map((opcion) => (
                  <option key={opcion.valor} value={opcion.valor}>
                    {opcion.texto}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={cargando}
          className="rounded bg-slate-900 px-4 py-3 text-sm text-white disabled:opacity-50"
        >
          {cargando ? "Creando evaluación..." : "Comenzar"}
        </button>
      </form>
    </main>
  );
}
