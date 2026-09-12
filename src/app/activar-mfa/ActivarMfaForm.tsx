// Componente — confirma el codigo TOTP y activa MFA (ADR-0003).
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function ActivarMfaForm({
  qrDataUrl,
  secreto,
}: {
  qrDataUrl: string;
  secreto: string;
}) {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);

    const respuesta = await fetch("/api/mfa/activar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo }),
    });
    const resultado = await respuesta.json();
    setCargando(false);

    if (!resultado.ok) {
      setError("Codigo incorrecto. Revisa la hora de tu telefono e intenta de nuevo.");
      return;
    }

    router.push("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 text-center">
      <h1 className="text-2xl font-semibold">Activa la verificación en dos pasos</h1>
      <p className="text-sm text-slate-600">
        Escanea este código con Google Authenticator, Authy o una app similar. Es obligatorio
        para cuentas de administrador (ADR-0003).
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada en el servidor, no un asset estatico */}
      <img src={qrDataUrl} alt="Código QR para activar MFA" className="mx-auto h-48 w-48" />
      <details className="text-xs text-slate-500">
        <summary>No puedo escanear el código</summary>
        <p className="break-all">{secreto}</p>
      </details>
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
          {cargando ? "Verificando..." : "Activar"}
        </button>
      </form>
    </main>
  );
}
