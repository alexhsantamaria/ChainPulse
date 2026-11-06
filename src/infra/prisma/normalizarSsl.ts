/**
 * Conserva las garantias TLS que pg-connection-string aplica hoy y evita
 * depender del cambio semantico anunciado para pg v9. No registra ni expone
 * la cadena de conexion.
 */
export function normalizarSslPostgres(connectionString: string | undefined): string | undefined {
  if (!connectionString) return connectionString;

  try {
    const url = new URL(connectionString);
    const modo = url.searchParams.get("sslmode");
    if (modo === "require" || modo === "prefer" || modo === "verify-ca") {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    // Prisma/pg produciran el error de configuracion habitual. No sustituimos
    // ese diagnostico ni incluimos el valor sensible en un error nuevo.
    return connectionString;
  }
}
