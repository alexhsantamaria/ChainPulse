// Infraestructura -- implementacion en memoria de ClienteAlmacenamiento,
// para pruebas locales sin R2 real (pedido explicito de Alex, 2026-09-24:
// "avanzar con el cliente de almacenamiento simulado, cifrado y pruebas
// locales" mientras prepara las credenciales reales de Cloudflare). Nunca
// usar esto fuera de pruebas -- no persiste entre procesos, no tiene TTL,
// no es un mock de las URLs firmadas (ese comportamiento es especifico
// del SDK de R2, ver r2.ts).
import type { ClienteAlmacenamiento } from "./almacenamiento";

export class ClienteAlmacenamientoMemoria implements ClienteAlmacenamiento {
  private readonly objetos = new Map<string, Buffer>();

  async subirObjeto(clave: string, contenido: Buffer): Promise<void> {
    // Copia defensiva -- si el llamador muta el buffer original despues
    // de subir, no debe afectar lo "persistido" aca.
    this.objetos.set(clave, Buffer.from(contenido));
  }

  async descargarObjeto(clave: string): Promise<Buffer> {
    const contenido = this.objetos.get(clave);
    if (!contenido) {
      throw new Error(`ClienteAlmacenamientoMemoria: no existe el objeto "${clave}"`);
    }
    return Buffer.from(contenido);
  }

  async eliminarObjeto(clave: string): Promise<void> {
    this.objetos.delete(clave);
  }

  async existeObjeto(clave: string): Promise<boolean> {
    return this.objetos.has(clave);
  }

  /** Solo para pruebas -- cuantos objetos hay guardados ahora mismo. */
  cantidadObjetos(): number {
    return this.objetos.size;
  }
}
