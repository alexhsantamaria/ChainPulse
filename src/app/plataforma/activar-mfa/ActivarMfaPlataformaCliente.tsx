// Componente — pide la otpauthUrl de activacion al montar (POST
// /api/plataforma/mfa/enrolar, sin body) y delega el resto (QR + input
// de codigo + POST /api/plataforma/mfa/verificar) a
// CodigoMfaPlataformaForm. Esta pagina no puede leer la cookie de
// preauth en el servidor -- su Path (/api/plataforma/mfa) no cubre
// /plataforma/activar-mfa, asi que el navegador nunca la adjunta a la
// navegacion de la pagina, solo a los fetch hacia /api/plataforma/mfa/*
// (ver opcionesCookiePreauthPlataforma en auth.config.plataforma.ts).
// Por eso todo el flujo es client-side.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { interpretarRespuestaEnrolar } from "../_mfa/interpretarRespuestaVerificarMfa";
import CodigoMfaPlataformaForm from "../_mfa/CodigoMfaPlataformaForm";

export default function ActivarMfaPlataformaCliente() {
  const router = useRouter();
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    fetch("/api/plataforma/mfa/enrolar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (respuesta) => {
        const resultado = await respuesta.json().catch(() => null);
        if (!activo) return;
        const interpretado = interpretarRespuestaEnrolar(respuesta.status, resultado);
        if (interpretado.tipo === "irALogin") {
          router.push("/plataforma/login");
        } else if (interpretado.tipo === "error") {
          setError(interpretado.mensaje);
        } else {
          setOtpauthUrl(interpretado.otpauthUrl);
        }
      })
      .catch(() => {
        if (activo) setError("No se pudo generar el código de activación. Volvé a intentar.");
      });
    return () => {
      activo = false;
    };
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 text-center">
      <h1 className="text-2xl font-semibold">Activa la verificación en dos pasos</h1>
      <p className="text-sm text-slate-600">
        Escaneá este código con Google Authenticator, Authy o una app similar. Es obligatorio para tu
        cuenta de plataforma.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {otpauthUrl && <CodigoMfaPlataformaForm otpauthUrl={otpauthUrl} />}
    </main>
  );
}
