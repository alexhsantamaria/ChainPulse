// Componente — crea la cuenta del responsable al aceptar la invitacion (RF4).
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function AceptarInvitacionForm({
  token,
  email,
  empresaNombre,
  eslabonNombre,
}: {
  token: string;
  email: string;
  empresaNombre: string;
  eslabonNombre: string;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);

    const respuesta = await fetch("/api/invitaciones/aceptar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, nombre, password }),
    });
    const resultado = await respuesta.json();
    setCargando(false);

    if (!resultado.ok) {
      setError(
        resultado.error === "EMAIL_YA_REGISTRADO"
          ? "Ya existe una cuenta con este email. Iniciá sesión en vez de aceptar la invitación."
          : "No se pudo crear tu cuenta. Intentá de nuevo.",
      );
      return;
    }

    router.push("/login");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Unite a {empresaNombre}</h1>
        <p className="text-sm text-slate-600">
          Vas a ser responsable del eslabón <strong>{eslabonNombre}</strong>. Elegí tu nombre y una
          contraseña para crear tu cuenta.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            value={email}
            disabled
            className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-slate-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tu nombre
          <input
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Elegí una contraseña
          <input
            type="password"
            required
            minLength={8}
            maxLength={200}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={cargando}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {cargando ? "Creando cuenta..." : "Crear mi cuenta"}
        </button>
      </form>
    </main>
  );
}
