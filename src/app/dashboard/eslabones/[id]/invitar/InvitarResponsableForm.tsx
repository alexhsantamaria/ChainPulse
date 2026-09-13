// Componente — envia la invitacion por correo a un responsable (RF4).
"use client";

import { useState, type FormEvent } from "react";

export default function InvitarResponsableForm({ eslabonId }: { eslabonId: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setExito(false);
    setCargando(true);

    const respuesta = await fetch("/api/invitaciones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, eslabonId }),
    });
    const resultado = await respuesta.json();
    setCargando(false);

    if (!resultado.ok) {
      setError(
        resultado.error === "EMAIL_YA_REGISTRADO"
          ? "Ya existe una cuenta con ese email."
          : resultado.error === "ERROR_ENVIO_CORREO"
            ? "No se pudo enviar el correo. Revisá la configuración de Resend e intentá de nuevo."
            : "No se pudo enviar la invitación. Revisá el email e intentá de nuevo.",
      );
      return;
    }

    setExito(true);
    setEmail("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded border border-slate-200 p-4">
      <label className="flex flex-col gap-1 text-sm">
        Email del responsable
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-slate-300 px-3 py-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {exito && <p className="text-sm text-green-700">Invitación enviada.</p>}
      <button
        type="submit"
        disabled={cargando}
        className="self-start rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {cargando ? "Enviando..." : "Enviar invitación"}
      </button>
    </form>
  );
}
