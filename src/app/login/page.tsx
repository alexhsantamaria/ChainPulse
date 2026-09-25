// Pagina — formulario de inicio de sesion (ADR-0003, RF1/RF4).
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codigoMfa, setCodigoMfa] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  // A3 -- ActivarMfaForm.tsx cierra la sesion y redirige aca con este
  // parametro despues de activar MFA (para que el proximo login traiga
  // un JWT al dia, ver el comentario de esa pagina). Se lee con
  // window.location en vez de useSearchParams() para no forzar un
  // Suspense boundary en esta pagina solo por un mensaje de confirmacion.
  const [mfaActivado, setMfaActivado] = useState(false);
  useEffect(() => {
    setMfaActivado(new URLSearchParams(window.location.search).get("mfaActivado") === "1");
  }, []);

  async function handleSubmit(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setCargando(true);

    const resultado = await signIn("credentials", {
      email,
      password,
      codigoMfa,
      redirect: false,
    });

    setCargando(false);

    if (!resultado || resultado.error) {
      setError("Email, contraseña o código MFA incorrectos.");
      return;
    }

    // Bug reportado por Alex (2026-09-25, pruebas Windows): aca decia
    // router.push("/") -- el login funcionaba (sesion valida, cookie
    // seteada), pero devolvia a la portada publica sin ninguna senal de
    // que la sesion quedo iniciada. El middleware (src/middleware.ts)
    // solo protege /activar-mfa y /dashboard/:path*, no /, asi que no
    // habia ninguna segunda capa que corrigiera el destino. /dashboard es
    // el destino correcto para RESPONSABLE y ADMINISTRADOR por igual --
    // el propio middleware ya redirige a /activar-mfa si un ADMINISTRADOR
    // sin MFA intenta entrar ahi, asi que no hace falta bifurcar por rol
    // aca.
    router.push("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-center text-2xl font-semibold">Iniciar sesión</h1>
      {mfaActivado && (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-center text-sm text-green-700">
          Verificación en dos pasos activada. Iniciá sesión de nuevo con tu código.
        </p>
      )}
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
        <label className="flex flex-col gap-1 text-sm text-slate-500">
          Código MFA (solo si tu cuenta lo tiene activado)
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={codigoMfa}
            onChange={(e) => setCodigoMfa(e.target.value)}
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
      <a href="/recuperar-contrasena" className="text-center text-sm text-slate-500 underline">
        ¿Olvidaste tu contraseña?
      </a>
    </main>
  );
}
