# Seguridad — Credenciales a rotar

Fecha de creación: 2026-09-12

Este documento rastrea credenciales que se compartieron en texto plano durante las sesiones de trabajo con Claude (por chat, para poder configurar el entorno) y que por lo tanto deben tratarse como potencialmente expuestas, aunque el riesgo real sea bajo hoy (proyecto en desarrollo, sin datos de producción ni usuarios reales todavía). **Ninguna contraseña o token real se guarda en este archivo** — es un checklist de qué rotar, dónde se usa, y cómo — siguiendo la norma de los apuntes de Seguridad de "higiene de repositorios": nunca credenciales reales dentro del control de versiones.

## Pendientes

| Credencial | Dónde se usa | Expuesta el | Estado | Cómo rotarla |
|---|---|---|---|---|
| Personal Access Token de GitHub | Push automático a este repo desde la Mac (credential store de git, configurado por Claude) | 2026-09-12 | Activo a propósito | Revocar en https://github.com/settings/tokens cuando termines de trabajar con Claude en este repo o prefieras volver a autenticación manual. Al revocarlo, el próximo push automático va a fallar y hay que generar uno nuevo si se quiere mantener el flujo automático. |
| Contraseña del rol `neondb_owner` (Neon — dueño de la base, usado para migraciones) | `prisma migrate` (temporalmente en `DATABASE_URL` cuando hace falta migrar) | 2026-09-12 | Pendiente de rotar | En Neon: panel del proyecto → Postgres database → Roles → `neondb_owner` → Reset password. Actualizar el valor comentado en `.env` con la contraseña nueva. |
| Contraseña del rol `chainpulse_app` (Neon — rol restringido, sujeto a RLS) | `DATABASE_URL` de desarrollo diario en `.env` | 2026-09-12 | Pendiente de rotar | En Neon: Roles → `chainpulse_app` → Reset password (o `ALTER ROLE chainpulse_app WITH PASSWORD '...';` desde el SQL Editor). Actualizar `DATABASE_URL` en `.env` con el valor nuevo. |

## Buenas prácticas para adelante (checklist de los apuntes de Seguridad)

- Evitar pegar contraseñas o tokens reales en el chat cuando se pueda — si hace falta para avanzar, que la rotación quede registrada acá en vez de repetir el valor más de lo necesario.
- Ningún secreto real debe llegar nunca al repositorio de git — `.env` ya está en `.gitignore`, verificar que se mantenga así en cada cambio.
- Al desplegar a producción, usar el mecanismo de variables de entorno/secretos del proveedor de hosting (no archivos versionados) — ver ADR-0003 para la política de secretos de autenticación (`NEXTAUTH_SECRET`, etc.).
- Cuando se implemente RF1/RF4 (ADR-0003), aplicar el mismo criterio a los secretos de MFA (TOTP) y de sesión.

## Historial

- 2026-09-12: primera versión, tras levantar la base en Neon y aplicar RLS con el rol `chainpulse_app`.
