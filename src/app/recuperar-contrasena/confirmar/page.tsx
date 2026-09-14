// Pagina publica — confirma la recuperacion de contraseña con el token del correo.
// No pasa por el middleware (matcher solo cubre /activar-mfa y
// /dashboard/:path*), mismo criterio que /invitacion/aceptar: quien la
// abre puede no tener sesion activa.
import { verificarTokenRecuperacion } from "@/infra/auth/recuperacion";
import ConfirmarRecuperacionForm from "./ConfirmarRecuperacionForm";

export default async function ConfirmarRecuperacionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const usuario = token ? await verificarTokenRecuperacion(token) : null;

  if (!usuario) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">Enlace inválido o vencido</h1>
        <p className="text-sm text-slate-600">
          Pedí un enlace nuevo desde{" "}
          <a href="/recuperar-contrasena" className="underline">
            recuperar contraseña
          </a>
          .
        </p>
      </main>
    );
  }

  return <ConfirmarRecuperacionForm token={token as string} email={usuario.email} />;
}
