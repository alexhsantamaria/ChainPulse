import { randomBytes } from "node:crypto";
import { construirPruebaSecretPreview } from "../../src/infra/queries/rendimiento/diagnosticoSecretPreview";
import { exigirUrlDePrueba } from "../../src/infra/queries/rendimiento/cargaConsultasHelpers";

interface EntornoVerificacionSecretPreview {
  CARGA_CONSULTAS_BASE_URL?: string;
  CARGA_CONSULTAS_NEXTAUTH_SECRET?: string;
  CARGA_CONSULTAS_VERCEL_BYPASS?: string;
}

export function resolverBypassDiagnostico(valor: string | undefined): string {
  if (!valor || valor.length !== 32 || /\s/.test(valor)) {
    throw new Error("BYPASS_DIAGNOSTICO_INVALIDO");
  }
  return valor;
}

export async function verificarSecretPreview(
  fetchImpl: typeof fetch,
  env: EntornoVerificacionSecretPreview | NodeJS.ProcessEnv,
): Promise<boolean> {
  const baseCruda = env.CARGA_CONSULTAS_BASE_URL;
  const secretCandidato = env.CARGA_CONSULTAS_NEXTAUTH_SECRET;
  if (!baseCruda) throw new Error("FALTA_VARIABLE_CARGA_CONSULTAS_BASE_URL");
  if (!secretCandidato) throw new Error("FALTA_VARIABLE_CARGA_CONSULTAS_NEXTAUTH_SECRET");
  const bypass = resolverBypassDiagnostico(env.CARGA_CONSULTAS_VERCEL_BYPASS);
  const base = exigirUrlDePrueba(baseCruda);
  const nonce = randomBytes(32).toString("base64url");
  const prueba = construirPruebaSecretPreview(secretCandidato, nonce);
  const respuesta = await fetchImpl(new URL("/api/diagnostico/secret-preview", base).toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vercel-protection-bypass": bypass,
    },
    body: JSON.stringify({ nonce, prueba }),
    redirect: "manual",
  });
  if (
    respuesta.status !== 200 ||
    !(respuesta.headers.get("content-type") ?? "").includes("application/json")
  ) {
    throw new Error(`DIAGNOSTICO_SECRET_HTTP_${respuesta.status}`);
  }
  const cuerpo = (await respuesta.json()) as unknown;
  if (
    !cuerpo ||
    typeof cuerpo !== "object" ||
    (cuerpo as Record<string, unknown>).ok !== true ||
    typeof (cuerpo as Record<string, unknown>).coincide !== "boolean"
  ) {
    throw new Error("RESPUESTA_DIAGNOSTICO_INVALIDA");
  }
  return (cuerpo as { coincide: boolean }).coincide;
}

if (process.env.VITEST !== "true") {
  verificarSecretPreview(fetch, process.env)
    .then((coincide) => {
      console.log(`SECRETO_PREVIEW_COINCIDE=${coincide ? "SI" : "NO"}`);
      if (!coincide) process.exitCode = 2;
    })
    .catch((error) => {
      console.error("DIAGNOSTICO_SECRET_ABORTADO:", error instanceof Error ? error.message : "ERROR_DESCONOCIDO");
      process.exitCode = 1;
    });
}
