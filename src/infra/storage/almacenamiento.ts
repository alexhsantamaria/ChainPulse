// Infraestructura -- interfaz de almacenamiento de objetos, independiente
// de R2 (Incremento 4 Bloque B). Permite probar todo el flujo de
// cifrado+persistencia en Mac/CI sin credenciales reales (ver
// almacenamientoMemoria.ts), y solo la implementacion real (r2.ts) exige
// R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME --
// mismo criterio "Windows-only para integracion real" ya usado con
// Neon/test:integration (ver PLAN-DE-TRABAJO.md).
//
// Los objetos que pasan por esta interfaz son SIEMPRE el ciphertext ya
// armado por cifradoObjeto.ts (nunca contenido en claro) -- esta capa no
// sabe nada de cifrado, solo mueve bytes.
export interface ClienteAlmacenamiento {
  subirObjeto(clave: string, contenido: Buffer): Promise<void>;
  descargarObjeto(clave: string): Promise<Buffer>;
  eliminarObjeto(clave: string): Promise<void>;
  existeObjeto(clave: string): Promise<boolean>;
}

// -- Claves de objeto (pura, sin red) --
//
// Nunca el nombre de archivo original del usuario (path traversal,
// filtracion de nombres de proveedores/SKUs en el nombre del objeto) --
// siempre un nombre fijo por etapa. Prefijo empresas/{empresaId}/... para
// que el aislamiento por tenant sea verificable con una prueba simple:
// "el servidor nunca firma/lee/escribe una clave fuera del prefijo del
// empresaId de la sesion activa" (PLAN-DE-TRABAJO.md, Setup de R2).
export function construirClaveObjetoCifrado(empresaId: string, importId: string): string {
  return `empresas/${empresaId}/imports/${importId}/cifrado.bin`;
}
