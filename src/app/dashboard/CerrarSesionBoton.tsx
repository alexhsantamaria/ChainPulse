// Componente — cierra la sesion desde el dashboard (no existia ningun
// punto de salida en la UI hasta ahora).
"use client";

import { signOut } from "next-auth/react";

export default function CerrarSesionBoton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="text-sm text-slate-500 underline hover:text-slate-700"
    >
      Cerrar sesión
    </button>
  );
}
