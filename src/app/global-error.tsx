"use client";

// Next.js 15 — limite de error global (App Router): unico lugar que
// atrapa un error de renderizado que escapa del layout raiz. Reemplaza
// el <html>/<body> completo mientras esta activo, asi que es el unico
// componente del proyecto que los declara el mismo (Next no envuelve
// nada mas en este caso). Sin este archivo, un error de React en
// cualquier pantalla (Incremento 1 o la UI publica del cuestionario)
// no llegaba a Sentry -- onRequestError (src/instrumentation.ts) solo
// cubre route handlers/server components, no errores de render en el
// cliente. Pendiente real documentado en README/pendientes-tecnicos
// hasta ahora (deliberadamente fuera del commit de observabilidad
// original para no mezclar alcance).
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Algo salió mal</h1>
          <p className="text-sm text-slate-600">
            Encontramos un error inesperado. Ya quedó registrado — intenta de nuevo en un momento.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
          >
            Recargar página
          </button>
        </main>
      </body>
    </html>
  );
}
