<#
============================================================================
RF19/RF20 -- VERIFICACION FINAL DE SOLO LECTURA, v6, para el expediente de
cierre. Estado: PREPARADO / NO EJECUTADO. Nadie corrio este script
todavia. No se abrio ninguna conexion a Neon, no se solicito ni se manejo
ninguna credencial, y no se ejecuto absolutamente nada al prepararlo.

CONTEXTO: produccion ya tiene, segun lo reportado, las 10 migraciones
RF19/RF20 aplicadas con resultado TODO_OK (bloque de despliegue v2, ya
ejecutado por Alex). Este script NO vuelve a desplegar ni a tocar nada --
es una auditoria de cierre, exclusivamente de lectura, que confirma que lo
que QUEDO REALMENTE en produccion coincide, objeto por objeto, con lo que
especifican, en conjunto: adenda-diseno-rf19-rf20-v7.docx, las erratas de
docs/architecture/rf19-rf20/README.md, y las migraciones suplementarias
reales.

CORRECCIONES v2 -> v3 (todas por instruccion explicita de Alex):
  1. ACL de funciones: se clasifica cada grantee en 4 categorias
     independientes -- grantee=0 (PUBLIC); grantee=chainpulse_app;
     grantee=p.proowner (propietario, permitido, NUNCA tercero); cualquier
     otro rol (tercero inesperado). Se verifica ademas, por separado, que
     p.proowner resuelva EXACTAMENTE a neondb_owner.
  2. CREATE sobre el esquema public: se incorpora la errata real de
     validacion Neon. El propietario del esquema (pg_namespace.nspowner)
     puede ser neondb_owner directo, o el rol pseudo 'pg_database_owner'
     (predefinido desde PostgreSQL 16, significa "quien sea el dueno de
     la base actual") -- y en ese segundo caso se EXIGE que
     pg_database.datdba de la base actual resuelva exactamente a
     neondb_owner. Solo bajo esa precondicion VALIDADA se excluyen ambos
     nombres (neondb_owner y pg_database_owner) al buscar roles
     inesperados con CREATE sobre public.
  6. git fetch ya NO depende de 'git fetch origin main' (su comportamiento
     de actualizacion de refs varia segun configuracion de refspec). Ahora
     se usa 'git fetch origin --prune --quiet' -- trae TODAS las
     referencias remotas de origin, de forma predecible, antes de
     comparar HEAD contra origin/main.
  7. Este script, al prepararlo, NO se copia dentro de ningun checkout de
     ChainPulse disponible en este entorno -- eso no seria "el
     repositorio real", solo una copia local de este entorno de trabajo.
     Se entrega EXCLUSIVAMENTE como archivo de salida (Claude outputs).
     El resultado real de ejecutarlo, y su incorporacion a GitHub, los
     hace Alex desde su propio clon de Windows.

CORRECCIONES v3 -> v4 (desbloqueadas porque Alex proporciono el contenido
real de README.md y de las 3 migraciones suplementarias; ver el
expediente .md para la cita completa de cada una):
  3. docs/architecture/rf19-rf20/README.md -- citado directamente. Las dos
     erratas de "numero" (migracion 20261031010000) y "motivo" (migracion
     20261031011000) ya no son citas pendientes.
  4. leer_mfa_plataforma(text) -- fuente exacta:
     prisma/migrations/20261030110000_rf19_leer_mfa_plataforma/migration.sql
     (contenido citado literalmente en el expediente .md). LANGUAGE sql
     (no plpgsql), SECURITY DEFINER, search_path=public,pg_temp, owner
     neondb_owner, REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO
     chainpulse_app -- igual que las otras 20 funciones.
  5. Verificaciones de pg_get_functiondef() para las 2 migraciones
     correctivas: SIN CAMBIO DE MECANISMO, ahora con la cita real de sus
     erratas de README.md (seccion "Errata normativa -- ambiguedad
     'numero'/'motivo'", 2026-10-31). ADEMAS -- hallazgo nuevo, no pedido
     originalmente por Alex, revelado por una TERCERA errata de README
     ("Errata normativa -- PR 6", 2026-10-30) que yo no conocia: se agrega
     una verificacion de contenido para validar_estructura_opciones_pregunta,
     porque esa errata describe un defecto real de semantica NULL en el
     v7 Seccion 7.8 documentado (bypass silencioso de la validacion del
     campo "texto") que la migracion YA DESPLEGADA 20261030121000
     corrige con comprobaciones `v_elemento ? 'campo'` explicitas. Esta
     cuarta verificacion solo comprueba la PRESENCIA de la forma
     corregida (no intenta una comprobacion negativa de "forma antigua
     ausente": construir un patron que discrimine con seguridad la forma
     vieja de la nueva, sin riesgo de falso positivo, no fue posible con
     los fragmentos disponibles -- ver el expediente .md). Alex pidio
     conservar esta verificacion para v5.

CORRECCIONES v4 -> v5 (todas por instruccion explicita de Alex; el script
NO se ejecuto ni se conecto a Neon para prepararlas):
  A. Validacion en frio de la URL: ahora exige ademas que el parametro de
     consulta 'sslmode' este presente y sea exactamente 'require' o
     'verify-full'. Cualquier otro valor (o su ausencia) se rechaza antes
     de fijar ninguna variable de entorno -- igual que las demas
     comprobaciones en frio (host, base, usuario, rechazo de pooler), sin
     abrir ninguna conexion real.
  B. Historial de migraciones: ya no asume una unica fila por nombre de
     migracion en "_prisma_migrations" (Prisma puede dejar mas de un
     intento -- por ejemplo uno fallido/revertido seguido de uno exitoso
     -- bajo el mismo migration_name). Ahora se agrupa por
     migration_name y, para cada una de las 10 migraciones esperadas, se
     exige: al menos un intento aplicado (finished_at no nulo Y
     rolled_back_at nulo) entre todos sus intentos, y cero intentos
     activamente inconclusos (finished_at nulo Y rolled_back_at nulo)
     para ese mismo nombre. La comprobacion global previa (cero
     migraciones inconclusas en TODA la tabla, sin importar el nombre)
     se conserva sin cambios, como red de seguridad adicional.

CORRECCIONES v5 -> v6 (reportadas por Alex tras correr v5 de verdad,
contra produccion, en modo de solo lectura -- 16 confirmaciones y 24
falsos positivos sistematicos; ninguna de las dos correcciones de abajo
se ejecuto ni se probo contra Neon al prepararlas, solo se razonaron y
se escribieron):
  I. Enums: la consulta devolvia array_agg(e.enumlabel ...), que el
     driver "pg" de Node puede no parsear como arreglo JS para esta
     combinacion de tipo (el resultado llega como el literal de texto de
     PostgreSQL "{CORREGIR,PUBLICAR,RETIRAR}", una sola cadena, no una
     lista) -- la comparacion de PowerShell, que SI esperaba un arreglo,
     fallaba de forma sistematica para ambos enums. Ahora la consulta usa
     json_agg(e.enumlabel ORDER BY e.enumsortorder), que "pg" SIEMPRE
     parsea como un arreglo JS real (via JSON.parse sobre la columna
     json). La logica de comparacion en PowerShell no cambio -- ya
     esperaba un arreglo, solo que nunca lo recibia correctamente.
  II. Firmas de funciones: pg_get_function_identity_arguments(p.oid) se
      reemplaza por oidvectortypes(p.proargtypes) para la comparacion de
      tipos. Se conserva pg_get_function_identity_arguments(p.oid) como
      campo informativo adicional ("firma_con_nombres"), sin usarlo para
      ninguna comparacion -- solo aparece en los mensajes de brecha, para
      ayudar a diagnosticar visualmente si hiciera falta.

Ninguna otra comprobacion, garantia de solo lectura, validacion de TLS,
restauracion/limpieza, o precondicion de git cambio en esta ronda.

ESTE SCRIPT NUNCA:
  - Ejecuta ninguna sentencia que no sea SELECT o una funcion de catalogo
    de solo lectura (has_schema_privilege, has_table_privilege,
    pg_has_role, aclexplode sobre una columna ya leida,
    pg_get_functiondef, pg_get_function_identity_arguments,
    pg_get_constraintdef, pg_get_userbyid). Ni un solo
    INSERT/UPDATE/DELETE/DDL/CALL en todo el archivo.
  - Fija DATABASE_URL/SEED_DATABASE_URL mas alla de esta misma ejecucion
    -- se restauran y se VERIFICAN SIEMPRE en el "finally", exito o
    fallo, igual que en el bloque de despliegue v2.
  - Ejecuta "prisma migrate" de ningun tipo (ni status ni deploy) -- esta
    verificacion no necesita Prisma, consulta el catalogo de PostgreSQL
    directamente via Node/pg.
  - Pasa codigo JavaScript como argumento de "node -e" -- el codigo de
    verificacion se escribe a un unico archivo .cjs temporal, UTF-8 SIN
    BOM, dentro de $env:Temp, sin URL ni credenciales embebidas, y se
    borra de forma INCONDICIONAL y VERIFICADA en el "finally".
  - Imprime ni escribe a disco la URL, la contrasena, o el host real de
    Neon -- el expediente de cierre que este script escribe en
    docs/architecture/rf19-rf20/ (del clon REAL de Alex cuando el lo
    corra, nunca de este entorno) solo declara SI el host coincidio o no
    con el endpoint directo esperado, nunca el host literal.
  - Modifica ningun archivo del repositorio salvo el expediente de
    cierre que esta misma ejecucion escribe (ruta fija, ver mas abajo) --
    nunca "prisma/migrations/", nunca "prisma/schema.prisma", nunca
    codigo de aplicacion. "git fetch" (Seccion 1.5) solo actualiza
    referencias remotas; nunca toca el arbol de trabajo ni hace commit,
    merge o push de nada.

Ademas, por defensa en profundidad (mismo patron ya usado en el
procedimiento de produccion de RF24): la sesion de PostgreSQL que abre
este script fija "SET default_transaction_read_only = on;" como PRIMERA
instruccion tras conectar, antes de correr ninguna consulta -- aunque
este archivo nunca contiene una sentencia de escritura, esto hace que
cualquier sentencia de escritura, si alguna vez se introdujera por error
en una ronda futura, falle en el servidor con "cannot execute ... in a
read-only transaction", en vez de aplicarse.

Texto en ASCII puro en todo el archivo (sin tildes/enies).

Se entrega para que Alex lo revise y lo corra el mismo, manualmente, en
su clon de Windows con red real a Neon, cuando decida hacerlo. No se
ejecuta desde aqui bajo ninguna circunstancia.
============================================================================
#>

# ===========================================================================
# 0. Constantes -- el "estado esperado" completo es el que especifican, en
#    conjunto, v7, las erratas de README.md, y las migraciones
#    suplementarias reales. Cada valor de abajo cita su fuente exacta;
#    ninguno se inventa ni se deriva por conveniencia.
# ===========================================================================

$RutaRepositorioEsperada = "C:\Users\alx\Documents\BigDevelopment\Proyectos\ChainPulse"

$HostProduccionEsperado = "ep-steep-firefly-ac5drua5.sa-east-1.aws.neon.tech"
$BaseDatosProduccionEsperada = "neondb"
$RolEsperado = "neondb_owner"

# Rol pseudo predefinido de PostgreSQL 16+ ("quien sea el dueno de la base
# actual") -- correccion v3 #2. Solo se trata como propietario legitimo del
# esquema public SI, y solo si, pg_database.datdba de la base actual
# resuelve exactamente a $RolEsperado (verificado en el paso 4 mas abajo,
# nunca asumido).
$RolAliasEsquemaPermitido = "pg_database_owner"

# Precondicion de git (Seccion 1.5, correccion v1->v2 #5; mecanismo de
# fetch corregido en v3 #6).
$RamaEsperada = "main"
$RemotoEsperado = "origin"

# Las 10 migraciones RF19/RF20 -- mismas que en los bloques de validacion y
# despliegue previos. 7 de ellas estan descritas, objeto por objeto, en v7
# (Seccion 9, "lista cerrada y orden"). Las otras 3 son las migraciones
# suplementarias reales -- NO estan en v7, pero SI estan documentadas (ver
# el expediente .md, incluido el aviso de bloqueo sobre 2 de ellas):
# nunca se tratan como una brecha documental abierta.
$MigracionesRf19Rf20Esperadas = @(
    "20261030090000_rf19_rf20_revoke_create_public",
    "20261030100000_rf19_enum_bucket_limite_tasa_login_y_mfa",
    "20261030101000_rf19_columnas_usuario_plataforma",
    "20261030102000_rf19_indice_email_normalizado",
    "20261030103000_rf19_funciones_controladas",
    "20261030110000_rf19_leer_mfa_plataforma",
    "20261030120000_rf20_bitacora_version_cuestionario",
    "20261030121000_rf20_funciones_controladas",
    "20261031010000_rf20_corregir_ambiguedad_numero_funciones",
    "20261031011000_rf20_calificar_resultado_validacion_publicacion"
) | Sort-Object

# Las 7 migraciones que v7 SI describe objeto por objeto (subconjunto de
# las 10 de arriba) -- solo para referencia/documentacion del origen de
# cada expectativa.
$MigracionesDescritasPorV7 = @(
    "20261030090000_rf19_rf20_revoke_create_public",
    "20261030100000_rf19_enum_bucket_limite_tasa_login_y_mfa",
    "20261030101000_rf19_columnas_usuario_plataforma",
    "20261030102000_rf19_indice_email_normalizado",
    "20261030103000_rf19_funciones_controladas",
    "20261030120000_rf20_bitacora_version_cuestionario",
    "20261030121000_rf20_funciones_controladas"
) | Sort-Object

# Fuente documental declarada de cada una de las 3 migraciones
# suplementarias -- citas reales, provistas por Alex desde su clon
# Windows sincronizado (ver el expediente .md para el texto completo de
# cada errata y de cada migration.sql).
$FuentesMigracionesSuplementarias = [ordered]@{
    "20261030110000_rf19_leer_mfa_plataforma" =
        "Fuente: prisma/migrations/20261030110000_rf19_leer_mfa_plataforma/migration.sql. CREATE FUNCTION leer_mfa_plataforma(text) RETURNS TABLE('mfaSecret' text, 'mfaHabilitado' boolean), LANGUAGE sql, SECURITY DEFINER, search_path=public,pg_temp, OWNER neondb_owner, REVOKE ALL FROM PUBLIC, GRANT EXECUTE TO chainpulse_app."
    "20261031010000_rf20_corregir_ambiguedad_numero_funciones" =
        "Fuente: README.md, 'Errata normativa -- ambiguedad numero detectada en rama temporal (2026-10-31)'. Hallazgo: error PL/pgSQL 'column reference numero is ambiguous' en crear_cuestionario_version()/corregir_cuestionario_version() (ambas RETURNS TABLE(numero integer) con max(numero) sin calificar). Corregido calificando con el alias cv: max(cv.numero)."
    "20261031011000_rf20_calificar_resultado_validacion_publicacion" =
        "Fuente: README.md, 'Errata normativa -- ambiguedad motivo detectada en rama temporal (2026-10-31)'. Hallazgo: SQLSTATE 42702 en publicar_cuestionario_version() (RETURNS TABLE(..., motivo text) con 'SELECT valido, motivo' sin calificar desde validar_estructura_opciones_pregunta()). Corregido con el alias validacion: 'SELECT validacion.valido, validacion.motivo ... FROM validar_estructura_opciones_pregunta(...) AS validacion'."
}

# Fuente adicional, no pedida originalmente por Alex -- descubierta al
# leer README.md completo para desbloquear los puntos 3/4/5: 'Errata
# normativa -- PR 6 (2026-10-30)'. Describe un defecto real de semantica
# NULL en v7 Seccion 7.8 (que yo mismo lei directamente en una ronda
# anterior): jsonb_typeof(v_elemento->'campo') devuelve NULL cuando el
# campo esta ausente, y una condicion '<> tipo' sobre NULL evalua a NULL
# (falso en un IF de PL/pgSQL) -- para el campo "texto" esto es un bypass
# silencioso real. La migracion YA DESPLEGADA
# 20261030121000_rf20_funciones_controladas corrige esto con guardas
# explicitas "NOT (v_elemento ? 'campo')" (operador de existencia de
# clave jsonb, que nunca devuelve NULL) -- confirmado leyendo
# directamente esa migracion real.
$FuenteErrataPr6ValidarEstructuraOpciones =
    "Fuente: README.md, 'Errata normativa -- PR 6 (2026-10-30)', mas lectura directa de prisma/migrations/20261030121000_rf20_funciones_controladas/migration.sql (ya desplegada). Corrige un bypass silencioso real en validar_estructura_opciones_pregunta() causado por propagacion de NULL en jsonb_typeof() sobre claves ausentes."

# Ruta del expediente de cierre -- relativa al directorio de trabajo
# exigido arriba. Este script solo escribe en esta ruta fija, nunca en
# ningun otro archivo del repositorio.
$RutaExpedienteRelativa = "docs\architecture\rf19-rf20\expediente-cierre-rf19-rf20-resultado-real.md"

# ===========================================================================
# Estado compartido, declarado antes del try (mismo patron que el bloque
# de despliegue v2): restauracion y limpieza se VERIFICAN en el finally,
# y el resultado final se decide e imprime recien despues de que el
# finally termino por completo.
# ===========================================================================

$valoresPrevios = [ordered]@{
    DATABASE_URL      = $env:DATABASE_URL
    SEED_DATABASE_URL = $env:SEED_DATABASE_URL
}
$RutasTemporales = [System.Collections.Generic.List[string]]::new()
$fallosLimpieza = [System.Collections.Generic.List[string]]::new()
$verificacionOk = $false
$huboAbortoPrevio = $false
$motivoAbortoPrevio = $null

function Restaurar-VariablesOriginales {
    param([System.Collections.Generic.List[string]]$FallosAcumulados)

    if ($null -eq $valoresPrevios.DATABASE_URL) {
        Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
    } else {
        $env:DATABASE_URL = $valoresPrevios.DATABASE_URL
    }
    if ($null -eq $valoresPrevios.SEED_DATABASE_URL) {
        Remove-Item Env:\SEED_DATABASE_URL -ErrorAction SilentlyContinue
    } else {
        $env:SEED_DATABASE_URL = $valoresPrevios.SEED_DATABASE_URL
    }

    $actualDatabaseUrl = $env:DATABASE_URL
    $actualSeedDatabaseUrl = $env:SEED_DATABASE_URL

    if ($null -eq $valoresPrevios.DATABASE_URL) {
        if ($null -ne $actualDatabaseUrl) {
            $FallosAcumulados.Add("DATABASE_URL deberia haber quedado AUSENTE tras la restauracion, pero quedo fijada con algun valor.")
        }
    }
    elseif ($actualDatabaseUrl -ne $valoresPrevios.DATABASE_URL) {
        $FallosAcumulados.Add("DATABASE_URL no quedo EXACTAMENTE igual a su valor previo tras la restauracion.")
    }

    if ($null -eq $valoresPrevios.SEED_DATABASE_URL) {
        if ($null -ne $actualSeedDatabaseUrl) {
            $FallosAcumulados.Add("SEED_DATABASE_URL deberia haber quedado AUSENTE tras la restauracion, pero quedo fijada con algun valor.")
        }
    }
    elseif ($actualSeedDatabaseUrl -ne $valoresPrevios.SEED_DATABASE_URL) {
        $FallosAcumulados.Add("SEED_DATABASE_URL no quedo EXACTAMENTE igual a su valor previo tras la restauracion.")
    }
}

try {
    try {
        # ===================================================================
        # 1. Directorio exacto, antes de pedir nada.
        # ===================================================================
        $rutaActual = (Get-Location).Path
        if ($rutaActual -ne $RutaRepositorioEsperada) {
            throw "Este bloque debe correrse EXACTAMENTE desde '$RutaRepositorioEsperada'. Directorio actual: '$rutaActual'."
        }

        # ===================================================================
        # 1.5. Precondiciones de git -- deben cumplirse ANTES de pedir
        #      ninguna credencial y ANTES de escribir el expediente: rama
        #      'main', arbol de trabajo limpio, y HEAD == origin/main.
        #      Correccion v3 #6: 'git fetch origin --prune --quiet' trae
        #      TODAS las referencias remotas de forma predecible, en vez de
        #      depender del comportamiento de 'git fetch origin main' (que
        #      varia segun la configuracion de refspec del remoto). Esto
        #      solo actualiza referencias remotas -- nunca toca el arbol de
        #      trabajo, nunca hace commit, merge ni push.
        # ===================================================================
        $ramaActualSalida = & git rev-parse --abbrev-ref HEAD 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "No se pudo determinar la rama actual ('git rev-parse --abbrev-ref HEAD'): $ramaActualSalida"
        }
        $ramaActual = ($ramaActualSalida | Out-String).Trim()
        if ($ramaActual -ne $RamaEsperada) {
            throw "Rama actual '$ramaActual' distinta de la esperada '$RamaEsperada'. Cambia de rama antes de correr este script."
        }

        $estadoPorcelainSalida = & git status --porcelain 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "No se pudo ejecutar 'git status --porcelain': $estadoPorcelainSalida"
        }
        $estadoPorcelainTexto = (@($estadoPorcelainSalida) -join "`n").Trim()
        if (-not [string]::IsNullOrWhiteSpace($estadoPorcelainTexto)) {
            throw "El arbol de trabajo NO esta limpio (hay cambios sin commitear o archivos sin seguimiento). 'git status --porcelain' devolvio salida no vacia."
        }

        $null = & git fetch $RemotoEsperado --prune --quiet 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "'git fetch $RemotoEsperado --prune' fallo con codigo de salida $LASTEXITCODE."
        }
        $headLocalSalida = & git rev-parse "HEAD" 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "No se pudo resolver HEAD local tras el fetch: $headLocalSalida"
        }
        $headRemotoSalida = & git rev-parse "$RemotoEsperado/$RamaEsperada" 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "No se pudo resolver '$RemotoEsperado/$RamaEsperada' tras el fetch: $headRemotoSalida"
        }
        $headLocal = ($headLocalSalida | Out-String).Trim()
        $headRemoto = ($headRemotoSalida | Out-String).Trim()
        if ($headLocal -ne $headRemoto) {
            throw "HEAD local ($headLocal) distinto de $RemotoEsperado/$RamaEsperada ($headRemoto). Sincroniza (pull/push, segun corresponda) antes de continuar."
        }

        Write-Host "Precondiciones de git OK: rama '$RamaEsperada', arbol limpio, HEAD == $RemotoEsperado/$RamaEsperada." -ForegroundColor Green

        # ===================================================================
        # 2. Entrada OCULTA de la URL, y validacion EN FRIO (sin red) --
        #    mismo patron que los bloques de validacion/despliegue previos.
        # ===================================================================
        $urlSegura = Read-Host -Prompt "URL directa de PRODUCCION para neondb_owner (no se muestra en pantalla)" -AsSecureString
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($urlSegura)
        try {
            $urlPlano = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        } finally {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
        $urlPlano = $urlPlano.Trim()
        if ([string]::IsNullOrWhiteSpace($urlPlano)) {
            throw "No se ingreso ninguna URL."
        }

        $uri = [Uri]$urlPlano
        if ($uri.Scheme -ne "postgresql" -and $uri.Scheme -ne "postgres") {
            throw "Esquema de URL inesperado: '$($uri.Scheme)'."
        }
        if ($uri.Host.ToLower() -like "*-pooler*") {
            throw "RECHAZADO (frio) -- el host es un endpoint POOLED. Se exige la conexion DIRECTA."
        }
        if ($uri.Host.ToLower() -ne $HostProduccionEsperado.ToLower()) {
            throw "RECHAZADO (frio) -- el host no coincide EXACTAMENTE con el esperado."
        }
        $baseDatosEnUrl = $uri.AbsolutePath.TrimStart('/')
        if ($baseDatosEnUrl -ne $BaseDatosProduccionEsperada) {
            throw "RECHAZADO (frio) -- base de datos '$baseDatosEnUrl' no coincide con la esperada '$BaseDatosProduccionEsperada'."
        }
        $usuarioEnUrl = ""
        if ($uri.UserInfo) {
            $usuarioEnUrl = [Uri]::UnescapeDataString(($uri.UserInfo -split ':', 2)[0])
        }
        if ($usuarioEnUrl -ne $RolEsperado) {
            throw "RECHAZADO (frio) -- usuario '$usuarioEnUrl' en la URL no coincide con el rol esperado '$RolEsperado'."
        }

        # sslmode=require o sslmode=verify-full (correccion v5 #A). Analisis
        # de texto puro sobre la query string -- sin abrir ninguna conexion,
        # sin depender de ningun ensamblado externo (ni System.Web).
        $paresQueryUrl = @{}
        $textoQueryUrl = $uri.Query.TrimStart('?')
        foreach ($parQuery in ($textoQueryUrl -split '&')) {
            if ([string]::IsNullOrWhiteSpace($parQuery)) { continue }
            $partesQuery = $parQuery -split '=', 2
            $claveQuery = [Uri]::UnescapeDataString($partesQuery[0]).ToLower()
            $valorQuery = if ($partesQuery.Count -gt 1) { [Uri]::UnescapeDataString($partesQuery[1]) } else { "" }
            $paresQueryUrl[$claveQuery] = $valorQuery
        }
        $sslModeEnUrl = $paresQueryUrl["sslmode"]
        $sslModeEnUrlNormalizado = if ($sslModeEnUrl) { $sslModeEnUrl.ToLower() } else { $null }
        if ($sslModeEnUrlNormalizado -ne "require" -and $sslModeEnUrlNormalizado -ne "verify-full") {
            $sslModeMostrado = if ($null -eq $sslModeEnUrl) { "(ausente)" } else { "'$sslModeEnUrl'" }
            throw "RECHAZADO (frio) -- sslmode $sslModeMostrado no valido en la URL. Se exige exactamente 'sslmode=require' o 'sslmode=verify-full'."
        }

        Write-Host "Validacion en frio OK (sin mostrar la URL ni la contrasena) -- incluye sslmode='$sslModeEnUrlNormalizado'." -ForegroundColor Green

        $env:DATABASE_URL = $urlPlano
        $env:SEED_DATABASE_URL = $urlPlano

        # ===================================================================
        # 3. Codigo de verificacion -- UN SOLO archivo .cjs temporal, con
        #    TODAS las consultas de solo lectura. Ninguna linea de este
        #    bloque escribe nada: el propio codigo fija
        #    "default_transaction_read_only = on" nada mas conectar, antes
        #    de correr ninguna consulta, como defensa adicional.
        # ===================================================================

        # Inventario de 21 funciones.
        $nombresFuncionesEsperadas = @(
            @{ nombre = "login_lookup_plataforma"; firma = "text" },
            @{ nombre = "registrar_intento_fallido_plataforma"; firma = "text" },
            @{ nombre = "restablecer_intentos_plataforma"; firma = "text" },
            @{ nombre = "leer_estado_sesion_plataforma"; firma = "text" },
            @{ nombre = "incrementar_version_sesion_plataforma"; firma = "text" },
            @{ nombre = "desactivar_usuario_plataforma"; firma = "text, text" },
            @{ nombre = "reactivar_usuario_plataforma"; firma = "text, text" },
            @{ nombre = "enrolar_mfa_plataforma"; firma = "text, text" },
            @{ nombre = "activar_mfa_plataforma"; firma = "text, integer" },
            @{ nombre = "consumir_contador_totp_plataforma"; firma = "text, integer" },
            @{ nombre = "leer_mfa_plataforma"; firma = "text" },
            @{ nombre = "crear_cuestionario_version"; firma = "text, text, text" },
            @{ nombre = "corregir_cuestionario_version"; firma = "text, text, text, text" },
            @{ nombre = "crear_pregunta_version"; firma = "text, text, text, integer, text, text, jsonb, boolean" },
            @{ nombre = "editar_pregunta_version"; firma = "text, text, text, jsonb, boolean" },
            @{ nombre = "eliminar_pregunta_version"; firma = "text" },
            @{ nombre = "editar_metadata_cuestionario_version"; firma = "text, text" },
            @{ nombre = "reordenar_preguntas_version"; firma = "text, jsonb" },
            @{ nombre = "validar_estructura_opciones_pregunta"; firma = "jsonb" },
            @{ nombre = "publicar_cuestionario_version"; firma = "text, text, text, text, text" },
            @{ nombre = "retirar_cuestionario_version"; firma = "text, text, text" }
        )

        $codigoVerificacion = @'
"use strict";
const path = require("path");
const { createRequire } = require("module");
const req = createRequire(path.join(process.cwd(), "package.json"));
const { Client } = req("pg");

const MIGRACIONES_RF19_RF20 = [
  "20261030090000_rf19_rf20_revoke_create_public",
  "20261030100000_rf19_enum_bucket_limite_tasa_login_y_mfa",
  "20261030101000_rf19_columnas_usuario_plataforma",
  "20261030102000_rf19_indice_email_normalizado",
  "20261030103000_rf19_funciones_controladas",
  "20261030110000_rf19_leer_mfa_plataforma",
  "20261030120000_rf20_bitacora_version_cuestionario",
  "20261030121000_rf20_funciones_controladas",
  "20261031010000_rf20_corregir_ambiguedad_numero_funciones",
  "20261031011000_rf20_calificar_resultado_validacion_publicacion",
];

// 21 funciones.
const FUNCIONES_ESPERADAS = [
  "login_lookup_plataforma",
  "registrar_intento_fallido_plataforma",
  "restablecer_intentos_plataforma",
  "leer_estado_sesion_plataforma",
  "incrementar_version_sesion_plataforma",
  "desactivar_usuario_plataforma",
  "reactivar_usuario_plataforma",
  "enrolar_mfa_plataforma",
  "activar_mfa_plataforma",
  "consumir_contador_totp_plataforma",
  "leer_mfa_plataforma",
  "crear_cuestionario_version",
  "corregir_cuestionario_version",
  "crear_pregunta_version",
  "editar_pregunta_version",
  "eliminar_pregunta_version",
  "editar_metadata_cuestionario_version",
  "reordenar_preguntas_version",
  "validar_estructura_opciones_pregunta",
  "publicar_cuestionario_version",
  "retirar_cuestionario_version",
];

// Verificacion de CONTENIDO real via pg_get_functiondef() -- confirma que
// las correcciones quedaron reflejadas en el cuerpo real de las
// funciones, no solo en su metadata. formaCorregida/formaAmbigua son
// ARREGLOS de expresiones regulares: TODAS las de formaCorregida deben
// coincidir; CUALQUIERA de formaAmbigua que coincida es brecha. Un
// arreglo formaAmbigua vacio significa que, para esa funcion, solo se
// verifica la presencia de la forma corregida -- no se intenta una
// comprobacion negativa, por riesgo de falso positivo (ver comentario en
// la entrada de validar_estructura_opciones_pregunta).
//
// Disenadas para no dar falso positivo: "max(numero)" bare nunca
// coincide dentro de "max(cv.numero)" porque entre el parentesis y
// "numero" hay "cv.", no solo espacio en blanco; analogamente para
// "select valido" contra "select validacion.valido".
const DEFINICIONES_A_VERIFICAR = [
  {
    nombre: "crear_cuestionario_version",
    // Fuente: README.md, "Errata normativa -- ambiguedad numero
    // detectada en rama temporal (2026-10-31)".
    formaCorregida: [/max\(\s*cv\.numero\s*\)/i],
    formaAmbigua: [/max\(\s*numero\s*\)/i],
  },
  {
    nombre: "corregir_cuestionario_version",
    formaCorregida: [/max\(\s*cv\.numero\s*\)/i],
    formaAmbigua: [/max\(\s*numero\s*\)/i],
  },
  {
    nombre: "publicar_cuestionario_version",
    // Fuente: README.md, "Errata normativa -- ambiguedad motivo
    // detectada en rama temporal (2026-10-31)".
    formaCorregida: [/validacion\.valido\s*,\s*validacion\.motivo/i],
    formaAmbigua: [/select\s+valido\s*,\s*motivo\b/i],
  },
  {
    nombre: "validar_estructura_opciones_pregunta",
    // Fuente: README.md, "Errata normativa -- PR 6 (2026-10-30)", mas
    // lectura directa de la migracion 20261030121000 ya desplegada, que
    // confirma la presencia real de estas 3 guardas de existencia de
    // clave (operador "?", nunca devuelve NULL, a diferencia de "->").
    // Sin formaAmbigua: el texto documentado como "forma anterior" en
    // v7 Seccion 7.8 ("IF jsonb_typeof(v_elemento->'texto') <> 'string'
    // OR btrim(...) = '' THEN", en una sola linea) comparte casi todos
    // sus tokens con la forma corregida (que solo antepone "NOT
    // (v_elemento ? 'texto') OR" a la misma condicion) -- un patron de
    // "ausencia" simple y robusto frente a reformateo de espacios/saltos
    // de linea no se pudo construir con seguridad, asi que aqui solo se
    // verifica la presencia de la forma corregida.
    formaCorregida: [
      /not\s*\(\s*v_elemento\s*\?\s*'valor'\s*\)/i,
      /not\s*\(\s*v_elemento\s*\?\s*'texto'\s*\)/i,
      /not\s*\(\s*v_elemento\s*\?\s*'orden'\s*\)/i,
    ],
    formaAmbigua: [],
  },
];

(async () => {
  const connectionString = process.env.SEED_DATABASE_URL;
  if (!connectionString) {
    console.error("CIERRE_VERIFICACION_FALLO_SIN_SEED_DATABASE_URL");
    process.exit(1);
    return;
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Defensa adicional: esta sesion completa queda en modo de solo
    // lectura ANTES de correr ninguna otra consulta. Cualquier escritura
    // que se intentara aqui por error fallaria en el servidor.
    await client.query("SET default_transaction_read_only = on");

    const u = new URL(connectionString);
    const identidad = await client.query("SELECT current_database() AS base, current_user AS rol");
    const { base, rol } = identidad.rows[0];

    // --- 1. Historial de migraciones -- agrupado por migration_name
    //        (correccion v5 #B): Prisma puede dejar mas de un intento bajo
    //        el mismo nombre (uno fallido/revertido seguido de uno
    //        exitoso, por ejemplo), asi que esto nunca asume una unica
    //        fila por nombre. Para cada nombre esperado se exige al menos
    //        un intento aplicado (finished_at no nulo Y rolled_back_at
    //        nulo) y cero intentos activamente inconclusos (finished_at
    //        nulo Y rolled_back_at nulo) -- ambos contados por separado,
    //        por nombre, con filtros agregados de solo lectura. --------
    const migracionesAgrupadas = await client.query(
      `SELECT
         migration_name,
         count(*) AS intentos,
         count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS aplicados,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS inconclusos,
         count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS revertidos
       FROM "_prisma_migrations"
       WHERE migration_name = ANY($1::text[])
       GROUP BY migration_name`,
      [MIGRACIONES_RF19_RF20]
    );
    // Red de seguridad adicional, sin cambios desde v1: cero migraciones
    // inconclusas en TODA la tabla, sin importar el nombre (cubre
    // cualquier migracion fuera de RF19/RF20 que hubiera quedado a
    // medias).
    const inconclusasGlobal = await client.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL'
    );

    // --- 2. Esquema public -- CREATE revocado, mas propiedad real del
    //        esquema (correccion v3 #2: acepta neondb_owner directo, o
    //        pg_database_owner validado contra pg_database.datdba).
    //        Fuente real: README.md, "Errata normativa -- validacion
    //        Neon del PR 7 (2026-10-31)" -- confirma que Neon representa
    //        al propietario del esquema public via pg_database_owner, y
    //        que el propietario real sigue siendo neondb_owner. -------
    const publicConservaCreate = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
        WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
      ) AS valor
    `);
    const chainpulseAppConservaCreate = await client.query(
      "SELECT has_schema_privilege('chainpulse_app', 'public', 'CREATE') AS valor"
    );
    const propietarioEsquemaPublic = await client.query(`
      SELECT n.nspowner::regrole::text AS propietario
      FROM pg_namespace n WHERE n.nspname = 'public'
    `);
    const datdbaInfo = await client.query(`
      SELECT pg_get_userbyid(d.datdba) AS datdba_rolname
      FROM pg_database d WHERE d.datname = current_database()
    `);
    const rolesConCreatePublic = await client.query(`
      SELECT DISTINCT r.rolname
      FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a
      JOIN pg_roles r ON r.oid = a.grantee
      WHERE n.nspname = 'public' AND a.privilege_type = 'CREATE'
    `);
    const chainpulseAppPuedeSetNeondbOwner = await client.query(
      "SELECT pg_has_role('chainpulse_app', 'neondb_owner', 'SET') AS valor"
    );

    // --- 3. Enums -- json_agg (correccion v6 #I), nunca array_agg: "pg"
    //        parsea una columna "json" SIEMPRE como arreglo JS real (via
    //        JSON.parse); array_agg(enumlabel) podia llegar como el
    //        literal de texto de PostgreSQL "{...}" sin parsear. --------
    const enums = await client.query(`
      SELECT t.typname AS nombre, json_agg(e.enumlabel ORDER BY e.enumsortorder) AS valores
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('AccionBitacoraVersion', 'BucketLimiteTasa')
      GROUP BY t.typname
    `);

    // --- 4. Columnas nuevas de usuarios_plataforma -----------------------
    const columnasUsuariosPlataforma = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'usuarios_plataforma'
        AND column_name IN ('activo', 'sessionVersion', 'mfaUltimoContadorUsado')
    `);

    // --- 5. Indice unico funcional de email -------------------------------
    const indiceEmail = await client.query(`
      SELECT c.relname AS nombre, i.indisunique AS es_unico, pi.indexdef AS definicion
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_indexes pi ON pi.indexname = c.relname AND pi.schemaname = 'public'
      WHERE c.relname = 'uq_usuarios_plataforma_email_normalizado'
    `);

    // --- 6. Tabla bitacora_version_cuestionario: columnas, constraints,
    //        indices -----------------------------------------------------
    const columnasBitacora = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'bitacora_version_cuestionario'
      ORDER BY ordinal_position
    `);
    const constraintsBitacora = await client.query(`
      SELECT con.conname AS nombre, con.contype AS tipo, pg_get_constraintdef(con.oid) AS definicion
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'bitacora_version_cuestionario'
      ORDER BY con.conname
    `);
    const indicesBitacora = await client.query(`
      SELECT indexname AS nombre, indexdef AS definicion
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'bitacora_version_cuestionario'
      ORDER BY indexname
    `);

    // --- 7. Grants efectivos de chainpulse_app sobre las 4 tablas
    //        gobernadas, via has_table_privilege (solo lectura de
    //        catalogo, nunca un INSERT/UPDATE/DELETE real de prueba) ----
    const TABLAS_GOBERNADAS = [
      "usuarios_plataforma",
      "cuestionario_versiones",
      "pregunta_versiones",
      "bitacora_version_cuestionario",
    ];
    const grantsTablas = {};
    for (const tabla of TABLAS_GOBERNADAS) {
      const r = await client.query(
        `SELECT
           has_table_privilege('chainpulse_app', $1, 'SELECT') AS select_otorgado,
           has_table_privilege('chainpulse_app', $1, 'INSERT') AS insert_otorgado,
           has_table_privilege('chainpulse_app', $1, 'UPDATE') AS update_otorgado,
           has_table_privilege('chainpulse_app', $1, 'DELETE') AS delete_otorgado`,
        ["public." + tabla]
      );
      grantsTablas[tabla] = r.rows[0];
    }

    // --- 8. Las 21 funciones SECURITY DEFINER -- metadata (misma consulta
    //        base que la Seccion 3.4 de v7) mas ACL desglosado en 4
    //        categorias independientes (correccion v3 #1): PUBLIC
    //        (grantee=0); chainpulse_app; el PROPIETARIO (grantee=
    //        p.proowner -- permitido, nunca tercero); y cualquier otro rol
    //        (tercero inesperado). p.proowner se verifica, por separado,
    //        que resuelva EXACTAMENTE a neondb_owner (campo
    //        "propietario" de metadata, comparado en PowerShell). -------
    const funciones = [];
    for (const nombre of FUNCIONES_ESPERADAS) {
      const meta = await client.query(
        `SELECT
           p.proname,
           oidvectortypes(p.proargtypes) AS firma,
           pg_get_function_identity_arguments(p.oid) AS firma_con_nombres,
           r.rolname AS propietario,
           p.proowner AS propietario_oid,
           p.prosecdef AS es_security_definer,
           p.proconfig AS configuracion,
           (p.proacl IS NULL) AS acl_es_null
         FROM pg_proc p
         JOIN pg_roles r ON r.oid = p.proowner
         WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace`,
        [nombre]
      );

      let acl = {
        publicTieneExecute: false,
        chainpulseAppTieneExecute: false,
        propietarioTieneExecute: false,
        rolesTercerosConExecute: [],
      };
      if (meta.rows.length === 1 && !meta.rows[0].acl_es_null) {
        const propietarioOid = Number(meta.rows[0].propietario_oid);
        const aclRows = await client.query(
          `SELECT a.grantee AS grantee_oid, r2.rolname AS grantee_rolname
           FROM pg_proc p
           JOIN LATERAL aclexplode(p.proacl) a ON true
           LEFT JOIN pg_roles r2 ON r2.oid = a.grantee
           WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace
             AND a.privilege_type = 'EXECUTE'`,
          [nombre]
        );
        for (const fila of aclRows.rows) {
          const granteeOid = Number(fila.grantee_oid);
          if (granteeOid === 0 || fila.grantee_rolname === null) {
            acl.publicTieneExecute = true;
          } else if (granteeOid === propietarioOid) {
            // Propietario: permitido, NUNCA se cuenta como tercero
            // inesperado (correccion v3 #1).
            acl.propietarioTieneExecute = true;
          } else if (fila.grantee_rolname === "chainpulse_app") {
            acl.chainpulseAppTieneExecute = true;
          } else {
            acl.rolesTercerosConExecute.push(fila.grantee_rolname);
          }
        }
      }

      funciones.push({ nombre, filas: meta.rows, acl });
    }

    // --- 9. Contenido real de las funciones corregidas por las
    //        migraciones correctivas/suplementarias (correccion v4 #5:
    //        formaCorregida/formaAmbigua ahora son arreglos) -----------
    const definicionesFunciones = {};
    for (const item of DEFINICIONES_A_VERIFICAR) {
      const r = await client.query(
        `SELECT pg_get_functiondef(p.oid) AS definicion
         FROM pg_proc p
         WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace`,
        [item.nombre]
      );
      if (r.rows.length === 1) {
        const def = r.rows[0].definicion;
        definicionesFunciones[item.nombre] = {
          existe: true,
          sobrecargas: 1,
          contieneFormaCorregida: item.formaCorregida.every((re) => re.test(def)),
          contieneFormaAmbigua: item.formaAmbigua.some((re) => re.test(def)),
          formaAmbiguaVerificada: item.formaAmbigua.length > 0,
        };
      } else {
        definicionesFunciones[item.nombre] = {
          existe: false,
          sobrecargas: r.rows.length,
          contieneFormaCorregida: false,
          contieneFormaAmbigua: false,
          formaAmbiguaVerificada: item.formaAmbigua.length > 0,
        };
      }
    }

    console.log(JSON.stringify({
      hostCoincide: u.hostname.toLowerCase() === process.env.__RF19RF20_HOST_ESPERADO__,
      base,
      rol,
      migracionesAgrupadas: migracionesAgrupadas.rows,
      inconclusasGlobal: inconclusasGlobal.rows.map((row) => row.migration_name),
      publicConservaCreate: publicConservaCreate.rows[0].valor,
      chainpulseAppConservaCreate: chainpulseAppConservaCreate.rows[0].valor,
      propietarioEsquemaPublic: propietarioEsquemaPublic.rows[0].propietario,
      datdbaRolname: datdbaInfo.rows[0].datdba_rolname,
      rolesConCreatePublic: rolesConCreatePublic.rows.map((r) => r.rolname),
      chainpulseAppPuedeSetNeondbOwner: chainpulseAppPuedeSetNeondbOwner.rows[0].valor,
      enums: enums.rows,
      columnasUsuariosPlataforma: columnasUsuariosPlataforma.rows,
      indiceEmail: indiceEmail.rows,
      columnasBitacora: columnasBitacora.rows,
      constraintsBitacora: constraintsBitacora.rows,
      indicesBitacora: indicesBitacora.rows,
      grantsTablas,
      funciones,
      definicionesFunciones,
    }));
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error("CIERRE_VERIFICACION_FALLO");
  process.exit(1);
});
'@

        $RutaVerificacion = Join-Path -Path $env:Temp -ChildPath ("rf19-rf20-cierre-verificacion-" + [Guid]::NewGuid().ToString("N") + ".cjs")
        $codificacionUtf8SinBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($RutaVerificacion, $codigoVerificacion, $codificacionUtf8SinBom)
        $RutasTemporales.Add($RutaVerificacion)

        # El host esperado se pasa a Node por una variable de entorno
        # DISTINTA de SEED_DATABASE_URL -- nunca la URL completa -- solo
        # para que el propio script de Node pueda comparar sin que este
        # proceso de PowerShell tenga que volver a parsear el host desde
        # la URL en texto plano una segunda vez.
        $env:__RF19RF20_HOST_ESPERADO__ = $HostProduccionEsperado.ToLower()
        $salidaVerificacionJson = & node $RutaVerificacion
        $codigoSalidaVerificacion = $LASTEXITCODE
        Remove-Item Env:\__RF19RF20_HOST_ESPERADO__ -ErrorAction SilentlyContinue

        if ($codigoSalidaVerificacion -ne 0) {
            throw "La verificacion de solo lectura (Node/pg) fallo -- codigo $codigoSalidaVerificacion."
        }

        $v = $salidaVerificacionJson | ConvertFrom-Json

        # ===================================================================
        # 4. Comparacion contra lo esperado -- cada discrepancia se acumula,
        #    nunca se silencia ni detiene la comparacion de las demas.
        # ===================================================================
        $brechas = [System.Collections.Generic.List[string]]::new()
        $confirmaciones = [System.Collections.Generic.List[string]]::new()

        if (-not $v.hostCoincide) { $brechas.Add("El host conectado no coincide con el endpoint directo esperado.") }
        if ($v.rol -ne $RolEsperado) { $brechas.Add("Rol conectado '$($v.rol)' no coincide con el esperado '$RolEsperado'.") }
        if ($v.base -ne $BaseDatosProduccionEsperada) { $brechas.Add("Base conectada '$($v.base)' no coincide con la esperada '$BaseDatosProduccionEsperada'.") }
        if ($v.hostCoincide -and $v.rol -eq $RolEsperado -and $v.base -eq $BaseDatosProduccionEsperada) {
            $confirmaciones.Add("Identidad de conexion correcta (host/base/rol), sin exponer el host literal.")
        }

        # -- Migraciones, agrupadas por nombre (correccion v5 #B) -- nunca
        #    se asume una unica fila por migration_name: se exige al menos
        #    un intento aplicado y cero intentos activamente inconclusos,
        #    contados por separado, para cada uno de los 10 nombres. --
        $migracionesConBrecha = 0
        foreach ($nombre in $MigracionesRf19Rf20Esperadas) {
            $fila = $v.migracionesAgrupadas | Where-Object { $_.migration_name -eq $nombre }
            if (-not $fila) {
                $brechas.Add("Migracion '$nombre': no aparece en absoluto en _prisma_migrations (0 intentos).")
                $migracionesConBrecha++
                continue
            }
            $brechaEstaMigracion = $false
            if ([int]$fila.aplicados -lt 1) {
                $brechas.Add("Migracion '$nombre': cero intentos aplicados exitosamente (finished_at no nulo Y rolled_back_at nulo) entre $($fila.intentos) intento(s) registrados ($($fila.revertidos) revertido(s)).")
                $brechaEstaMigracion = $true
            }
            if ([int]$fila.inconclusos -gt 0) {
                $brechas.Add("Migracion '$nombre': $($fila.inconclusos) intento(s) activamente inconcluso(s) (finished_at nulo Y rolled_back_at nulo) entre $($fila.intentos) intento(s) registrados.")
                $brechaEstaMigracion = $true
            }
            if ($brechaEstaMigracion) { $migracionesConBrecha++ }
        }
        if (@($v.inconclusasGlobal).Count -gt 0) {
            $brechas.Add("Hay migraciones activamente inconclusas en TODA la tabla (cualquier nombre): $($v.inconclusasGlobal -join ', ').")
        }
        if ($migracionesConBrecha -eq 0 -and (@($v.inconclusasGlobal).Count -eq 0)) {
            $confirmaciones.Add("Las 10 migraciones RF19/RF20 tienen, cada una, al menos un intento aplicado (finished_at no nulo y rolled_back_at nulo) y cero intentos activamente inconclusos, agrupando por nombre para cubrir posibles reintentos; cero migraciones inconclusas en el resto de la tabla.")
        }

        # -- Esquema public: CREATE revocado + propiedad validada
        #    (correccion v3 #2) --
        if ($v.publicConservaCreate) { $brechas.Add("PUBLIC conserva CREATE sobre el esquema public.") }
        if ($v.chainpulseAppConservaCreate) { $brechas.Add("chainpulse_app conserva CREATE sobre el esquema public.") }
        if ($v.chainpulseAppPuedeSetNeondbOwner) { $brechas.Add("chainpulse_app puede ejecutar SET ROLE neondb_owner.") }

        $propietarioNspowner = $v.propietarioEsquemaPublic
        $datdbaRolname = $v.datdbaRolname
        $propietarioEsquemaValidado = $false
        if ($propietarioNspowner -eq $RolEsperado) {
            $propietarioEsquemaValidado = $true
            $confirmaciones.Add("Esquema public poseido directamente por '$RolEsperado' (pg_namespace.nspowner).")
        } elseif ($propietarioNspowner -eq $RolAliasEsquemaPermitido -and $datdbaRolname -eq $RolEsperado) {
            $propietarioEsquemaValidado = $true
            $confirmaciones.Add("Esquema public poseido por el rol pseudo '$RolAliasEsquemaPermitido'; validado porque pg_database.datdba de la base actual resuelve exactamente a '$RolEsperado' (errata real de validacion Neon).")
        } else {
            $brechas.Add("Esquema public NO esta poseido por un propietario validado -- nspowner='$propietarioNspowner', datdba='$datdbaRolname'. Se esperaba '$RolEsperado' directo, o '$RolAliasEsquemaPermitido' con datdba='$RolEsperado'.")
        }

        $rolesPermitidosConCreate = @($RolEsperado)
        if ($propietarioEsquemaValidado -and $propietarioNspowner -eq $RolAliasEsquemaPermitido) {
            $rolesPermitidosConCreate += $RolAliasEsquemaPermitido
        }
        $rolesInesperadosConCreate = @($v.rolesConCreatePublic) | Where-Object { $_ -notin $rolesPermitidosConCreate }
        if ($rolesInesperadosConCreate.Count -gt 0) {
            $brechas.Add("Rol(es) inesperado(s) con CREATE sobre public: $($rolesInesperadosConCreate -join ', ').")
        }

        if (-not $v.publicConservaCreate -and -not $v.chainpulseAppConservaCreate -and $propietarioEsquemaValidado -and ($rolesInesperadosConCreate.Count -eq 0) -and (-not $v.chainpulseAppPuedeSetNeondbOwner)) {
            $confirmaciones.Add("Las comprobaciones de la postcondicion de 'rf19_rf20_revoke_create_public' (v7, Seccion 3.1), incluida la validacion real de propiedad del esquema (neondb_owner directo, o pg_database_owner con datdba=neondb_owner), siguen en verde tras las 10 migraciones.")
        }

        # -- Enums --
        $enumAccion = $v.enums | Where-Object { $_.nombre -eq "AccionBitacoraVersion" }
        $valoresEsperadosAccion = @("CORREGIR", "PUBLICAR", "RETIRAR") | Sort-Object
        if (-not $enumAccion) {
            $brechas.Add("El enum 'AccionBitacoraVersion' no existe.")
        } else {
            $valoresReales = @($enumAccion.valores) | Sort-Object
            if (($valoresReales -join ',') -ne ($valoresEsperadosAccion -join ',')) {
                $brechas.Add("Valores de 'AccionBitacoraVersion' distintos de los esperados: real=[$($valoresReales -join ', ')].")
            } else {
                $confirmaciones.Add("Enum 'AccionBitacoraVersion' con exactamente CORREGIR/PUBLICAR/RETIRAR.")
            }
        }
        $enumBucket = $v.enums | Where-Object { $_.nombre -eq "BucketLimiteTasa" }
        if (-not $enumBucket) {
            $brechas.Add("El enum 'BucketLimiteTasa' no existe.")
        } else {
            $valoresBucket = @($enumBucket.valores)
            foreach ($valorNuevo in @("LOGIN_PLATAFORMA", "VERIFICACION_MFA_PLATAFORMA")) {
                if ($valorNuevo -notin $valoresBucket) {
                    $brechas.Add("El enum 'BucketLimiteTasa' no contiene el valor nuevo '$valorNuevo'.")
                }
            }
            if (("LOGIN_PLATAFORMA" -in $valoresBucket) -and ("VERIFICACION_MFA_PLATAFORMA" -in $valoresBucket)) {
                $confirmaciones.Add("Enum 'BucketLimiteTasa' contiene ambos valores nuevos de RF19.")
            }
        }

        # -- Columnas nuevas de usuarios_plataforma --
        $columnasEsperadas = @{
            "activo" = @{ data_type = "boolean"; is_nullable = "NO" }
            "sessionVersion" = @{ data_type = "integer"; is_nullable = "NO" }
            "mfaUltimoContadorUsado" = @{ data_type = "integer"; is_nullable = "YES" }
        }
        foreach ($nombreCol in $columnasEsperadas.Keys) {
            $filaCol = $v.columnasUsuariosPlataforma | Where-Object { $_.column_name -eq $nombreCol }
            if (-not $filaCol) {
                $brechas.Add("Columna '$nombreCol' no existe en usuarios_plataforma.")
                continue
            }
            $esperado = $columnasEsperadas[$nombreCol]
            if ($filaCol.data_type -ne $esperado.data_type) {
                $brechas.Add("Columna '$nombreCol' tiene tipo '$($filaCol.data_type)', se esperaba '$($esperado.data_type)'.")
            }
            if ($filaCol.is_nullable -ne $esperado.is_nullable) {
                $brechas.Add("Columna '$nombreCol' tiene is_nullable='$($filaCol.is_nullable)', se esperaba '$($esperado.is_nullable)'.")
            }
        }
        if (($v.columnasUsuariosPlataforma | Measure-Object).Count -eq 3) {
            $confirmaciones.Add("Las 3 columnas nuevas de usuarios_plataforma (activo, sessionVersion, mfaUltimoContadorUsado) existen con el tipo/nulabilidad esperados.")
        }

        # -- Indice de email --
        $filaIndice = $v.indiceEmail | Select-Object -First 1
        if (-not $filaIndice) {
            $brechas.Add("El indice 'uq_usuarios_plataforma_email_normalizado' no existe.")
        } else {
            if (-not $filaIndice.es_unico) { $brechas.Add("El indice de email existe pero NO es unico.") }
            if ($filaIndice.definicion -notmatch 'lower\(btrim\(email\)\)') {
                $brechas.Add("La definicion del indice de email no coincide con 'lower(btrim(email))': '$($filaIndice.definicion)'.")
            }
            if ($filaIndice.es_unico -and $filaIndice.definicion -match 'lower\(btrim\(email\)\)') {
                $confirmaciones.Add("Indice unico funcional de email presente y definido exactamente como lower(btrim(email)).")
            }
        }

        # -- Tabla bitacora_version_cuestionario --
        $columnasBitacoraEsperadas = @("id", "cuestionarioVersionId", "versionOrigenId", "actorId", "accion", "createdAt") | Sort-Object
        $columnasBitacoraReales = @($v.columnasBitacora | ForEach-Object { $_.column_name }) | Sort-Object
        if (($columnasBitacoraReales -join ',') -ne ($columnasBitacoraEsperadas -join ',')) {
            $brechas.Add("Columnas de bitacora_version_cuestionario distintas de las esperadas: real=[$($columnasBitacoraReales -join ', ')].")
        } else {
            $confirmaciones.Add("bitacora_version_cuestionario tiene exactamente las 6 columnas esperadas.")
        }
        $cantidadFk = ($v.constraintsBitacora | Where-Object { $_.tipo -eq "f" } | Measure-Object).Count
        if ($cantidadFk -ne 3) {
            $brechas.Add("bitacora_version_cuestionario tiene $cantidadFk FOREIGN KEY, se esperaban exactamente 3.")
        } else {
            $fksNoRestrict = $v.constraintsBitacora | Where-Object { $_.tipo -eq "f" -and $_.definicion -notmatch "ON DELETE RESTRICT" }
            if (($fksNoRestrict | Measure-Object).Count -gt 0) {
                $brechas.Add("Al menos una FOREIGN KEY de bitacora_version_cuestionario no es ON DELETE RESTRICT.")
            } else {
                $confirmaciones.Add("bitacora_version_cuestionario tiene exactamente 3 FOREIGN KEY, todas ON DELETE RESTRICT.")
            }
        }
        $cantidadPk = ($v.constraintsBitacora | Where-Object { $_.tipo -eq "p" } | Measure-Object).Count
        if ($cantidadPk -ne 1) { $brechas.Add("bitacora_version_cuestionario tiene $cantidadPk PRIMARY KEY, se esperaba exactamente 1.") }

        # -- Grants por tabla --
        $tablasSinSelectDirecto = @("usuarios_plataforma")
        $tablasConSelectSoloLectura = @("cuestionario_versiones", "pregunta_versiones", "bitacora_version_cuestionario")

        foreach ($tabla in $tablasSinSelectDirecto) {
            $g = $v.grantsTablas.$tabla
            if ($g.select_otorgado -or $g.insert_otorgado -or $g.update_otorgado -or $g.delete_otorgado) {
                $brechas.Add("Tabla '$tabla' deberia tener CERO privilegios directos para chainpulse_app (ni SELECT), pero se encontro al menos uno otorgado.")
            } else {
                $confirmaciones.Add("Tabla '$tabla' sin ningun privilegio directo para chainpulse_app (ni SELECT) -- toda lectura/escritura pasa por funcion.")
            }
        }
        foreach ($tabla in $tablasConSelectSoloLectura) {
            $g = $v.grantsTablas.$tabla
            if (-not $g.select_otorgado) { $brechas.Add("Tabla '$tabla' deberia tener SELECT otorgado a chainpulse_app, pero no lo tiene.") }
            if ($g.insert_otorgado -or $g.update_otorgado -or $g.delete_otorgado) {
                $brechas.Add("Tabla '$tabla' tiene al menos un privilegio de escritura directo (INSERT/UPDATE/DELETE) otorgado a chainpulse_app -- se esperaba ninguno.")
            }
            if ($g.select_otorgado -and (-not $g.insert_otorgado) -and (-not $g.update_otorgado) -and (-not $g.delete_otorgado)) {
                $confirmaciones.Add("Tabla '$tabla' con SELECT otorgado y CERO privilegios de escritura directa para chainpulse_app.")
            }
        }

        # -- Las 21 funciones (ACL en 4 categorias independientes --
        #    correccion v3 #1) --
        $funcionesConBrecha = 0
        foreach ($esperada in $nombresFuncionesEsperadas) {
            $entrada = $v.funciones | Where-Object { $_.nombre -eq $esperada.nombre }
            $filas = @($entrada.filas)
            if ($filas.Count -eq 0) {
                $brechas.Add("Funcion '$($esperada.nombre)': no existe en public.")
                $funcionesConBrecha++
                continue
            }
            if ($filas.Count -gt 1) {
                $brechas.Add("Funcion '$($esperada.nombre)': existe mas de una sobrecarga en public (se esperaba exactamente una).")
                $funcionesConBrecha++
                continue
            }
            $fila = $filas[0]
            $brechaEstaFuncion = $false
            # Comparacion de tipos via oidvectortypes (correccion v6 #II) --
            # nunca pg_get_function_identity_arguments, que puede incluir
            # nombres de parametros. firma_con_nombres se incluye en el
            # mensaje solo como dato informativo para diagnostico visual.
            if ($fila.firma -ne $esperada.firma) {
                $brechas.Add("Funcion '$($esperada.nombre)': firma real (tipos, oidvectortypes) '$($fila.firma)', se esperaba '$($esperada.firma)'. [informativo, con nombres de parametro: '$($fila.firma_con_nombres)']")
                $brechaEstaFuncion = $true
            }
            # p.proowner debe resolver EXACTAMENTE a neondb_owner (correccion
            # v3 #1, segunda mitad).
            if ($fila.propietario -ne $RolEsperado) {
                $brechas.Add("Funcion '$($esperada.nombre)': propietario (p.proowner resuelto) '$($fila.propietario)', se esperaba '$RolEsperado'.")
                $brechaEstaFuncion = $true
            }
            if (-not $fila.es_security_definer) {
                $brechas.Add("Funcion '$($esperada.nombre)': NO es SECURITY DEFINER.")
                $brechaEstaFuncion = $true
            }
            $configuracion = @($fila.configuracion)
            if (($configuracion -join ',') -notmatch 'search_path=public, ?pg_temp') {
                $brechas.Add("Funcion '$($esperada.nombre)': search_path real '$($configuracion -join ', ')', se esperaba 'search_path=public, pg_temp'.")
                $brechaEstaFuncion = $true
            }

            # ACL en 4 categorias independientes: PUBLIC (grantee=0);
            # chainpulse_app; el propietario (grantee=p.proowner --
            # permitido, nunca tercero); cualquier otro rol (tercero
            # inesperado). proacl IS NULL sigue tratandose como brecha
            # explicita (privilegios por defecto, nunca revocados).
            if ($fila.acl_es_null) {
                $brechas.Add("Funcion '$($esperada.nombre)': proacl es NULL (privilegios por defecto) -- nunca se revoco explicitamente de PUBLIC.")
                $brechaEstaFuncion = $true
            } else {
                $acl = $entrada.acl
                if ($acl.publicTieneExecute) {
                    $brechas.Add("Funcion '$($esperada.nombre)': PUBLIC tiene EXECUTE otorgado explicitamente (se esperaba ninguno).")
                    $brechaEstaFuncion = $true
                }
                if (-not $acl.chainpulseAppTieneExecute) {
                    $brechas.Add("Funcion '$($esperada.nombre)': chainpulse_app NO tiene EXECUTE otorgado.")
                    $brechaEstaFuncion = $true
                }
                $terceros = @($acl.rolesTercerosConExecute)
                if ($terceros.Count -gt 0) {
                    $brechas.Add("Funcion '$($esperada.nombre)': rol(es) inesperado(s) con EXECUTE: $($terceros -join ', ') (el propietario, si aparece explicitamente, NO cuenta como tercero).")
                    $brechaEstaFuncion = $true
                }
            }

            if ($brechaEstaFuncion) { $funcionesConBrecha++ }
        }
        if ($funcionesConBrecha -eq 0) {
            $confirmaciones.Add("Las 21 funciones SECURITY DEFINER del inventario cerrado coinciden exactamente: firma, propietario (p.proowner resuelto) neondb_owner, SECURITY DEFINER, search_path=public,pg_temp; y, por separado en 4 categorias, PUBLIC sin EXECUTE, chainpulse_app con EXECUTE, el propietario nunca contado como tercero, y ningun rol tercero inesperado.")
        }

        # -- Verificacion de CONTENIDO real via pg_get_functiondef()
        #    (correccion v4 #5: se agrega validar_estructura_opciones_pregunta,
        #    sin comprobacion negativa para esa funcion especifica) --
        $definicionesEsperadas = [ordered]@{
            "crear_cuestionario_version"    = @{ corregida = "max(cv.numero)"; ambigua = "max(numero) [bare, ambiguo]" }
            "corregir_cuestionario_version" = @{ corregida = "max(cv.numero)"; ambigua = "max(numero) [bare, ambiguo]" }
            "publicar_cuestionario_version" = @{ corregida = "validacion.valido, validacion.motivo"; ambigua = "SELECT valido, motivo [bare, antiguo]" }
            "validar_estructura_opciones_pregunta" = @{ corregida = "NOT (v_elemento ? 'valor'/'texto'/'orden') antes de jsonb_typeof (guardas de existencia de clave, README 'Errata normativa -- PR 6')"; ambigua = $null }
        }
        foreach ($nombreFn in $definicionesEsperadas.Keys) {
            $d = $v.definicionesFunciones.$nombreFn
            $esperado = $definicionesEsperadas[$nombreFn]
            if (-not $d.existe) {
                $brechas.Add("Funcion '$nombreFn': no se pudo obtener su definicion via pg_get_functiondef() (sobrecargas encontradas: $($d.sobrecargas)).")
                continue
            }
            $brechaContenido = $false
            if (-not $d.contieneFormaCorregida) {
                $brechas.Add("Funcion '$nombreFn': su definicion real NO contiene la forma corregida esperada '$($esperado.corregida)'.")
                $brechaContenido = $true
            }
            if ($d.formaAmbiguaVerificada -and $d.contieneFormaAmbigua) {
                $brechas.Add("Funcion '$nombreFn': su definicion real TODAVIA contiene la forma antigua/ambigua '$($esperado.ambigua)'.")
                $brechaContenido = $true
            }
            if (-not $brechaContenido) {
                if ($d.formaAmbiguaVerificada) {
                    $confirmaciones.Add("Funcion '$nombreFn': su definicion real (pg_get_functiondef) contiene la forma corregida '$($esperado.corregida)' y no contiene la forma antigua/ambigua '$($esperado.ambigua)'.")
                } else {
                    $confirmaciones.Add("Funcion '$nombreFn': su definicion real (pg_get_functiondef) contiene la forma corregida '$($esperado.corregida)'. (Sin comprobacion negativa de 'forma antigua ausente' para esta funcion -- ver expediente.)")
                }
            }
        }

        $verificacionOk = ($brechas.Count -eq 0)

        # ===================================================================
        # 5. Expediente de cierre -- se escribe SIEMPRE (haya o no brechas),
        #    sanitizado: nunca la URL, nunca el host literal, nunca la
        #    contrasena. Solo en la ruta fija declarada en la Seccion 0, DEL
        #    CLON REAL de Alex (esta ruta no existe en ningun entorno de
        #    preparacion -- correccion v3 #7). Se llega aqui solo si las
        #    precondiciones de git (Seccion 1.5) pasaron.
        # ===================================================================
        $marcaDeTiempo = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        $lineasExpediente = [System.Collections.Generic.List[string]]::new()
        $lineasExpediente.Add("# RF19/RF20 -- Resultado real de la verificacion final de solo lectura (v6)")
        $lineasExpediente.Add("")
        $lineasExpediente.Add("Generado automaticamente por rf19-rf20-cierre-verificacion-solo-lectura-v6.ps1. Fecha UTC: $marcaDeTiempo.")
        $lineasExpediente.Add("Sanitizado: no contiene URL, host literal ni contrasena -- solo coincide/no-coincide contra lo esperado.")
        $lineasExpediente.Add("Precondiciones de git verificadas antes de escribir este archivo: rama '$RamaEsperada', arbol limpio, HEAD == $RemotoEsperado/$RamaEsperada.")
        $lineasExpediente.Add("")
        $lineasExpediente.Add("## Resultado")
        $lineasExpediente.Add("")
        if ($verificacionOk) {
            $lineasExpediente.Add("RF19_RF20_CIERRE_RESULTADO=TODO_OK")
        } else {
            $lineasExpediente.Add("RF19_RF20_CIERRE_RESULTADO=FALLO")
        }
        $lineasExpediente.Add("")
        $lineasExpediente.Add("## Confirmaciones ($($confirmaciones.Count))")
        $lineasExpediente.Add("")
        foreach ($c in $confirmaciones) { $lineasExpediente.Add("- $c") }
        $lineasExpediente.Add("")
        $lineasExpediente.Add("## Brechas encontradas ($($brechas.Count))")
        $lineasExpediente.Add("")
        if ($brechas.Count -eq 0) {
            $lineasExpediente.Add("Ninguna.")
        } else {
            foreach ($b in $brechas) { $lineasExpediente.Add("- $b") }
        }
        $lineasExpediente.Add("")
        $lineasExpediente.Add("## Trazabilidad complementaria de las 3 migraciones suplementarias (no son una brecha documental)")
        $lineasExpediente.Add("")
        $lineasExpediente.Add("Las migraciones 'rf19_leer_mfa_plataforma', 'rf20_corregir_ambiguedad_numero_funciones' y 'rf20_calificar_resultado_validacion_publicacion' son posteriores a (o estan fuera de) adenda-diseno-rf19-rf20-v7.docx. Esto NO es una brecha documental: estan documentadas (dos erratas de README.md, y el propio archivo de migracion para la funcion nueva -- ver el expediente de cierre acompanante para la cita literal completa de cada una). Este script verifico activamente las 3: presencia en el historial de migraciones (las 3), metadata completa de catalogo (leer_mfa_plataforma), y contenido real via pg_get_functiondef (las 2 correcciones, mas validar_estructura_opciones_pregunta por una tercera errata de README) -- ver Confirmaciones/Brechas arriba.")
        $contenidoExpediente = ($lineasExpediente -join "`n") + "`n"

        $rutaExpedienteCompleta = Join-Path -Path $rutaActual -ChildPath $RutaExpedienteRelativa
        $directorioExpediente = Split-Path -Path $rutaExpedienteCompleta -Parent
        if (-not (Test-Path -LiteralPath $directorioExpediente)) {
            New-Item -ItemType Directory -Path $directorioExpediente -Force | Out-Null
        }

        # Escritura atomica (correccion v6 #4): el expediente real anterior
        # (si existe, de una corrida previa) solo se sobrescribe DESPUES de
        # que la auditoria completa termino (todo lo de arriba ya se
        # calculo) Y despues de que el contenido nuevo se escribio por
        # completo en un archivo temporal aparte. Move-Item sobre el mismo
        # volumen es una operacion de renombrado atomica a nivel de
        # sistema de archivos -- si algo fallara antes de este punto, o si
        # el renombrado mismo fallara, el expediente real anterior queda
        # intacto, nunca parcialmente sobreescrito.
        $rutaExpedienteTemporal = $rutaExpedienteCompleta + ".tmp-" + [Guid]::NewGuid().ToString("N")
        $RutasTemporales.Add($rutaExpedienteTemporal)
        [System.IO.File]::WriteAllText($rutaExpedienteTemporal, $contenidoExpediente, $codificacionUtf8SinBom)
        Move-Item -LiteralPath $rutaExpedienteTemporal -Destination $rutaExpedienteCompleta -Force

        Write-Host ""
        Write-Host "Expediente de cierre escrito en: $RutaExpedienteRelativa" -ForegroundColor Green
        Write-Host "Confirmaciones: $($confirmaciones.Count) -- Brechas: $($brechas.Count)" -ForegroundColor $(if ($brechas.Count -eq 0) { "Green" } else { "Red" })
        foreach ($b in $brechas) { Write-Host "  BRECHA: $b" -ForegroundColor Red }
    }
    catch {
        $huboAbortoPrevio = $true
        $motivoAbortoPrevio = $_.Exception.Message
        Write-Host ""
        Write-Host "ABORTADO -- $motivoAbortoPrevio" -ForegroundColor Red
    }
}
finally {
    Restaurar-VariablesOriginales -FallosAcumulados $fallosLimpieza

    foreach ($ruta in $RutasTemporales) {
        if (-not $ruta) { continue }
        if (Test-Path -LiteralPath $ruta) {
            try {
                Remove-Item -LiteralPath $ruta -Force -ErrorAction Stop
            } catch {
                $fallosLimpieza.Add("No se pudo eliminar el archivo temporal '$ruta': $($_.Exception.Message)")
            }
            if (Test-Path -LiteralPath $ruta) {
                $fallosLimpieza.Add("El archivo temporal '$ruta' SIGUE existiendo despues del intento de eliminacion.")
            }
        }
    }

    Remove-Item Env:\__RF19RF20_HOST_ESPERADO__ -ErrorAction SilentlyContinue
    Remove-Variable urlPlano -ErrorAction SilentlyContinue
    Remove-Variable urlSegura -ErrorAction SilentlyContinue
}

if ($huboAbortoPrevio) {
    $resultadoFinal = "FALLO"
}
elseif ($fallosLimpieza.Count -gt 0) {
    $resultadoFinal = "FALLO"
}
elseif ($verificacionOk) {
    $resultadoFinal = "TODO_OK"
}
else {
    $resultadoFinal = "FALLO"
}

if ($fallosLimpieza.Count -gt 0) {
    Write-Host ""
    Write-Host "FALLAS DE RESTAURACION/LIMPIEZA DETECTADAS (fuerzan FALLO aunque la verificacion de contenido haya pasado):" -ForegroundColor Red
    foreach ($f in $fallosLimpieza) { Write-Host "  - $f" -ForegroundColor Red }
}

Write-Host ""
Write-Host "RF19_RF20_CIERRE_RESULTADO=$resultadoFinal"

if ($resultadoFinal -ne "TODO_OK") {
    exit 1
}
exit 0
