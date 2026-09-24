# Seguridad — Credenciales a rotar

Fecha de creación: 2026-09-12

Este documento rastrea credenciales que se compartieron en texto plano durante las sesiones de trabajo con Claude (por chat, para poder configurar el entorno) y que por lo tanto deben tratarse como potencialmente expuestas, aunque el riesgo real sea bajo hoy (proyecto en desarrollo, sin datos de producción ni usuarios reales todavía). **Ninguna contraseña o token real se guarda en este archivo** — es un checklist de qué rotar, dónde se usa, y cómo — siguiendo la norma de los apuntes de Seguridad de "higiene de repositorios": nunca credenciales reales dentro del control de versiones.

## Pendientes

| Credencial | Dónde se usa | Expuesta el | Estado | Cómo rotarla |
|---|---|---|---|---|
| Personal Access Token de GitHub | Push automático a este repo desde la Mac (credential store de git, configurado por Claude) | 2026-09-12 | Activo a propósito | Revocar en https://github.com/settings/tokens cuando termines de trabajar con Claude en este repo o prefieras volver a autenticación manual. Al revocarlo, el próximo push automático va a fallar y hay que generar uno nuevo si se quiere mantener el flujo automático. |
| Contraseña del rol `neondb_owner` (Neon — dueño de la base, usado para migraciones) | `prisma migrate` (temporalmente en `DATABASE_URL`) y `SEED_DATABASE_URL`/`SHADOW_DATABASE_URL` en `.env` | 2026-09-12, rotada el 2026-09-14 (contraseña nueva expuesta ese día), **rotada de nuevo el 2026-09-15** | Rotada — valor nuevo nunca pegado en el chat | En Neon: panel del proyecto → Connect to your database (o Roles) → `neondb_owner` → Reset password. Actualizar `SEED_DATABASE_URL` y `SHADOW_DATABASE_URL` en `.env` con la contraseña nueva (y `DATABASE_URL` solo si en ese momento está temporalmente en este rol para migrar). |
| Contraseña del rol `chainpulse_app` (Neon — rol restringido, sujeto a RLS) | `DATABASE_URL` de desarrollo diario en `.env` | 2026-09-12, rotada el 2026-09-14 (contraseña nueva expuesta ese día), **rotada de nuevo el 2026-09-15** | Rotada — valor nuevo nunca pegado en el chat | En Neon: Connect to your database → Role → `chainpulse_app` → Reset password. Actualizar `DATABASE_URL` en `.env` con el valor nuevo. |
| `NEXTAUTH_SECRET` (Auth.js — firma las sesiones JWT) | `.env`, todas las sesiones activas | 2026-09-14 (se regeneró y quedó pegado en el chat), **regenerado de nuevo el 2026-09-15** | Rotado — valor nuevo nunca pegado en el chat | Generar uno nuevo: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Actualizar `NEXTAUTH_SECRET` en `.env`. Rotar esto cierra la sesión de todo el mundo (tienen que volver a loguearse) pero no toca ningún dato. |

## Buenas prácticas para adelante (checklist de los apuntes de Seguridad)

- Evitar pegar contraseñas o tokens reales en el chat cuando se pueda — si hace falta para avanzar, que la rotación quede registrada acá en vez de repetir el valor más de lo necesario.
- Ningún secreto real debe llegar nunca al repositorio de git — `.env` ya está en `.gitignore`, verificar que se mantenga así en cada cambio.
- Al desplegar a producción, usar el mecanismo de variables de entorno/secretos del proveedor de hosting (no archivos versionados) — ver ADR-0003 para la política de secretos de autenticación (`NEXTAUTH_SECRET`, etc.).
- Cuando se implemente RF1/RF4 (ADR-0003), aplicar el mismo criterio a los secretos de MFA (TOTP) y de sesión.

## Custodia de claves de cifrado de aplicación (R2)

Política completa (generación, envelope encryption, rotación, retención de claves viejas) en [`docs/ADR/0006-cifrado-r2.md`](./docs/ADR/0006-cifrado-r2.md) -- esta sección es solo el registro de custodia, mismo espíritu que la tabla de arriba pero para claves que **nunca deberían pasar por el chat**, ni siquiera una vez.

- `R2_ENCRYPTION_KEY_ACTIVA`/`R2_ENCRYPTION_KEY_ACTIVA_ID`: Alex las genera él mismo (comando en el ADR) y las carga directo en Vercel/`.env` -- nunca se le pide ni se le pega el valor en el chat.
- **Backup offline pendiente [HUMANO]:** sin esta clave respaldada en algún lugar fuera de Vercel (gestor de contraseñas, archivo cifrado aparte), perderla vuelve ilegibles todos los CSV ya subidos que dependan de ella -- ver ADR-0006, sección de custodia. Registrar acá cuando el backup exista.
- `R2_ENCRYPTION_KEYS_ANTERIORES`: vacío hasta la primera rotación. Cada rotación real (clave retirada, id, fecha, motivo) se agrega como fila nueva abajo, igual que las rotaciones de Neon/`NEXTAUTH_SECRET`.

| Clave (id) | Estado | Fecha de rotación | Motivo |
|---|---|---|---|
| _(ninguna generada todavía)_ | -- | -- | -- |

## Historial

- 2026-09-12: primera versión, tras levantar la base en Neon y aplicar RLS con el rol `chainpulse_app`.
- 2026-09-14: durante la migración de RNF9 (primera migración de schema real del proyecto), una edición manual de `.env` en Windows borró por error casi todo su contenido salvo `DATABASE_URL`/`RATE_LIMIT_STORE_URL`. Para reconstruirlo hubo que rotar `neondb_owner` y `chainpulse_app` en Neon y regenerar `NEXTAUTH_SECRET` — y en el ida y vuelta por chat para diagnosticar el problema, varias de esas contraseñas (las viejas y las nuevas) quedaron pegadas en texto plano en la conversación más de una vez. Ninguna se escribió en este repositorio ni en ningún archivo versionado, pero las tres (`neondb_owner`, `chainpulse_app`, `NEXTAUTH_SECRET`) quedan marcadas como pendientes de rotar de nuevo más arriba, ya con .env reconstruido y funcionando. `RESEND_API_KEY`/`RESEND_FROM_EMAIL` se perdieron en la misma edición y quedaron vacíos en `.env` -- no están en esta tabla porque no llegaron a exponerse (nunca se volvieron a pegar), pero hay que volver a cargarlos desde el dashboard de Resend para que RF4 (invitar responsables) y el aviso de apertura de ciclo vuelvan a enviar correos.
- 2026-09-15: se rotaron de nuevo las tres credenciales marcadas pendientes desde el incidente del 2026-09-14 (`neondb_owner`, `chainpulse_app`, `NEXTAUTH_SECRET`). Esta vez los valores **nuevos** nunca se pegaron en el chat -- se confirmo cada paso con "listo" en vez de pegar el contenido del `.env` (en el camino se volvieron a pegar por error algunos valores **viejos**, ya marcados como expuestos desde antes, sin agregar exposicion nueva). Validado de punta a punta en Windows: reinicio de `npm run dev`, login exitoso con la contraseña nueva de `chainpulse_app`, dashboard con los datos existentes intactos (4 eslabones, 3 conexiones).
