// Componente — formulario de login de plataforma (RF19, PR 8 correccion).
// Solo junta el payload y llama a POST /api/plataforma/login, que ya
// hace verificacion de password (Argon2), rate limit por huella de
// origen y emite la cookie de preauth httpOnly -- nada de eso se repite
// aqui. "siguiente" (activar-mfa o verificar-mfa) lo decide el servidor
// segun fila.mfaHabilitado; este componente solo navega ahi, nunca
// decide por su cuenta.
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { interpretarRespuestaLogin } from "./interpretarRespuestaLogin";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);

    // try/catch/finally (ronda 3 de revision, Alex): un fallo de RED (no
    // una respuesta HTTP de error, que interpretarRespuestaLogin() ya
    // cubre, sino que fetch() mismo rechace -- sin conexion, DNS, CORS)
    // antes quedaba sin manejar: el boton se trababa en "Ingresando..."
    // para siempre y la promesa de handleSubmit quedaba rechazada sin
    // capturar (React no la atrapa en un manejador de evento async).
    // Nunca se expone el detalle crudo del error (podria ser un mensaje
    // de red especifico del navegador) -- solo un mensaje generico.
    try {
      const respuesta = await fetch("/api/plataforma/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const resultado = await respuesta.json().catch(() => null);

      const interpretado = interpretarRespuestaLogin(
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-center text-2xl font-semibold">Plataforma — Iniciar sesión</h1>
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
        <label className="flex flex-col gap-1 text-sm">
          Contraseña
          <input
            type="password"
            required
            autoComplete="current-password"
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
          {cargando ? "Ingresando..." : "Ingresar"}
        </button>
      </form>
    </main>
  );
}
