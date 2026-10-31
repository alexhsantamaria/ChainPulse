// Componente — paso comun de activar-mfa y verificar-mfa: input de
// codigo TOTP + POST /api/plataforma/mfa/verificar. Esa ruta ya decide
// (segun mfaHabilitado) si el codigo activa el secreto o solo consume un
// contador existente, valida rate limit por huella de origen y emite la
// cookie de sesion -- nada de eso se repite aqui. Carpeta "_mfa" (prefijo
// "_") para que Next.js no la trate como ruta.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  extraerSecretoDeOtpauthUrl,
  interpretarRespuestaVerificarMfa,
} from "./interpretarRespuestaVerificarMfa";

export default function CodigoMfaPlataformaForm({ otpauthUrl }: { otpauthUrl?: string }) {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!otpauthUrl) return;
    let activo = true;
    // .catch() agregado (ronda 3 de revision, Alex): sin el, un fallo al
    // cargar el modulo "qrcode" o al generar el data URL quedaba como
    // una promesa rechazada sin manejar (nunca rompia la pantalla --
    // solo se quedaba en "Generando código QR..." para siempre, sin
    // ningun indicio de que algo fallo). El enlace manual
    // (secretoManual, mas abajo) sigue disponible igual si esto falla.
    import("qrcode")
      .then((QRCode) => QRCode.toDataURL(otpauthUrl))
      .then((dataUrl) => {
        if (activo) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (activo) setError("No se pudo generar el código QR. Usá el código manual de abajo.");
      });
    return () => {
      activo = false;
    };
  }, [otpauthUrl]);

  const secretoManual = otpauthUrl ? extraerSecretoDeOtpauthUrl(otpauthUrl) : null;

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);

    // Mismo motivo que LoginForm.tsx (ver su comentario): un fallo de
    // red en fetch() (no una respuesta HTTP de error) quedaba sin
    // manejar -- boton trabado y promesa rechazada sin capturar.
    try {
      const respuesta = await fetch("/api/plataforma/mfa/verificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      const resultado = await respuesta.json().catch(() => null);

      const interpretado = interpretarRespuestaVerificarMfa(
        respuesta.status,
        resultado,
        respuesta.headers.get("Retry-After"),
      );
      if (interpretado.tipo === "error") {
        setError(interpretado.mensaje);
        return;
      }
      router.push(interpretado.destino);
    } catch {
      setError("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {otpauthUrl && (
        <div className="flex flex-col items-center gap-3 text-center">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL generada en el cliente, no un asset estatico
            <img src={qrDataUrl} alt="Código QR para activar MFA" className="h-48 w-48" />
          ) : (
            <p className="text-sm text-slate-500">Generando código QR...</p>
          )}
          {secretoManual && (
            <details className="text-xs text-slate-500">
              <summary>No puedo escanear el código</summary>
              <p className="break-all">{secretoManual}</p>
            </details>
          )}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Código de 6 dígitos
          <input
            type="text"
            inputMode="numeric"
            required
            autoComplete="one-time-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-center"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={cargando}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {cargando ? "Verificando..." : "Verificar"}
        </button>
      </form>
    </div>
  );
}
