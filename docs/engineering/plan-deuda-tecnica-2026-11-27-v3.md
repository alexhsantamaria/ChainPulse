# Plan de trabajo — deuda técnica abierta de ChainPulse (corregido, v3)

**Fecha:** 2026-11-27 — corrige la v2 (entregada horas antes el mismo día) con 7 correcciones puntuales adicionales pedidas y confirmadas. Esta es la **tercera** ronda de correcciones sobre este documento; las secciones 0.1 y 0.2 llevan el historial completo.

**Entrega de archivos — aclaración de esta ronda (corrige el punto 1 de más abajo):** este Markdown y su DOCX correspondiente son dos archivos reales, separados, con su extensión correcta — nunca un DOCX renombrado como `.md` ni viceversa. Los nombres finales de esta ronda son:
- `plan-deuda-tecnica-2026-11-27-v3.md` (texto plano UTF-8)
- `plan-deuda-tecnica-2026-11-27-v3.docx` (Microsoft Word 2007+)

Ambos se entregan en envíos separados de la conversación ("Claude outputs"), y el `.md` se guarda además, en esta misma ronda, como archivo real dentro de `docs/engineering/` del repositorio autoritativo (ver "Ubicación en el repositorio" más abajo). No encontré, al reverificar los archivos de la ronda anterior, ningún defecto real de tipo/extensión en lo que ya se había entregado — pero adopto de aquí en más la práctica de declarar los nombres de archivo exactos en el propio documento, para que no quede ninguna ambigüedad de cuál es cuál.

**Ubicación en el repositorio (corrige el punto 2 de más abajo):**
- El Markdown definitivo de este plan y el anexo de `fsck` se guardan como archivos reales dentro de `docs/engineering/` del repositorio `ChainPulse`, en el árbol de trabajo de `main`, **sin `git add` ni commit** (quedan como archivos nuevos no rastreados — `??` en `git status` — hasta que el equipo decida versionarlos explícitamente).
- **Recomendación sobre el DOCX (a confirmar con el equipo, no decidido unilateralmente):** el repositorio ya tiene el precedente de guardar pares `.md`+`.docx` dentro de `docs/` (`docs/ADR/0001-arquitectura-inicial.{md,docx}`, `docs/architecture/rf19-rf20/adenda-diseno-rf19-rf20-v6.{md,docx}` y `-v7.{md,docx}`, `auditoria-diseno-rf19-rf20.{md,docx}`), incluso con un `SHA256SUMS.txt` de verificación en esa carpeta. Mi recomendación es **mantener el DOCX como entrega externa únicamente** (vía chat, no versionado en el repositorio) para este documento en particular, porque es un plan de trabajo operativo y transitorio — a diferencia de las ADR y los diseños de arquitectura, que son registros de decisión permanentes — pero esto es una recomendación, no un hecho consumado: si el equipo prefiere seguir el mismo patrón de `docs/ADR/` y versionar también el `.docx` (y agregar su hash a un `SHA256SUMS.txt` de `docs/engineering/`), es una autorización puntual que falta y que se ejecutaría en una ronda aparte.

**Estado de ejecución a partir de este documento — actualizado al cierre (2026-11-27, tras el PR #41):**
- **Ejecutado (autorizado explícitamente, de solo lectura):** `git fsck --full --unreachable --dangling` sobre `main`. Resultado en la Sección 1 y en el anexo `anexo-fsck-baseline-pre-cuarentena-2026-11-27.md`.
- **Ejecutado (autorizado, investigación externa de solo lectura):** lectura de los changelogs oficiales de Zod y Vitest, y análisis estático (grep) del código actual — ver Sección 4. Ningún paquete de ese lote se instaló todavía.
- **Ejecutado (autorizado explícitamente — "guarda... dentro de docs/engineering/"):** escritura de este Markdown y del anexo de `fsck` como archivos reales dentro de `docs/engineering/` del repositorio, sin staging ni commit (actualizados nuevamente en este cierre).
- **Ejecutado y cerrado — cuarentena (Sección 1):** los 379 `tmp_obj_*` y los locks huérfanos movidos (nunca borrados) a la cuarentena externa, inventario SHA-256 generado y verificado, segundo `git fsck` comparado sin diferencias contra la línea base. Ver "1.3 Ejecución real (cierre)" para el detalle completo, incluyendo los locks adicionales generados después por la creación del worktree y por el commit de Next.js.
- **Ejecutado y cerrado — PR urgente de Next.js (Sección 2a):** `next` fijado en `15.5.29` (`--save-exact`), validado en entorno aislado, commiteado (`d07ccdb42d9e65926e2f06953935306661c6b3b4`) y fusionado en `main` mediante el PR #41 (merge commit `ba3ae389040a7f4f0d00da534450c974b1310b72`). Ver "2a. Cierre" para el detalle.
- **Diseñado, no ejecutado:** el PR de `.gitattributes` (Sección 3) y la fase de instalación aislada de los spikes de Zod y Vitest (Sección 4).
- **Todavía NO autorizado, no ejecutado:** el resto del lote de `npm audit fix` sin Next.js (Sección 2b), restaurar el CRLF del árbol de trabajo, instalar o actualizar cualquier otra dependencia, decidir la rotación o el destino de `AUTH_PLATAFORMA_SECRET`, ni borrar la cuarentena.

---

## 0.0 Las 7 correcciones de esta ronda (tercera, 2026-11-27)

1. **No renombrar un DOCX como `.md`:** ver "Entrega de archivos" arriba — nombres finales declarados explícitamente, archivos reales y separados.
2. **Ubicación en el repositorio:** este Markdown y el anexo de `fsck` ahora se guardan físicamente dentro de `docs/engineering/` del repositorio autoritativo (ver arriba y "Qué se necesita para seguir"); recomendación explícita (no decisión unilateral) sobre si el DOCX también se versiona.
3. **Corrección aritmética en la Sección 2b:** "26 vulnerabilidades" era un error — la cifra correcta es **18**. Ver la Sección 2b corregida, con el desglose completo 27 = 1 + 8 + 18.
4. **Cuarentena de `tmp_obj_*`:** rediseñada para conservar la ruta relativa de cada archivo dentro de `.git/objects/` (nunca aplanar en una sola carpeta), y el inventario de hashes ahora se genera ordenado por ruta. Ver Sección 1.2 corregida.
5. **Decisión de versión de Next.js explicitada:** `--save-exact` fija la versión exacta en vez de conservar el rango `^`; se documentan ambas opciones en la Sección 2a, sin elegir unilateralmente.
6. **CRLF — expectativa honesta del resultado:** como los 6 blobs de `HEAD` ya están en LF, restaurar y renormalizar probablemente no deje ningún cambio de contenido en esos 6 archivos — el único artefacto nuevo esperable del PR es `.gitattributes`. No se fuerza ningún cambio artificial. Ver Sección 3 corregida.
7. **Rutas finales y `git status` de solo lectura:** entregados al cierre de este documento, después de escribir los dos archivos en `docs/engineering/` y sin tocar nada más.

Ninguna acción de movimiento, restauración, instalación, staging o commit se ejecutó en esta ronda — únicamente la escritura de los dos archivos de documentación dentro de `docs/engineering/`, que fue lo explícitamente pedido.

---

## 0.1 — 0.2 Historial de rondas anteriores (sin cambios, se conserva para trazabilidad)

### 0.1 Las 7 correcciones de la segunda ronda (aplicadas en la v2)

1. Entrega de archivos: Markdown y DOCX enviados en dos mensajes separados; ambos reverificados (`.md` UTF-8 sin BOM; `.docx` ZIP válido sin entradas de carpeta sueltas).
2. El CRLF no lo introdujo el merge: los 6 blobs en `HEAD` (`1eec670...`) tienen 0 líneas con `\r` — son LF puro. La conversión ocurre en el árbol de trabajo del Mac. Mecanismo probable: `core.autocrlf=true` por defecto del instalador de Git para Windows (no verificado en la máquina específica de Alex); el Git nativo del Mac tiene `core.autocrlf` sin configurar.
3. Typecheck en Windows: según Alex, ya corrió y pasó sobre el código vigente (dato aportado por él, no verificado por mí). Verificado de forma independiente: hoy, desde el Mac, no se puede correr (`node_modules` de `main` no tiene `typescript` instalado) — el problema actual es un entorno de dependencias incompleto en el Mac, no un defecto del código.
4. Cuarentena rediseñada fuera de `.git`, con inventario y hash SHA-256 de los 379 `tmp_obj_*` generado antes de moverlos, sin afirmar "riesgo cero".
5. Comparación de `git fsck` ordenada antes de comparar.
6. Restauración del CRLF con `git restore --worktree --source=HEAD`, no `git checkout --`.
7. Next.js como PR de seguridad urgente e independiente, separado del lote general de `npm audit fix`.

### 0.2 Primera ronda de correcciones (aplicadas en la v1 del 2026-11-27)

Confirmación de que PR #40 ya estaba fusionado (`main` en `1eec670...`); consolidación a 4 frentes; retiro del baseline obsoleto de "~24 errores de TypeScript"; reemplazo de las cifras de `npm audit` por la auditoría real (27 vulnerabilidades: 14 moderadas, 9 altas, 4 críticas); ampliación de alcance a Next, Sentry, Prisma, Vite, Vitest y Zod; diseño de cuarentena recuperable (sin `git gc --prune=now` ni borrado definitivo); propuesta de PR de `.gitattributes`; autorización de los dos spikes de solo lectura.

---

## 1. Locks huérfanos + `tmp_obj_*` — cuarentena fuera de `.git`, con inventario, hashes y `fsck` ordenado

### 1.1 `git fsck --full` inicial — YA EJECUTADO (autorizado, de solo lectura)

- **Comando:** `git fsck --full --unreachable --dangling`
- **Exit code:** 0. **Sin errores ni corrupción.**
- **Resumen:** 622 líneas — 435 `unreachable tree`, 158 `unreachable blob`, 29 `unreachable commit`.
- Guardado como anexo (`anexo-fsck-baseline-pre-cuarentena-2026-11-27.md`), con los hashes SHA-256 del archivo de salida (original y ordenado).

### 1.2 Diseño de la cuarentena — corregido en esta ronda (todavía no ejecutado)

**Ubicación: fuera de `.git` por completo** — una carpeta hermana del repositorio:

```
$HOME/mnt/BigDevelopment/Proyectos/_cuarentena-git-chainpulse-2026-11-27/
  locks/
  objetos-temporales/        (preserva la jerarquía de subcarpetas de .git/objects/, ver paso 4)
  inventario-tmp-obj-2026-11-27.sha256   (ordenado por ruta, ver paso 2)
  fsck-antes.ordenado.txt
  fsck-despues.ordenado.txt   (se genera recién en el paso 5)
```

Al estar completamente fuera del árbol de trabajo del repositorio, no aparece en `git status` de `ChainPulse` y no requiere ninguna regla de exclusión en `.gitignore` ni en `.git/info/exclude`.

**Pasos propuestos, en orden:**

1. *(Ya hecho)* `git fsck --full --unreachable --dangling` → guardado y ordenado como línea base.
2. **Generar el inventario con hash antes de mover nada, ordenado por ruta (corregido en esta ronda):**
   ```
   find .git/objects -name "tmp_obj_*" -exec sha256sum {} \; | sort -k2 > inventario-tmp-obj-2026-11-27.sha256
   ```
   `sort -k2` ordena por la segunda columna (la ruta), no por el hash, para que el inventario sea legible y fácil de cruzar visualmente contra la estructura de carpetas de la cuarentena. Sigue siendo puramente de lectura — no mueve ni modifica ningún archivo.
3. Re-verificar, en el momento de ejecutar, las 3 condiciones de siempre para cada uno de los 2 locks huérfanos: (a) archivo regular de 0 bytes, (b) ningún proceso git lo tiene abierto, (c) el destino de cuarentena no existe todavía.
4. **Mover (nunca borrar) preservando la ruta relativa — corregido en esta ronda:** los `tmp_obj_*` pueden existir en distintas subcarpetas de `.git/objects/` (el *sharding* de 2 caracteres que usa git). Si se aplanaran todos en una sola carpeta, dos archivos de subcarpetas distintas con el mismo nombre de archivo temporal (coincidencia de nombre, no de contenido) se pisarían entre sí. En vez de eso, se reproduce la misma jerarquía dentro de `objetos-temporales/`:
   ```
   DEST="$HOME/mnt/BigDevelopment/Proyectos/_cuarentena-git-chainpulse-2026-11-27/objetos-temporales"
   find .git/objects -name "tmp_obj_*" | while IFS= read -r f; do
     rel="${f#.git/objects/}"
     mkdir -p "$DEST/$(dirname "$rel")"
     mv "$f" "$DEST/$rel"
   done
   ```
   Un `tmp_obj_*` que hoy está en `.git/objects/4a/tmp_obj_XXXX` termina en `objetos-temporales/4a/tmp_obj_XXXX` — nunca junto a uno de `.git/objects/7f/` en una carpeta plana. Los 2 locks huérfanos se mueven igual, a `locks/`, conservando su nombre original.
5. `git fsck --full --unreachable --dangling`, **ordenar la salida** (`sort > fsck-despues.ordenado.txt`) y compararla con `diff` contra `fsck-antes.ordenado.txt` del paso 1 — deben coincidir exactamente.
6. Chequeo funcional básico: `git log --oneline -5`, `git status`, `git show HEAD --stat`.
7. Para el worktree huérfano (`ChainPulse-pr4-bypass-preview`): `git worktree prune --dry-run` (solo lectura) primero; autorización separada para el `prune` real.

**Sobre el riesgo — sin afirmar cero:** mover estos archivos es de **bajo riesgo, no riesgo nulo**. Los `tmp_obj_*` son, por diseño de git, archivos temporales de escrituras en curso o interrumpidas, sin referencia desde ningún commit/rama/tag. No hay garantía absoluta de que, en el instante exacto de la operación, un proceso git distinto no esté en medio de una escritura — de ahí la verificación de procesos inmediatamente antes, y la comparación de `fsck` antes/después como red de seguridad adicional, no como prueba matemática de inocuidad.

**Retención:** 2-4 semanas sugeridas antes de cualquier borrado definitivo, que sería un paso separado y explícito más adelante.

**Autorizaciones puntuales pendientes:** generar el inventario de hashes, mover los 2 locks, mover los 379 `tmp_obj_*` (con preservación de ruta), correr y comparar el `fsck` final, y — por separado — el `worktree prune` real.

**Esfuerzo estimado:** 30-45 minutos.

---

### 1.3 Ejecución real (cierre, 2026-11-27)

Todos los pasos de 1.2 se ejecutaron, uno por uno, con autorización explícita y separada para cada uno, exactamente como estaba diseñado:

- Inventario SHA-256 de los 379 `tmp_obj_*` generado, ordenado por ruta (`inventario-tmp-obj-2026-11-27.sha256`).
- Los 2 locks originales (`objects/maintenance.lock`, `worktrees/ChainPulse-pr4-bypass-preview/HEAD.lock`) movidos a `locks/`, conservando ruta relativa, tras reverificar las 3 condiciones.
- Los 379 `tmp_obj_*` movidos a `objetos-temporales/`, conservando íntegramente su ruta relativa dentro de `.git/objects/`. Verificado: cero restantes en `.git/objects`, 379 en cuarentena, coincidencia completa de ruta/tamaño/hash contra el inventario.
- Segundo `git fsck --full --unreachable --dangling` ejecutado y comparado (ordenado) contra la línea base: **sin diferencias** (mismo exit code 0, mismos conteos, sin `error`/`missing`/`corrupt`/`invalid`/`broken`). `HEAD`, `git status`, `git log` y `git show` verificados sin cambios.
- **Locks adicionales, no previstos en el diseño original, generados por operaciones posteriores de git en este mismo entorno (misma causa estructural: esta carpeta conectada no permite borrar archivos por defecto, así que git no puede limpiar sus propios temporales):**
  - 3 locks generados al crear el worktree `ChainPulse-fix-next-security-15.5.29` (`HEAD.lock`, un `.lock` de referencia de rama, y un archivo `locked`) — puestos en cuarentena en `locks/` junto con los 2 originales.
  - 2 locks generados por el commit `d07ccdb` en ese mismo worktree (`HEAD.lock` del worktree, y un nuevo `objects/maintenance.lock`) — puestos en cuarentena por separado en `locks/post-next-d07ccdb/`, preservando su ruta relativa.
  - Un tercer `objects/maintenance.lock` apareció tras un `git fetch origin --prune` de solo lectura — detectado, verificado como archivo regular de 0 bytes sin proceso usándolo, y reportado; **pendiente de autorización para ponerlo en cuarentena**.
  - Residuos de bloqueo ya contenidos en la cuarentena: 6 archivos regulares con extensión .lock, todos de 0 bytes —2 originales, 2 generados durante la creación del worktree de Next.js y 2 generados durante el commit d07ccdb—, más 1 marcador administrativo locked de 13 bytes procedente del worktree. El marcador locked no es un archivo .lock vacío y se contabiliza por separado. Adicionalmente, apareció un nuevo .git/objects/maintenance.lock de 0 bytes después del git fetch del cierre; permanece fuera de la cuarentena y pendiente de autorización separada.
- `git worktree prune --dry-run` ejecutado de solo lectura; auditoría adicional de los 3 registros marcados `prunable` (`ChainPulse`, `ChainPulse-pr4-bypass-preview`, `ChainPulse1`) realizada por separado. El `.env.example` residual de `ChainPulse-pr4-bypass-preview` (con el secreto `AUTH_PLATAFORMA_SECRET`) se contuvo aparte, en `sensitive/ChainPulse-pr4-bypass-preview/` con permisos `700`/`600` — ver "Qué se necesita para seguir" sobre esta verificación. Verificación de infraestructura completada: `AUTH_PLATAFORMA_SECRET` no existe en Vercel (ni en Production, Preview ni Development, ni como variable de proyecto ni compartida); el `.env.example` en cuarentena no constituye evidencia de un secreto actualmente desplegado. El `worktree prune` real sigue sin autorizar.

---

## 2. `npm audit` — Next.js separado como PR urgente, resto en lote aparte

### 2a. PR urgente e independiente — Next.js (crítico)

**No se usa `npm audit fix` genérico para esto.** Next.js es el framework central de la aplicación, no una dependencia de soporte.

- **Versión actual resuelta:** `15.5.26` (declarada `^15.5.26`).
- **Rango afectado consolidado:** `<=15.5.28` — incluye el RCE no autenticado vía SVG en la API de optimización de imágenes (crítico, GHSA-2464-fhr4-w9xw), envenenamiento de caché SSG/ISR, DoS en Server Actions, bypass de rechazo de SVG, exposición de cookie `HttpOnly`, e inyección de respuesta cross-client.
- **Versión objetivo:** `15.5.29` (primera versión dentro del mismo rango `^15.5.26`, sin bump mayor, que ningún aviso cubre).

**Decisión pendiente, no asumida unilateralmente — corregida en esta ronda:** `--save-exact` cambia la declaración de `package.json` de `^15.5.26` (rango semántico, acepta futuros parches/minors compatibles) a `15.5.29` fijo (sin rango). Son dos resultados distintos; el equipo debe elegir uno antes de ejecutar:

- **Opción A — fijar exacto:** `npm install next@15.5.29 --save-exact` → `package.json` queda con `"next": "15.5.29"`. Útil si se quiere reproducibilidad estricta y actualizar Next.js solo mediante un PR explícito cada vez (coherente con tratarlo como "PR de seguridad independiente").
- **Opción B — conservar el rango semántico:** `npm install next@^15.5.29` (o `npm install next@15.5.29` sin `--save-exact`, si la configuración de npm del proyecto no fuerza `save-exact` globalmente) → `package.json` queda con `"next": "^15.5.29"`, igual formato que hoy, solo actualizado el mínimo del rango.

Este documento no elige por el equipo; se ejecuta la opción que se autorice puntualmente.

**Acción propuesta (cuando se autorice y decida la opción A/B anterior):**
1. Entorno aislado, nunca directo sobre `main`.
2. `npm install next@15.5.29` con el flag correspondiente a la opción elegida — el diff de `package.json`/`package-lock.json` debe mostrar, de forma verificable, que **solo** cambió `next` (y lo que `next` mismo arrastre como subdependencia necesaria, documentado explícitamente).
3. Validación: suite completa + `next build` (build de producción real, no solo typecheck/lint).
4. PR propio, con su mensaje describiendo el CVE crítico como motivo.

### 2a. Cierre (2026-11-27)

Ejecutado con autorización explícita y separada en cada paso:

1. Validado en un directorio aislado bajo `/tmp` (nunca directo sobre `main` ni sobre el worktree autoritativo), extraído por `git archive` desde `1eec670ef7e6c7a3adc1d59fe880f294e42baf78`.
2. **Opción A elegida:** `npm install --save-exact next@15.5.29` → `package.json` queda con `"next": "15.5.29"` (sin rango `^`).
3. Diff verificado como exclusivamente `package.json`/`package-lock.json`: en `package.json`, una sola línea (`"next": "^15.5.26"` → `"next": "15.5.29"`); en el lockfile, 37 paquetes con versión cambiada — la familia `next`/`@next/swc-*`/`@next/env` (9) y, como efecto colateral inevitable de que Next 15.5.29 declara `"sharp": "^0.34.3 || ^0.35.5"`, `sharp` y sus binarios `@img/sharp-*`/`@img/sharp-libvips-*` (28). Cero paquetes agregados o eliminados.
4. Validación: `eslint` limpio (0 errores, 5 warnings preexistentes ajenos a este cambio); `tsc --noEmit` y `next build` fallan únicamente por el bloqueo ya conocido de red hacia `binaries.prisma.sh` (Prisma no puede generarse en este entorno), no por el bump de Next; `vitest run` con 1892/1946 tests pasando, los 54 fallos restantes atribuibles al mismo bloqueo de Prisma; compilación de `next build` (bundling) exitosa.
5. Parche generado (`/tmp/next-15.5.29.patch`, SHA-256 `b4bdd00b07900bfd66b946fc34241538214bd96d6f151c7976d71292c31780a0`) y aplicado sobre el worktree `ChainPulse-fix-next-security-15.5.29` (rama `fix/next-security-15.5.29`, partiendo de `1eec670...`).
6. Commiteado como `d07ccdb42d9e65926e2f06953935306661c6b3b4` ("fix(deps): pin Next.js 15.5.29").
7. Fusionado en `main` como PR #41, merge commit `ba3ae389040a7f4f0d00da534450c974b1310b72`. `main` fija ahora `next` en `15.5.29`.

El push de la rama desde este entorno (puente al Mac) fue bloqueado por la política propia de Cowork ("only git clone, git fetch and plain downloads from GitHub work here, not git push"); el push real se hizo desde fuera de este entorno.

### 2b. Resto del lote "sin breaking" (aparte de Next.js) — corregido en esta ronda

**Corrección aritmética:** la v2 de este documento decía "26 vulnerabilidades" en este bloque — era un error. La cifra correcta es **18**. Origen del error: la tabla anterior colapsaba los 5 paquetes `@typescript-eslint/*` en una sola fila visual, lo que llevó a un recuento manual incorrecto al sumar por encima.

**Cuenta completa y verificada:**

| Bloque | Paquetes | Cantidad |
|---|---|---|
| Next.js (Sección 2a) | `next` | 1 |
| Lote breaking Zod/Vitest (Sección 4) | `zod`, `vitest`, `tinypool`, `@vitest/coverage-v8`, `@vitest/mocker`, `test-exclude`, `glob`, `minimatch` | 8 |
| Resto "sin breaking" (este bloque) | ver lista abajo | 18 |
| **Total** | | **27** |

Los 18 paquetes de este bloque, listados uno por uno (sin colapsar): `@prisma/config`, `@sentry/bundler-plugin-core`, `@sentry/bundler-plugins`, `@sentry/nextjs`, `@sentry/webpack-plugin`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `@typescript-eslint/type-utils`, `@typescript-eslint/typescript-estree`, `@typescript-eslint/utils`, `deepmerge-ts`, `effect`, `fast-uri`, `postcss`, `prisma`, `sharp`, `source-map-js`, `vite`.

**Actualización de cierre (post-Next.js, 2026-11-27):** tras fusionar el PR #41, `npm audit` reporta **26 vulnerabilidades** (15 moderadas, 8 altas, 3 críticas) — baja de 27. `next` ya no aparece como paquete vulnerable directo; `sharp` tampoco aparece en ningún lugar del reporte. El único lugar donde `next` todavía aparece en la salida de `npm audit` es como eslabón de la cadena de dependencia hacia la copia interna de `postcss` que Next empaqueta (`node_modules/next/node_modules/postcss`) — esa es la vulnerabilidad real (de `postcss`), no de `next`; sigue siendo uno de los 18 paquetes de este bloque, sin cambios en el resto del lote.

**Pasos:** mismo patrón que antes — entorno aislado, `npm audit fix` (sin `--force`) ahí, diff para revisión, suite completa + lint + typecheck (corre limpio en un entorno con `node_modules` completo), rama dedicada si todo valida.

**Esfuerzo estimado:** Next.js (2a) 1-2 horas; resto (2b) 2-3 horas.

---

## 3. CRLF — PR independiente con `.gitattributes`, restauración precisa

Ya no depende de PR #40 (fusionado). Alcance: los 6 archivos listados en la Sección 0.1, punto 2.

**`.gitattributes` propuesto** (sin cambios respecto a la versión anterior):

```gitattributes
* text=auto eol=lf

*.bat text eol=crlf
*.cmd text eol=crlf

*.docx binary
*.png binary
*.jpg binary
*.jpeg binary
*.ico binary
*.pdf binary
```

**Pasos propuestos, en el orden correcto (verificar primero, restaurar después):**

1. *(Ya verificado hoy)* Confirmar equivalencia lógica: los 6 blobs en `HEAD` tienen 0 líneas con `\r`; el árbol de trabajo tiene CRLF completo en los 6. `git diff -w` entre ambos da 0 cambios. Esto se reconfirmaría una vez más, en el momento, inmediatamente antes del paso 2.

   **Resultado esperado de este PR — aclaración añadida en esta ronda:** como los 6 blobs de `HEAD` ya están en LF puro, restaurar el árbol de trabajo desde `HEAD` va a dejar esos 6 archivos *exactamente* como están en `HEAD` — es decir, ya en LF. Esto significa que el paso 5 (`git add --renormalize`) muy probablemente **no va a encontrar nada que renormalizar** en esos 6 archivos puntuales: su contenido, una vez restaurado, ya cumple lo que `.gitattributes` pediría. El resultado final esperado de este PR podría ser, honestamente, **solo la adición de `.gitattributes`**, sin ningún cambio de contenido en los 6 archivos. Esto no es un fracaso del PR ni motivo para forzar un cambio artificial en esos archivos — el objetivo real del PR es blindar el repositorio hacia adelante (que un futuro checkout en Windows no vuelva a generar CRLF), no producir un diff vistoso en los 6 archivos de hoy.

2. Restaurar el árbol de trabajo desde `HEAD`, solo esas 6 rutas:
   ```
   git restore --worktree --source=HEAD -- \
     src/infra/kpis/estadoVisualizacion.ts \
     src/infra/kpis/__tests__/estadoVisualizacion.test.ts \
     src/infra/kpis/__tests__/contratoAcciones.test.ts \
     src/infra/kpis/acciones/tipos.ts \
     src/infra/kpis/acciones/servicio.ts \
     src/infra/kpis/acciones/__tests__/tipos.test.ts
   ```
   (`--worktree` afecta solo el árbol de trabajo, no el índice.)
3. Crear rama dedicada (`chore/normalizar-fin-de-linea-gitattributes`).
4. Agregar el `.gitattributes` de arriba (a confirmar/ajustar con el equipo antes de commitear).
5. Renormalizar **solo** esos 6 archivos, por ruta explícita: `git add --renormalize -- <las 6 rutas>` — nunca `git add --renormalize .` sobre todo el árbol. **Corregido en esta ronda:** dado lo señalado en el paso 1, es esperable que este comando no deje nada staged para estos 6 archivos puntuales; si eso ocurre, no se fuerza ningún cambio adicional sobre ellos — se continúa igual con el `.gitattributes` como único artefacto nuevo del PR.
6. Revisar **ruta por ruta** con `git diff -w --cached` y con `git status --short` — en el caso esperado, ninguno de los 6 archivos aparece como modificado/staged, y el único archivo nuevo es `.gitattributes`. Si alguno de los 6 sí aparece con cambios, se revisa manualmente por qué (podría indicar que ese archivo específico no estaba realmente en LF puro en `HEAD`, contradiciendo lo verificado en el paso 1) y se detiene el PR para revisar antes de continuar.
7. Lint + typecheck + suite focalizada de esos 6 archivos como mínimo; suite completa si el tiempo lo permite.
8. Commit en la rama dedicada, PR separado.

**Autorizaciones puntuales:** el `git restore` del paso 2, el contenido final de `.gitattributes`, la creación de la rama, y el commit tras mostrar la confirmación ruta por ruta.

**Esfuerzo estimado:** 1-2 horas.

---

## 4. Spikes de solo lectura — Zod 4 y Vitest 5 (fase de investigación ya iniciada)

Ambos spikes arrancaron en su fase de solo lectura (changelogs oficiales + análisis estático del código). **Ningún paquete se instaló.** La fase de instalación aislada + corrida real de la suite sigue sin autorizar.

### Spike A — Zod 3 → 4 (`3.25.76` → `4.6.7`)

**Changelog oficial revisado** ([zod.dev/v4/changelog](https://zod.dev/v4/changelog)). De las categorías de cambios rotos documentadas, lo que **no se usa en este repo** (31 archivos que importan `zod`): `errorMap`/`required_error`/`invalid_type_error`, `z.nativeEnum()`, `.deepPartial()`, `.merge()`, `instanceof ZodEffects`, `ctx.path` dentro de `refine`, `z.function()` como schema. Cero coincidencias en los 31 archivos para cada uno de estos patrones — menor superficie de riesgo de la que sugeriría una migración genérica.

**Lo que sí aparece y necesita atención concreta:**

- **3 archivos usan `parsed.error.flatten()`** directamente en el cuerpo de una respuesta HTTP de API (`cobertura/importaciones/[id]/confirmar/route.ts`, `kpis/acciones/route.ts`, `kpis/acciones/[id]/route.ts`): `.flatten()` queda **deprecado** en v4 a favor de `z.treeifyError()`/`.issues`. Esto cambiaría la forma del JSON de error de esas 3 rutas si se migra sin ajustar — requiere verificación directa en entorno aislado.
- **3 archivos combinan `.optional().default(false)`** (`eslabones/route.ts`, `evaluations/[id]/answers/route.ts`, `evaluations/[id]/unlock/route.ts`): el changelog documenta un cambio de comportamiento para el orden inverso (`.default(x).optional()`); no queda claro si este orden se ve afectado igual. Requiere prueba directa.
- **5 archivos usan `z.coerce.*`**: una clave ausente en un objeto con campo `coerce` ahora da error en v4 (antes daba un valor por defecto). Necesita revisión por archivo.

**Entregable pendiente de la fase de instalación (no autorizada todavía):** correr la suite completa con `zod@4.6.7` instalado en entorno aislado y medir el impacto real.

### Spike B — Vitest 3 → 5 (`3.2.7` → `5.1.2`, salta la v4)

**Changelogs oficiales revisados** (guía de migración v5 y v4). Hallazgos concretos:

- **Node.js:** v5 exige `>=22.12.0`. El Mac tiene **v22.23.5** — cumple.
- **Vite:** v5 exige `>=6.4.0`. El repo ya resuelve **vite 7.3.6** — cumple ampliamente.
- `esbuild.jsx: "automatic"`, el pragma `// @vitest-environment jsdom` por archivo, y la sintaxis de `resolve.alias` no aparecen mencionados como cambiados en ninguna guía oficial — indicio de compatibilidad, no confirmación definitiva.
- El `exclude` personalizado de `vitest.config.ts` probablemente no se ve afectado por el cambio del `exclude` por defecto de v4, porque el repo ya usa `include` acotado a `src/**`/`scripts/**`.
- **Hallazgo real con impacto directo, sin forma de descartarlo por lectura:** `vitest.config.ts` **no fija `clearMocks`/`restoreMocks`/`mockReset`**. Hoy (v3) `clearMocks` por defecto es `false`; en v5 pasa a `true`. Migrando sin ajustar, los mocks empezarían a limpiarse automáticamente entre tests donde hoy no se limpian. No se puede descartar por análisis estático; requiere correr la suite real.
- Se cuentan **174 llamadas a `vi.mock()`/`vi.hoisted()`**. v4 lanza error si están dentro de una función o de un `describe`. Muestra de 10 revisada: las 10 al nivel superior del módulo (patrón correcto) — con 174 ocurrencias, la muestra no es verificación exhaustiva; la corrida real bajo v4/v5 lo confirmaría de inmediato.
- Otros cambios de v5 documentados, no verificables por lectura si aplican a este repo: reporters `json`/`junit` ahora escriben a archivo por defecto; el reporter `html` cambió de `outputFile` a `outputDir` (no confirmado si afecta también a `coverage.reporter: "html"`).

**Entregable pendiente de la fase de instalación (no autorizada todavía):** instalar `vitest@5.1.2` (resuelve también `tinypool`, `@vitest/coverage-v8`, `@vitest/mocker`, `test-exclude`, `glob`, `minimatch`) en entorno aislado y correr los **212 archivos de test actuales**, con atención especial a `clearMocks` y a los 174 `vi.mock`/`vi.hoisted`.

**Esfuerzo estimado de cada spike (fase de instalación, pendiente):** medio día cada uno.

---

## Qué se necesita para seguir

1. **(Cerrado)** La cuarentena de la Sección 1 ya se ejecutó y verificó en su totalidad (ver "1.3 Ejecución real"). Queda pendiente únicamente autorizar la cuarentena del tercer `objects/maintenance.lock` generado por el `git fetch` del cierre, y, más adelante, el `worktree prune` real y el eventual borrado definitivo de la cuarentena (sugerido no antes de 2-4 semanas).
2. **(Cerrado)** El PR urgente de Next.js (Sección 2a) ya se ejecutó con la Opción A y se fusionó en `main` como PR #41 (ver "2a. Cierre").
3. AUTH_PLATAFORMA_SECRET — verificación de infraestructura completada: el 2026-11-27 se revisó Vercel en modo de solo lectura. La variable no existe actualmente en ChainPulse, ni como variable del proyecto ni como variable compartida; por tanto, no está configurada para Production, Preview o Development. El .env.example residual permanece contenido en la cuarentena como archivo potencialmente sensible, pero no constituye evidencia de un secreto actualmente desplegado en Vercel. No se reveló ni copió su valor y no se ejecutó ninguna rotación.
4. Confirmar el `.gitattributes` y autorizar el `git restore` puntual para arrancar el PR de CRLF, sabiendo que el resultado esperado puede ser únicamente `.gitattributes` (Sección 3).
5. Decidir si autorizan ya la fase de instalación aislada de cada spike — Zod y Vitest (Sección 4).
6. Autorizar el entorno aislado para el resto del lote "sin breaking" de `npm audit fix` (Sección 2b, 18 paquetes de los 26 vigentes tras el cierre de Next.js).
7. Confirmar si el DOCX de este plan también se versiona en `docs/engineering/` (con su hash en un `SHA256SUMS.txt`, siguiendo el patrón de `docs/architecture/rf19-rf20/`) o si queda como entrega externa únicamente, tal como recomendado arriba.

Ninguna instalación, movimiento de archivo adicional, restauración de CRLF, `npm audit fix`, rotación de secretos, nuevo commit o borrado de cuarentena se ejecuta hasta la autorización puntual correspondiente.
