# Anexo — línea base de `git fsck --full` antes de la cuarentena (2026-11-27)

Ejecutado de solo lectura, autorizado explícitamente por Alex el 2026-11-27, **antes de mover ningún lock ni `tmp_obj_*`** (la cuarentena en sí sigue sin autorizar).

**Comando:** `git fsck --full --unreachable --dangling`
**Fecha/hora (UTC):** 2026-11-27 05:14:52
**Exit code:** 0
**Errores/corrupción encontrados:** ninguno (sin coincidencias de "error", "missing", "corrupt", "invalid", "broken" en la salida).

**Resumen:**
- 622 líneas totales.
- 435 `unreachable tree`
- 158 `unreachable blob`
- 29 `unreachable commit`

**Hashes del archivo de salida (para verificar integridad de este anexo más adelante):**
- `fsck-2026-11-27.txt` (orden original de git): `0c949339a31a7ed6945ad995e0b2024c319a7eb996765338603ad524f10efb88`
- `fsck-2026-11-27.ordenado.txt` (ordenado alfabéticamente, para comparar después sin falsos positivos de orden): `7c5834f20ec529ee4f571eb164b8325004358c876bb5f2077fb3267d4e37a6a4`

Este anexo es la línea base contra la que se compararía un segundo `git fsck --full --unreachable --dangling` (también ordenado) **después** de ejecutar la cuarentena, cuando esa ejecución se autorice por separado. Si algo en la comparación cambia más allá de lo esperado, se reporta antes de seguir.

## Listado completo (ordenado)

```
unreachable blob 002858b7a1778ed1f6a403a60f423cf19b4c7de8
unreachable blob 094a0701231c865d3a8719611a8502d7491415a5
unreachable blob 09739b621f743ac2a98b00c2ac2c2550c0524382
unreachable blob 0b0a51684bfabad4012ea18c3cf6ba669b19bcea
unreachable blob 0ec54999252152d7173ee899cc575e8cc600a6be
unreachable blob 0f4dec497c80d2119da27b09155ddd58b7170c1e
unreachable blob 0fb1c57e0c23a90829308e63911f42a63e6b4d2b
unreachable blob 0fcf0fe9a846b1b79525202219af8b4ac6a4092f
unreachable blob 10e6fdf7b856978dbdb4ff7fb97ed2e1ca34e614
unreachable blob 1334a645f20fc4331f9476f01900967676a3c56f
(... ver archivo completo en el repositorio de trabajo; este anexo documenta los conteos y hashes de verificación, no reproduce las 622 líneas completas para mantener el documento legible — el archivo fuente completo puede regenerarse en cualquier momento con el mismo comando contra el mismo HEAD, `1eec670ef7e6c7a3adc1d59fe880f294e42baf78`, mientras nada se haya movido todavía)
```
---

## Cierre posterior — verificación tras la cuarentena y el PR #41 (2026-11-27)

- **Segundo `git fsck --full --unreachable --dangling`** ejecutado después de mover los 379 `tmp_obj_*` y los 2 locks originales a la cuarentena externa: salida idéntica a la línea base de este anexo (mismo exit code 0, mismos conteos — 435 `unreachable tree`, 158 `unreachable blob`, 29 `unreachable commit` —, sin ninguna línea de "error", "missing", "corrupt", "invalid" ni "broken"). Guardado en la cuarentena como `fsck-despues.txt`/`fsck-despues.ordenado.txt`, comparado con `diff` contra la línea base de este anexo sin diferencias.
- **Cuarentena, estado real a esta fecha:** 379 `tmp_obj_*` (conservando su ruta relativa original dentro de `objetos-temporales/`), y 1 archivo sensible en cuarentena (`sensitive/ChainPulse-pr4-bypass-preview/.env.example`, con el secreto `AUTH_PLATAFORMA_SECRET`, sin usar ni exponer su valor). Residuos de bloqueo ya contenidos en la cuarentena: 6 archivos regulares con extensión .lock, todos de 0 bytes —2 originales, 2 generados durante la creación del worktree de Next.js y 2 generados durante el commit d07ccdb—, más 1 marcador administrativo locked de 13 bytes procedente del worktree. El marcador locked no es un archivo .lock vacío y se contabiliza por separado. Adicionalmente, apareció un nuevo .git/objects/maintenance.lock de 0 bytes después del git fetch del cierre; permanece fuera de la cuarentena y pendiente de autorización separada.
- **PR de Next.js:** el PR #41 (`fix/next-security-15.5.29`, commit `d07ccdb42d9e65926e2f06953935306661c6b3b4`) quedó fusionado en `main` mediante el merge commit `ba3ae389040a7f4f0d00da534450c974b1310b72`. `main` fija ahora `next` en `15.5.29` (antes `^15.5.26`).
- **`npm audit` tras el merge:** 26 vulnerabilidades (15 moderadas, 8 altas, 3 críticas) — baja de 27 antes del bump. `next` y `sharp` ya no figuran como paquetes vulnerables directos en el reporte.
