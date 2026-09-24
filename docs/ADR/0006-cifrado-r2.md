# ADR-0006 — Cifrado de aplicación para objetos en Cloudflare R2

Fecha: 2026-09-24
Estado: Aceptado — confirmado por Alex el 2026-09-24 (Incremento 4 Bloque B, `PLAN-DE-TRABAJO.md` Sección 18.2.E). Diseño e implementación de la capa de cifrado y del cliente de almacenamiento ya construidos (`src/infra/storage/`); pendiente de validar contra R2 real hasta que Alex complete el setup de Cloudflare (ver checklist en `PLAN-DE-TRABAJO.md`).

## Contexto

`MVP-DEFINITIVO.md` Sección 8 pide "cifrado" como requisito explícito para el almacenamiento de objetos del Incremento 4 (CSVs subidos por el usuario, potencialmente con datos operativos sensibles de la cadena de suministro). Cloudflare R2 cifra en reposo automáticamente con AES-256 a nivel de infraestructura ([documentación de R2](https://developers.cloudflare.com/r2/reference/data-security/)) — eso satisface la letra del requisito, pero no cubre dos riesgos reales y concretos:

1. Un token de API de R2 filtrado (ej. expuesto en un log, un repositorio, una variable de entorno mal configurada) — quien lo tenga puede leer cualquier objeto del bucket en claro, porque el cifrado en reposo es transparente para cualquier credencial válida.
2. Un bucket mal configurado (ej. acceso público `r2.dev` habilitado por error) — mismo problema, el cifrado en reposo no protege contra una política de acceso incorrecta.

Ninguno de los dos es un cifrado adicional cosmético: son la diferencia entre "alguien con las credenciales de R2 ve el CSV" y "alguien con las credenciales de R2 ve bytes sin sentido". Alex marcó esta decisión como pendiente el 2026-09-16 (`PLAN-DE-TRABAJO.md` Sección 15) y la confirmó el 2026-09-24, señalando explícitamente el trade-off que trae: **si se pierde la clave de aplicación, los archivos cifrados con ella dejan de ser recuperables** — no es un cifrado "gratis", es una responsabilidad operativa nueva sobre custodia de claves.

## Opciones consideradas

| Opción | Cubre token de R2 filtrado / bucket mal configurado | Responsabilidad de custodia de claves | Costo adicional |
|---|---|---|---|
| A — Solo el cifrado en reposo por defecto de R2 | No | Ninguna (Cloudflare la gestiona) | Ninguno |
| B — Cifrado de aplicación (envelope encryption, clave propia) además del cifrado por defecto de R2 | Sí | Sí — clave maestra propia, sin KMS gestionado (presupuesto $0/mes, ADR "H14") | Ninguno (módulo `crypto` nativo de Node, cero dependencias nuevas) |

## Decisión

Se adopta la **Opción B**, con los siete requisitos que Alex fijó explícitamente el 2026-09-24 y cómo se resuelve cada uno:

**1. Cifrado en el servidor antes de subir; la clave nunca llega al navegador.** El CSV en claro sube del navegador a un Route Handler de Next.js (`runtime="nodejs"`, igual que Prisma/pg-boss — el SDK de S3 no corre en Edge), que lo cifra ahí mismo con `src/infra/storage/cifradoObjeto.ts` y recién entonces sube el ciphertext a R2 con `ClienteAlmacenamientoR2` (`src/infra/storage/r2.ts`). No existe ningún camino donde el navegador reciba una URL prefirmada para subir directo a R2 (a diferencia del plan original de Setup de R2) — la clave maestra es un secreto exclusivamente de servidor. **Consecuencia real de este cambio:** el CSV en claro ahora pasa por el *body* del Route Handler, sujeto al límite de Vercel Hobby (4.5 MB) — `src/domain/limitesImportacionCsv.ts` bajó su límite de 5 MB a 4 MB por esto (ver el comentario de cabecera de ese archivo para el detalle completo).

**2. Claves independientes de las credenciales de R2 y del secreto de autenticación.** `R2_ENCRYPTION_KEY_ACTIVA` es una variable de entorno propia, sin relación con `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` (credenciales de R2) ni con `NEXTAUTH_SECRET` (firma de sesiones) — comprometer una no compromete las otras.

**3. Nonce único por cifrado + verificación del authTag antes de procesar el contenido.** AES-256-GCM con un IV de 12 bytes generado con `crypto.randomBytes` en cada llamada a `cifrarContenido`/`envolverDek` (nunca reutilizado — reutilizar un IV con la misma clave en GCM rompe la confidencialidad). El contenido descifrado nunca se devuelve al llamador hasta que `decipher.final()` valida el `authTag` — si no valida (contenido alterado, clave incorrecta), la función lanza antes de que exista ningún buffer de texto plano accesible fuera de `cifradoObjeto.ts`. Ver el comentario de cabecera de ese archivo para el detalle exacto.

**4. Vinculación criptográfica con la empresa y la importación.** Cada cifrado usa AAD (Additional Authenticated Data) = `empresaId` + `importId` (`construirAad()`). Si alguien intenta descifrar un objeto declarando una empresa o importación distinta a la que se usó al cifrar — incluso con la DEK correcta — `setAAD` no coincide y `final()` lanza. Esto se prueba explícitamente (ver "Pruebas" abajo).

**5. Versión de formato + identificador de clave, para rotación.** `VERSION_FORMATO_ACTUAL` (constante en `cifradoObjeto.ts`, hoy `1`) queda guardado por fila (`ImportacionCsv.cifradoVersion`) para poder cambiar el formato de envoltorio en el futuro sin romper filas ya existentes. `ImportacionCsv.cifradoClaveId` guarda con qué clave maestra se envolvió la DEK de esa fila — permite que `R2_ENCRYPTION_KEY_ACTIVA` rote sin tener que re-cifrar ningún objeto ya subido a R2 (solo hay que re-envolver la DEK, bytes chicos, ver más abajo).

**6. Custodia, recuperación y retención de claves.** Ver sección dedicada abajo.

**7. Pruebas de manipulación, clave incorrecta y acceso entre empresas.** `src/infra/storage/__tests__/cifradoObjeto.test.ts` (19 casos) cubre explícitamente los tres: un objeto cifrado con 1 byte alterado nunca se descifra; descifrar con una DEK o clave maestra distinta a la que cifró lanza; descifrar declarando un `empresaId`/`importId` distinto (acceso entre empresas/importaciones) lanza aunque la clave sea la correcta. También cubre un escenario completo de rotación de clave maestra (una DEK envuelta con la clave vieja se sigue pudiendo desenvolver después de rotar, vía `R2_ENCRYPTION_KEYS_ANTERIORES`).

### Diseño técnico — envelope encryption

AES-256-GCM (módulo `crypto` nativo de Node, cero dependencias nuevas):

1. Se genera una DEK (Data Encryption Key) aleatoria de 32 bytes por archivo (`generarDek()`).
2. El **contenido** se cifra con la DEK. El objeto que sube a R2 es autocontenido: `[iv 12B][ciphertext][authTag 16B]` (`cifrarContenido`/`descifrarContenido`).
3. La DEK se **envuelve** (cifra) con la clave maestra activa (`envolverDek`/`desenvolverDek`) — lo único que se persiste en Postgres (`ImportacionCsv.cifradoDek`/`cifradoDekIv`/`cifradoDekAuthTag`/`cifradoClaveId`/`cifradoVersion`) es la DEK ya envuelta, nunca en claro, y nunca el contenido del archivo.

Por qué envolver la DEK en vez de cifrar el archivo directo con la clave maestra: rotar la clave maestra sin envelope encryption obligaría a re-descifrar y re-cifrar TODOS los archivos ya subidos con la clave vieja (una operación cara e imposible de hacer sin descargar cada objeto de R2). Con envelope encryption, rotar solo exige re-envolver las DEKs ya guardadas en Postgres (filas chicas, rápido) — el contenido en R2 nunca se vuelve a tocar.

### Gestión de claves — variables de entorno

- `R2_ENCRYPTION_KEY_ACTIVA` (base64, debe decodificar a 32 bytes) — la clave con la que se envuelven las DEKs **nuevas**. Se genera igual que `NEXTAUTH_SECRET`: `python3 -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"`.
- `R2_ENCRYPTION_KEY_ACTIVA_ID` — un identificador corto, no secreto, elegido por Alex (ej. `"2026-09"`), que se guarda junto a cada DEK envuelta con esta clave.
- `R2_ENCRYPTION_KEYS_ANTERIORES` — JSON `{ "<claveId>": "<claveBase64>" }` de claves ya retiradas de "activa" pero que todavía hace falta conservar para desenvolver DEKs viejas. Vacío (`{}` o sin configurar) hasta la primera rotación.

### Custodia, recuperación y retención (punto 6)

- **Dónde viven las claves:** exclusivamente como variables de entorno de Vercel (Production/Preview/Development, mismo mecanismo que `NEXTAUTH_SECRET`) — nunca en el repositorio, nunca en Postgres, nunca en un archivo versionado.
- **Backup — responsabilidad de Alex [HUMANO], sin herramienta de este proyecto:** sin presupuesto para un KMS gestionado (AWS KMS, GCP KMS — fuera del criterio $0/mes ya fijado en `PLAN-DE-TRABAJO.md` H14), la única copia viva de `R2_ENCRYPTION_KEY_ACTIVA` son las variables de entorno de Vercel. Se recomienda guardar una copia offline (gestor de contraseñas, o un archivo cifrado fuera del repositorio) de cada clave activa/anterior — si se pierde sin backup, **las DEKs envueltas con esa clave dejan de poder desenvolverse, y los CSVs correspondientes quedan permanentemente ilegibles** (mismo riesgo que ya señaló Alex al citar la documentación de R2). Esto es una limitación aceptada, no un bug — la alternativa (un KMS gestionado con recuperación de claves) tiene costo mensual real.
- **Rotación:** generar una clave nueva, asignarle un `R2_ENCRYPTION_KEY_ACTIVA_ID` nuevo, mover la clave vieja (con su id) a `R2_ENCRYPTION_KEYS_ANTERIORES`. Las filas ya existentes siguen desenvolviéndose sin tocar R2 (`ImportacionCsv.cifradoClaveId` resuelve cuál usar — ver `obtenerClaveMaestraPorId()`). Un job de re-envolvimiento masivo (para migrar todas las filas a la clave nueva y eventualmente poder retirar la vieja) queda como trabajo futuro, no construido en este incremento — no bloquea el resto del Bloque B.
- **Retención de claves anteriores:** una clave en `R2_ENCRYPTION_KEYS_ANTERIORES` NUNCA se borra hasta que (a) se re-envolvieron todas las DEKs que la usaban, o (b) los objetos correspondientes se purgaron (ej. por la regla de lifecycle de R2 ya prevista en el Setup de R2 de `PLAN-DE-TRABAJO.md`). Borrar una entrada antes de eso hace que esas filas queden permanentemente irrecuperables — mismo riesgo que perder la clave activa, documentado acá para que quede claro que es una operación irreversible.
- **Registro de rotaciones:** cada rotación real se agrega a `SEGURIDAD-credenciales.md` (mismo archivo donde ya se registran las rotaciones de `neondb_owner`/`chainpulse_app`/`NEXTAUTH_SECRET`), con fecha, id de la clave retirada y motivo.

### Pruebas

`src/infra/storage/__tests__/cifradoObjeto.test.ts` (19 pruebas, sin red): round-trip de cifrado/descifrado de contenido y de envoltura de DEK; manipulación de 1 byte del ciphertext; clave (DEK o maestra) incorrecta; `empresaId`/`importId` incorrectos al descifrar (acceso entre empresas/importaciones); nonce distinto en cada cifrado del mismo contenido; longitud de clave inválida; objeto cifrado demasiado corto; rotación de clave maestra de punta a punta (envolver con la vieja, rotar, desenvolver igual vía `R2_ENCRYPTION_KEYS_ANTERIORES`); error claro cuando un `cifradoClaveId` no existe ni activo ni en anteriores.

`src/infra/storage/__tests__/almacenamiento.test.ts` (7 pruebas): contrato de `ClienteAlmacenamientoMemoria` (subir/descargar/eliminar/existe, copia defensiva, error claro en objeto inexistente) y de `construirClaveObjetoCifrado` (prefijo por tenant, nunca el nombre de archivo original del usuario).

Integración real contra R2 (`ClienteAlmacenamientoR2`) solo puede probarse con credenciales reales — mismo criterio "Windows-only" ya usado para `test:integration` contra Neon, documentado en `PLAN-DE-TRABAJO.md`.

## Consecuencias

**Positivas:** el objeto que llega a R2 es siempre ciphertext bajo una clave que Cloudflare nunca conoce — un token de R2 filtrado o un bucket mal configurado ya no exponen el CSV en claro. `ClienteAlmacenamiento` (interfaz) + `ClienteAlmacenamientoMemoria` permiten probar todo el flujo de cifrado/persistencia sin credenciales reales de R2, mientras Alex completa el setup de Cloudflare.

**Negativas / riesgos, con mitigación:** (a) pérdida de la clave maestra sin backup = CSVs permanentemente ilegibles — mitigado con la recomendación de backup offline, sin garantía técnica (fuera del alcance de este proyecto con presupuesto $0). (b) `MAX_TAMANO_ARCHIVO_BYTES` bajó de 5 MB a 4 MB porque el CSV ahora pasa por el body del Route Handler en vez de subir directo del navegador a R2 — documentado en `src/domain/limitesImportacionCsv.ts`. (c) responsabilidad operativa nueva (rotación, custodia) que no existía con "solo el cifrado por defecto de R2" — mitigada con el procedimiento de rotación ya diseñado (re-envolver, no re-cifrar) y el registro en `SEGURIDAD-credenciales.md`.

**Reversibilidad:** media. Dejar de cifrar en aplicación (volver a depender solo del cifrado por defecto de R2) es un cambio de código acotado (dejar de llamar a `cifradoObjeto.ts` antes de subir), pero las filas ya cifradas seguirían necesitando las claves existentes para volver a leerse — no es instantáneamente reversible para datos ya subidos. Rotar la clave maestra, en cambio, es una operación diseñada para ser barata y frecuente (re-envolver DEKs, no re-cifrar objetos).

## Estado de aprobación

Aceptado por Alex el 2026-09-24, con los siete requisitos técnicos listados arriba, todos incorporados al diseño e implementados en `src/infra/storage/` antes de tener credenciales reales de R2 (pedido explícito: "avanzar con el cliente de almacenamiento simulado, cifrado y pruebas locales" mientras se completa el setup de Cloudflare). Pendiente de validación contra R2 real (Windows, mismo criterio de siempre) una vez Alex configure el bucket y las credenciales — ver checklist en `PLAN-DE-TRABAJO.md`.
