// Logica pura (sin fetch, sin DOM) que LoginForm.tsx usa para decidir que
// mostrar/adonde navegar segun la respuesta de POST /api/plataforma/login.
// Separada del componente a proposito: el repo no tiene jsdom/Testing
// Library configurado (vitest.config.ts usa environment:"node" e incluye
// solo *.test.ts) -- esta funcion es la parte de la UI que SI se puede
// probar sin esa infraestructura (ver informe de entrega, brecha de
// pruebas de UI).
export type ResultadoInterpretado =
  | { tipo: "ir"; destino: string }
  | { tipo: "error"; mensaje: string };

export function interpretarRespuestaLogin(
  status: number,
  resultado: { ok?: boolean; siguiente?: string } | null,
  retryAfterHeader: string | null,
): ResultadoInterpretado {
  if (status === 429) {
    return {
      tipo: "error",
      mensaje: `Demasiados intentos. Esperá ${
        retryAfterHeader ? `${retryAfterHeader} segundos` : "unos segundos"
      } e intentá de nuevo.`,
    };
  }
  // Mismo criterio de no-enumeracion que la API: nunca distinguir "no
  // existe" de "password incorrecta" ni cuenta bloqueada/inactiva, y
  // nunca confiar en "siguiente" si el servidor no confirmo ok:true.
  if (status < 200 || status >= 300 || !resultado?.ok || typeof resultado.siguiente !== "string") {
    return { tipo: "error", mensaje: "Email o contraseña incorrectos." };
  }
  return { tipo: "ir", destino: resultado.siguiente };
}
