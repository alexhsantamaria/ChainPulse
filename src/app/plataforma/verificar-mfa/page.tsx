// Pagina — verificacion de MFA de plataforma (RF19, PR 8 correccion),
// para una cuenta que ya tiene MFA habilitado. Mismo motivo que
// activar-mfa/page.tsx para no verificar nada en el servidor aca: la
// cookie de preauth no es legible en esta ruta.
"use client";

import CodigoMfaPlataformaForm from "../_mfa/CodigoMfaPlataformaForm";

export default function VerificarMfaPlataformaPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 text-center">
      <h1 className="text-2xl font-semibold">Verificación en dos pasos</h1>
      <p className="text-sm text-slate-600">Ingresá el código de tu app de autenticación.</p>
      <CodigoMfaPlataformaForm />
    </main>
  );
}
