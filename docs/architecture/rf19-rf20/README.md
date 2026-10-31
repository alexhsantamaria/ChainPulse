# RF19/RF20 — Documentación de diseño

Documentación de arquitectura de RF19 (autenticación de plataforma, MFA obligatorio) y RF20 (gobernanza de versiones del cuestionario de evaluación), consolidada tras un proceso iterativo de revisión y corrección.

- `auditoria-diseno-rf19-rf20.md` / `.docx`: auditoría original de solo lectura, diagnóstico y propuesta inicial de diseño.
- `adenda-diseno-rf19-rf20-v6.md` / `.docx`: adenda de diseño, **versión v6, histórica**. Sustituyó íntegramente a las versiones intermedias (v1–v5), que no se incluyen en este repositorio por haber sido corregidas sucesivamente hasta llegar a esa versión aprobada en su momento. Permanece intacta en este directorio como registro histórico; ya no es el documento autoritativo vigente (ver `adenda-diseno-rf19-rf20-v7.md`).
- `adenda-diseno-rf19-rf20-v7.md` / `.docx`: adenda de diseño, **versión v7, documento autoritativo vigente**. Sustituye documentalmente a v6: el cambio de fondo se limita a §3 (migración `rf19_rf20_revoke_create_public`), que corrige dos defectos de un borrador intermedio de esa sección — la postcondición D1 (ausencia de `CREATE` para el pseudo-rol `PUBLIC`) pasa a verificarse por catálogo con `aclexplode(nspacl)` y `grantee = 0`, nunca con `has_schema_privilege('public', 'public', 'CREATE')` (que interpretaría el segundo `'public'` como un rol real inexistente); y la Prueba C (rol nominativo inesperado) pasa a usar un rol de prueba generado dinámicamente, con verificación previa de no-existencia en `pg_roles` y una limpieza que nunca enmascara el fallo original de la aserción. El resto del contenido técnico (§1–§2, §4–§8, §9 migraciones 2–7, §10 PR 1 y 3–8, §12.3, §12.4, §13) es idéntico a v6. §14 de v7 documenta el diff conceptual completo v6→v7.
- `SHA256SUMS.txt`: hashes SHA-256 de verificación de los seis archivos anteriores (`sha256sum -c SHA256SUMS.txt` desde este directorio).

**Estado de este directorio:** exclusivamente documental. Sin conexión a Neon. Sin migraciones ejecutadas. Sin autorización de implementación. Cualquier PR técnico posterior (código, migraciones, dependencias) requiere autorización separada y explícita.

## Errata normativa — PR 6 (2026-10-30)

**No modifica `adenda-diseno-rf19-rf20-v7.md` ni las entradas de `SHA256SUMS.txt`.** Se registra aqui, por separado, porque la revision del PR 6 (`codex/rf19-rf20-pr6-migraciones-gobernanza-versiones`) encontro un defecto de semantica NULL en PL/pgSQL dentro del bloque SQL de `validar_estructura_opciones_pregunta()` tal como esta escrito en v7 Seccion 7.8: cuando una clave JSON (`valor`, `texto` u `orden`) esta completamente ausente de un elemento de `opciones`, `jsonb_typeof(v_elemento->'campo')` devuelve `NULL` (no un tipo valido), y la condicion `jsonb_typeof(...) <> 'tipo'` evalua a `NULL`, que PL/pgSQL trata como falso en un `IF` -- la rama de rechazo correspondiente no se dispara. Para el campo `texto` esto es un bypass silencioso real (ninguna otra comprobacion de la funcion vuelve a referenciar `texto`); para `valor`/`orden` el efecto neto sigue siendo un rechazo (por un chequeo de duplicados que ignora `NULL`), pero con el motivo equivocado, lo que igualmente incumple las pruebas obligatorias de motivo exacto exigidas por la propia Seccion 7.8.

Las tres condiciones de v7 Seccion 7.8 quedan **sustituidas**, en la migracion preparada (`prisma/migrations/20261030121000_rf20_funciones_controladas/migration.sql`), por:

```sql
IF NOT (v_elemento ? 'valor')
   OR jsonb_typeof(v_elemento->'valor') <> 'string'
   OR btrim(v_elemento->>'valor') = '' THEN

IF NOT (v_elemento ? 'texto')
   OR jsonb_typeof(v_elemento->'texto') <> 'string'
   OR btrim(v_elemento->>'texto') = '' THEN

IF NOT (v_elemento ? 'orden')
   OR jsonb_typeof(v_elemento->'orden') <> 'number' THEN
```

El operador `?` de existencia de clave jsonb nunca devuelve `NULL`, a diferencia de `->`, asi que la comprobacion de ausencia queda explicita en vez de depender de la propagacion de `NULL`. v7 Seccion 7.8 queda, por tanto, documentalmente desactualizada en este punto exacto hasta que una proxima version del documento (v8 o posterior) incorpore esta correccion de forma integral y recalculada sus hashes; mientras tanto, esta erratum y el propio `migration.sql` preparado son la fuente autoritativa sobre el comportamiento real de `validar_estructura_opciones_pregunta()`.
