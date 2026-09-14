// Pagina publica — pide recuperar la contraseña por email.
"use client";

import { useState, type FormEvent } from "react";

export default function RecuperarContrasenaPage() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setCargando(true);
    await fetch("/api/recuperar-contrasena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setCargando(false);
    // Siempre el mismo mensaje, exista o no la cuenta (ADR-0003, sin
    // enumeracion) -- la respuesta del servidor tampoco lo distingue.
    setEnviado(true);
  }

  if (enviado) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">Revisá tu correo</h1>
        <p className="text-sm text-slate-600">
          Si existe una cuenta con ese email, te mandamos un enlace para elegir una contraseña nueva. Vence en 1
          hora.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Recuperar contraseña</h1>
        <p className="text-sm text-slate-600">
          Ingresá el email de tu cuenta y te mandamos un enlace para elegir una contraseña nueva.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={cargando}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {cargando ? "Enviando..." : "Enviar enlace"}
        </button>
      </form>
    </main>
  );
}
