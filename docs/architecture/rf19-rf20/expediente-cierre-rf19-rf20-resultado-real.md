# RF19/RF20 -- Resultado real de la verificacion final de solo lectura (v6)

Generado automaticamente por rf19-rf20-cierre-verificacion-solo-lectura-v6.ps1. Fecha UTC: 2026-11-05T21:04:29Z.
Sanitizado: no contiene URL, host literal ni contrasena -- solo coincide/no-coincide contra lo esperado.
Precondiciones de git verificadas antes de escribir este archivo: rama 'main', arbol limpio, HEAD == origin/main.

## Resultado

RF19_RF20_CIERRE_RESULTADO=TODO_OK

## Confirmaciones (19)

- Identidad de conexion correcta (host/base/rol), sin exponer el host literal.
- Las 10 migraciones RF19/RF20 tienen, cada una, al menos un intento aplicado (finished_at no nulo y rolled_back_at nulo) y cero intentos activamente inconclusos, agrupando por nombre para cubrir posibles reintentos; cero migraciones inconclusas en el resto de la tabla.
- Esquema public poseido por el rol pseudo 'pg_database_owner'; validado porque pg_database.datdba de la base actual resuelve exactamente a 'neondb_owner' (errata real de validacion Neon).
- Las comprobaciones de la postcondicion de 'rf19_rf20_revoke_create_public' (v7, Seccion 3.1), incluida la validacion real de propiedad del esquema (neondb_owner directo, o pg_database_owner con datdba=neondb_owner), siguen en verde tras las 10 migraciones.
- Enum 'AccionBitacoraVersion' con exactamente CORREGIR/PUBLICAR/RETIRAR.
- Enum 'BucketLimiteTasa' contiene ambos valores nuevos de RF19.
- Las 3 columnas nuevas de usuarios_plataforma (activo, sessionVersion, mfaUltimoContadorUsado) existen con el tipo/nulabilidad esperados.
- Indice unico funcional de email presente y definido exactamente como lower(btrim(email)).
- bitacora_version_cuestionario tiene exactamente las 6 columnas esperadas.
- bitacora_version_cuestionario tiene exactamente 3 FOREIGN KEY, todas ON DELETE RESTRICT.
- Tabla 'usuarios_plataforma' sin ningun privilegio directo para chainpulse_app (ni SELECT) -- toda lectura/escritura pasa por funcion.
- Tabla 'cuestionario_versiones' con SELECT otorgado y CERO privilegios de escritura directa para chainpulse_app.
- Tabla 'pregunta_versiones' con SELECT otorgado y CERO privilegios de escritura directa para chainpulse_app.
- Tabla 'bitacora_version_cuestionario' con SELECT otorgado y CERO privilegios de escritura directa para chainpulse_app.
- Las 21 funciones SECURITY DEFINER del inventario cerrado coinciden exactamente: firma, propietario (p.proowner resuelto) neondb_owner, SECURITY DEFINER, search_path=public,pg_temp; y, por separado en 4 categorias, PUBLIC sin EXECUTE, chainpulse_app con EXECUTE, el propietario nunca contado como tercero, y ningun rol tercero inesperado.
- Funcion 'crear_cuestionario_version': su definicion real (pg_get_functiondef) contiene la forma corregida 'max(cv.numero)' y no contiene la forma antigua/ambigua 'max(numero) [bare, ambiguo]'.
- Funcion 'corregir_cuestionario_version': su definicion real (pg_get_functiondef) contiene la forma corregida 'max(cv.numero)' y no contiene la forma antigua/ambigua 'max(numero) [bare, ambiguo]'.
- Funcion 'publicar_cuestionario_version': su definicion real (pg_get_functiondef) contiene la forma corregida 'validacion.valido, validacion.motivo' y no contiene la forma antigua/ambigua 'SELECT valido, motivo [bare, antiguo]'.
- Funcion 'validar_estructura_opciones_pregunta': su definicion real (pg_get_functiondef) contiene la forma corregida 'NOT (v_elemento ? 'valor'/'texto'/'orden') antes de jsonb_typeof (guardas de existencia de clave, README 'Errata normativa -- PR 6')'. (Sin comprobacion negativa de 'forma antigua ausente' para esta funcion -- ver expediente.)

## Brechas encontradas (0)

Ninguna.

## Trazabilidad complementaria de las 3 migraciones suplementarias (no son una brecha documental)

Las migraciones 'rf19_leer_mfa_plataforma', 'rf20_corregir_ambiguedad_numero_funciones' y 'rf20_calificar_resultado_validacion_publicacion' son posteriores a (o estan fuera de) adenda-diseno-rf19-rf20-v7.docx. Esto NO es una brecha documental: estan documentadas (dos erratas de README.md, y el propio archivo de migracion para la funcion nueva -- ver el expediente de cierre acompanante para la cita literal completa de cada una). Este script verifico activamente las 3: presencia en el historial de migraciones (las 3), metadata completa de catalogo (leer_mfa_plataforma), y contenido real via pg_get_functiondef (las 2 correcciones, mas validar_estructura_opciones_pregunta por una tercera errata de README) -- ver Confirmaciones/Brechas arriba.
