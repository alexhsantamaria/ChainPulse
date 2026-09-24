// Infraestructura -- cliente real de Cloudflare R2 (API S3-compatible),
// Incremento 4 Bloque B. Primer codigo del proyecto que habla con un
// servicio externo de objetos (Resend es el unico servicio externo hoy,
// y es fire-and-forget, no bidireccional).
//
// Flujo confirmado por Alex el 2026-09-24 (ver docs/ADR/0006-cifrado-
// r2.md): el CSV se cifra en el SERVIDOR antes de subir (nunca sube
// contenido en claro a R2, ni siquiera transitoriamente) -- por eso esta
// clase no expone URLs prefirmadas para que el navegador suba/descargue
// directo. Suba y baja pasan siempre por un Route Handler de Next.js
// (runtime="nodejs" -- este cliente usa el SDK de AWS S3, que no corre en
// Edge, misma restriccion ya documentada para Prisma/pg-boss):
//   - Subida: el navegador manda el CSV en claro al Route Handler (body
//     acotado por limitesImportacionCsv.ts, ajustado para caber bajo el
//     limite de body de Vercel Hobby -- ver el comentario en ese
//     archivo), el servidor lo cifra (cifradoObjeto.ts) y sube el
//     ciphertext con subirObjeto().
//   - Descarga: el servidor descarga el ciphertext con descargarObjeto(),
//     lo descifra, y transmite el CSV en claro solo al usuario ya
//     autorizado del tenant dueño -- nunca una URL publica ni firmada.
//
// Solo probable con credenciales reales (R2_ACCOUNT_ID/
// R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME) -- mismo criterio
// "Windows-only" que test:integration de Neon: sin esas variables, usar
// ClienteAlmacenamientoMemoria (almacenamientoMemoria.ts) para probar el
// resto del flujo sin red.
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { ClienteAlmacenamiento } from "./almacenamiento";

function leerVariableObligatoria(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta ${nombre} en .env`);
  }
  return valor;
}

function crearClienteS3(): S3Client {
  const accountId = leerVariableObligatoria("R2_ACCOUNT_ID");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: leerVariableObligatoria("R2_ACCESS_KEY_ID"),
      secretAccessKey: leerVariableObligatoria("R2_SECRET_ACCESS_KEY"),
    },
  });
}

export class ClienteAlmacenamientoR2 implements ClienteAlmacenamiento {
  private cliente: S3Client | undefined;
  private bucket: string | undefined;

  // Lazy -- construir el cliente en el constructor rompería cualquier
  // import de este modulo en un entorno sin las variables de R2 todavia
  // configuradas (ej. Mac, antes de que Alex termine el setup real).
  private obtenerCliente(): S3Client {
    if (!this.cliente) {
      this.cliente = crearClienteS3();
    }
    return this.cliente;
  }

  private obtenerBucket(): string {
    if (!this.bucket) {
      this.bucket = leerVariableObligatoria("R2_BUCKET_NAME");
    }
    return this.bucket;
  }

  async subirObjeto(clave: string, contenido: Buffer): Promise<void> {
    await this.obtenerCliente().send(
      new PutObjectCommand({
        Bucket: this.obtenerBucket(),
        Key: clave,
        Body: contenido,
        // El objeto es siempre ciphertext (ver cabecera) -- este
        // Content-Type es solo metadata descriptiva, no afecta como se
        // interpreta el contenido en ningun visor de R2/S3.
        ContentType: "application/octet-stream",
      }),
    );
  }

  async descargarObjeto(clave: string): Promise<Buffer> {
    const respuesta = await this.obtenerCliente().send(
      new GetObjectCommand({ Bucket: this.obtenerBucket(), Key: clave }),
    );
    if (!respuesta.Body) {
      throw new Error(`ClienteAlmacenamientoR2: respuesta sin Body para "${clave}"`);
    }
    const bytes = await respuesta.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async eliminarObjeto(clave: string): Promise<void> {
    await this.obtenerCliente().send(new DeleteObjectCommand({ Bucket: this.obtenerBucket(), Key: clave }));
  }

  async existeObjeto(clave: string): Promise<boolean> {
    try {
      await this.obtenerCliente().send(new HeadObjectCommand({ Bucket: this.obtenerBucket(), Key: clave }));
      return true;
    } catch (error) {
      const codigo = (error as { name?: string; $metadata?: { httpStatusCode?: number } })?.name;
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (codigo === "NotFound" || status === 404) {
        return false;
      }
      throw error;
    }
  }
}
