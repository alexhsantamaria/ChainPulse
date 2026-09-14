// Componente — fija la contraseña nueva con el token ya verificado por la pagina.
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function ConfirmarRecuperacionForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);

    if (password !== confirmar) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setCargando(true);
    const respuesta = await fetch("/api/recuperar-contrasena/confirmar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const resultado = await respuesta.json();
    setCargando(false);

    if (!resultado.ok) {
      setError("El enlace venció mientras completabas el formulario. Pedí uno nuevo.");
      return;
    }

    router.push("/login");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Elegí una contraseña nueva</h1>
        <p className="text-sm text-slate-600">Para la cuenta {email}.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Contraseña nueva
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
        <label className="flex flex-col gap-1 text-sm">
          Repetí la contraseña
          <input
            type="password"
            required
            minLength={8}
            maxLength={200}
            autoComplete="new-password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={cargando}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {cargando ? "Guardando..." : "Guardar contraseña"}
        </button>
      </form>
    </main>
  );
}
