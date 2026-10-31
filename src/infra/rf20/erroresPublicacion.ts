const CAMPOS_INDICE_PARCIAL_PUBLICACION = ["codigo"];

export function esViolacionIndiceParcialPublicacion(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  if ((error as { code?: string }).code !== "P2002") return false;

  const campos = (error as {
    meta?: { constraint?: { fields?: unknown } };
  }).meta?.constraint?.fields;
  if (!Array.isArray(campos) || !campos.every((campo) => typeof campo === "string")) {
    return false;
  }

  return (
    JSON.stringify([...campos].sort()) ===
    JSON.stringify([...CAMPOS_INDICE_PARCIAL_PUBLICACION].sort())
  );
}
