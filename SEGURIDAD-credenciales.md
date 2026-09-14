# Seguridad — Credenciales a rotar

Fecha de creación: 2026-09-12

Este documento rastrea credenciales que se compartieron en texto plano durante las sesiones de trabajo con Claude (por chat, para poder configurar el entorno) y que por lo tanto deben tratarse como potencialmente expuestas, aunque el riesgo real sea bajo hoy (proyecto en desarrollo, sin datos de producción ni usuarios reales todavía). **Ninguna contraseña o token real se guarda en este archivo** — es un checklist de qué rotar, dónde se usa, y cómo — siguiendo la norma de los apuntes de Seguridad de "higiene de repositorios": nunca credenciales reales dentro del control de versiones.

## Pendientes

| Credencial | Dónde se usa | Expuesta el | Estado | Cómo rotarla |
|---|---|---|---|---|
| Personal Access Token de GitHub | Push automático a este repo desde la Mac (credential store de git, configurado por Claude) | 2026-09-12 | Activo a propósito | Revocar en https://github.com/settings/tokens cuando termines de trabajar con Claude en este repo o prefieras volver a autenticación manual. Al revocarlo, el próximo push automático va a fallar y hay que generar uno nuevo si se quiere mantener el flujo automático. |
| Contraseña del rol `neondb_owner` (Neon — dueño de la base, usado para migraciones) | `prisma migrate` (temporalmente en `DATABASE_URL`) y `SEED_DATABASE_URL`/`SHADOW_DATABASE_URL` en `.env` | 2026-09-12, rotada el 2026-09-14 durante la migración de RNF9 — pero la contraseña nueva también quedó pegada en el chat varias veces esa misma sesión (confusión de `.env` en Windows, ver README) | Pendiente de rotar de nuevo | En Neon: panel del proyecto → Connect to your database (o Roles) → `neondb_owner` → Reset password. Actualizar `SEED_DATABASE_URL` y `SHADOW_DATABASE_URL` en `.env` con la contraseña nueva (y `DATABASE_URL` solo si en ese momento está temporalmente en este rol para migrar). |
| Contraseña del rol `chainpulse_app` (Neon — rol restringido, sujeto a RLS) | `DATABASE_URL` de desarrollo diario en `.env` | 2026-09-12, rotada el 2026-09-14 (mismo incidente que arriba) — la contraseña nueva también quedó expuesta en el chat | Pendiente de rotar de nuevo | En Neon: Connect to your database → Role → `chainpulse_app` → Reset password. Actualizar `DATABASE_URL` en `.env` con el valor nuevo. |
| `NEXTAUTH_SECRET` (Auth.js — firma las sesiones JWT) | `.env`, todas las sesiones activas | 2026-09-14 (se regeneró durante el mismo incidente y también quedó pegado en el chat) | Pendiente de rotar de nuevo | Generar uno nuevo: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Actualizar `NEXTAUTH_SECRET` en `.env`. Rotar esto cierra la sesión de todo el mundo (tienen que volver a loguearse) pero no toca ningún dato. |

## Buenas prácticas para adelante (checklist de los apuntes de Seguridad)

- Evitar pegar contraseñas o tokens reales en el chat cuando se pueda — si hace falta para avanzar, que la rotación quede registrada acá en vez de repetir el valor más de lo necesario.
- Ningún secreto real debe llegar nunca al repositorio de git — `.env` ya está en `.gitignore`, verificar que se mantenga así en cada cambio.
- Al desplegar a producción, usar el mecanismo de variables de entorno/secretos del proveedor de hosting (no archivos versionados) — ver ADR-0003 para la política de secretos de autenticación (`NEXTAUTH_SECRET`, etc.).
- Cuando se implemente RF1/RF4 (ADR-0003), aplicar el mismo criterio a los secretos de MFA (TOTP) y de sesión.

## Historial

- 2026-09-12: primera versión, tras levantar la base en Neon y aplicar RLS con el rol `chainpulse_app`.
- 2026-09-14: durante la migración de RNF9 (primera migración de schema real del proyecto), una edición manual de `.env` en Windows borró por error casi todo su contenido salvo `DATABASE_URL`/`RATE_LIMIT_STORE_URL`. Para reconstruirlo hubo que rotar `neondb_owner` y `chainpulse_app` en Neon y regenerar `NEXTAUTH_SECRET` — y en el ida y vuelta por chat para diagnosticar el problema, varias de esas contraseñas (las viejas y las nuevas) quedaron pegadas en texto plano en la conversación más de una vez. Ninguna se escribió en este repositorio ni en ningún archivo versionado, pero las tres (`neondb_owner`, `chainpulse_app`, `NEXTAUTH_SECRET`) quedan marcadas como pendientes de rotar de nuevo más arriba, ya con .env reconstruido y funcionando. `RESEND_API_KEY`/`RESEND_FROM_EMAIL` se perdieron en la misma edición y quedaron vacíos en `.env` -- no están en esta tabla porque no llegaron a exponerse (nunca se volvieron a pegar), pero hay que volver a cargarlos desde el dashboard de Resend para que RF4 (invitar responsables) y el aviso de apertura de ciclo vuelvan a enviar correos.
