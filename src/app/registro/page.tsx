// Pagina — registro de cuenta: crea la empresa y el administrador (RF1, ADR-0003).
"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function RegistroPage() {
  const router = useRouter();
  const [nombreEmpresa, setNombreEmpresa] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);

    const respuesta = await fetch("/api/registro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombreEmpresa, email, password }),
    });
    const resultado = await respuesta.json();

    if (!resultado.ok) {
      setCargando(false);
      setError(
        resultado.error === "EMAIL_YA_REGISTRADO"
          ? "Ese email ya tiene una cuenta."
          : "No se pudo crear la cuenta. Revisa los datos e intenta de nuevo.",
      );
      return;
    }

    // Reusa el mismo flujo probado de /login (misma llamada a signIn),
    // en vez de reinventar como iniciar sesion tras el registro.
    const inicio = await signIn("credentials", { email, password, redirect: false });
    setCargando(false);

    if (!inicio || inicio.error) {
      setError("La cuenta se creo, pero no se pudo iniciar sesion sola. Inicia sesion manualmente.");
      router.push("/login");
      return;
    }

    router.push("/activar-mfa");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-center text-2xl font-semibold">Crear cuenta</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Nombre de la empresa
          <input
            type="text"
            required
            value={nombreEmpresa}
            onChange={(e) => setNombreEmpresa(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
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
        <label className="flex flex-col gap-1 text-sm">
          Contraseña
          <input
            type={mostrarPassword ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={mostrarPassword}
            onChange={(e) => setMostrarPassword(e.target.checked)}
          />
          Mostrar contraseña
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={cargando}
          className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {cargando ? "Creando cuenta..." : "Crear cuenta"}
        </button>
      </form>
    </main>
  );
}
