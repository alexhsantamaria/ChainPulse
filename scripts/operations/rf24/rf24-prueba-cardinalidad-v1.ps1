<#
Prueba REAL y aislada (nunca simulada a mano) de
'Validar-ResultadoVerificacionPrincipal' -- la funcion que procesa el
resultado de la verificacion principal de
'rf24-post-deploy-verificacion-solo-lectura-v3.ps1' -- ver DEFECTO en la
cabecera de ese archivo (sentinel 99 real, observado por Alex ejecutando
v2 EN PRODUCCION: "No se encuentra la propiedad 'Count' en este objeto.",
al entrar en la validacion de las 12 funciones).

CAUSA REAL (ver cabecera del .ps1 objetivo): en Windows PowerShell 5.1,
'ConvertFrom-Json' NO envuelve en un array un resultado JSON de
EXACTAMENTE 1 elemento -- entrega el objeto suelto, sin '.Count'. Bajo
'Set-StrictMode -Version Latest' (activo desde la primera version de ese
archivo), leer '.Count' sobre ese objeto suelto lanza una excepcion real.

ESTA PRUEBA:
  1. Extrae, via AST REAL ('[System.Management.Automation.Language.
     Parser]::ParseFile', nunca una copia a mano), el texto EXACTO
     ('.Extent.Text') de las funciones 'Validar-ResultadoVerificacion
     Principal', 'Fail', 'Exito', 'Registrar' y 'Comparar-ConjuntoExacto',
     y de las 3 asignaciones de constante '$RolAdministrativoEsperado'/
     '$ConfigEsperadoFunciones'/'$MigracionesRf24EnOrden', y las evalua
     en un UNICO scriptblock dinamico, en el ambito de esta prueba.
     DELIBERADAMENTE NUNCA ejecuta el cuerpo principal del archivo
     objetivo (su bloque 'try/catch/finally', su compuerta '-Autorizar
     Lectura', ni su 'exit $script:CodigoSalidaFinal' final) -- un
     simple "dot-sourcing" del archivo COMPLETO terminaria todo el
     PROCESO de esta prueba en ese 'exit' final (incluso deteniendose
     antes en la compuerta de lectura, el archivo objetivo sigue
     llegando a su 'finally' y a su 'exit' de cierre), sin llegar nunca
     a ejecutar ninguna prueba de cardinalidad -- por eso esta prueba
     extrae SOLO lo que necesita, nunca el archivo completo. Esta prueba
     nunca invoca 'Read-Host', nunca define 'DATABASE_URL_ADMIN_PROD',
     nunca se conecta a Neon ni a ninguna otra base de datos.
  2. Extrae, del propio archivo objetivo (via regex sobre su texto
     crudo, NUNCA fabricado ni copiado a mano), las 12 funciones
     ('funcionesEsperadas') y los 5 enums ('enumsEsperados') reales que
     ese archivo espera -- para que los payloads sinteticos de esta
     prueba coincidan exactamente con la expectativa real, sin
     duplicarla de memoria.
  3. Construye payloads SINTETICOS de '$Verif' (nunca contra una base de
     datos real) para cardinalidad SANA (0/N exactos, incluida la
     cardinalidad 1 REAL que ya existe en produccion: cada funcion con
     ejecucion concedida tiene EXACTAMENTE 1 fila de ACL) y para
     cardinalidad 0/1/N DELIBERADAMENTE INCORRECTA en cada coleccion de
     riesgo identificada en esta ronda. Cada payload se serializa a JSON
     real y se vuelve a leer con 'ConvertFrom-Json' (NUNCA se construye
     el objeto '$Verif' a mano) -- para reproducir el mismo
     comportamiento real de colapso de PowerShell 5.1 que causo el
     defecto de esta ronda, nunca una aproximacion.
  4. Llama DIRECTAMENTE a 'Validar-ResultadoVerificacionPrincipal' con
     cada payload, bajo 'Set-StrictMode -Version Latest', y confirma:
       - El caso SANO completo (las 12 funciones, cardinalidad 1 real de
         ACL por funcion incluida) NO lanza ninguna excepcion.
       - La variante con un enum recortado a cardinalidad 1 en ambos
         lados (esperado Y real) tampoco lanza ninguna excepcion.
       - Cada caso DELIBERADAMENTE incorrecto (cardinalidad 0, 1 o N en
         cada coleccion de riesgo) es rechazado por el sentinel
         'RF24_RO_FAIL:N' EXACTO esperado -- NUNCA por una excepcion de
         miembro no encontrado ('PropertyNotFoundException' o
         equivalente), que es, precisamente, la clase de defecto real de
         esta ronda.

Uso:
  pwsh -File rf24-prueba-cardinalidad-v1.ps1 `
       -RutaVerificacion <ruta a rf24-post-deploy-verificacion-solo-lectura-v3.ps1>

Sin efectos secundarios en disco relacionados con el archivo objetivo:
como nunca se ejecuta su cuerpo principal (solo se extraen y evaluan 5
definiciones de funcion y 3 asignaciones de constante), tampoco crea
ningun directorio de trabajo real -- '$script:DirTrabajo' se fija aqui a
una ruta deliberadamente INEXISTENTE, solo para que 'Registrar' (una de
las funciones extraidas) no intente escribir en un archivo de log real.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RutaVerificacion
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$fallos = [System.Collections.Generic.List[string]]::new()
$pruebasEjecutadas = 0

function Registrar-Prueba {
    param([string]$Mensaje)
    $script:pruebasEjecutadas++
    Write-Host "OK ($script:pruebasEjecutadas): $Mensaje"
}

if (-not (Test-Path $RutaVerificacion)) {
    Write-Host "FALLO: no se encontro el archivo objetivo en '$RutaVerificacion'."
    Write-Host "RF24_PRUEBA_CARDINALIDAD_RESULTADO=FALLOS(archivo no encontrado)"
    exit 1
}

# ----------------------------------------------------------------------
# (0) Extraer, via AST REAL, el texto EXACTO de las 5 funciones
# necesarias y las 3 constantes necesarias, y evaluarlas en un UNICO
# scriptblock dinamico -- SIN ejecutar, en ningun momento, el cuerpo
# principal del archivo objetivo (ver cabecera: su 'exit' final
# terminaria todo el proceso de esta prueba si se dot-sourcera el
# archivo completo).
# ----------------------------------------------------------------------
$erroresParseo = $null
$tokensParseo = $null
$astObjetivo = [System.Management.Automation.Language.Parser]::ParseFile($RutaVerificacion, [ref]$tokensParseo, [ref]$erroresParseo)
if ($erroresParseo -and @($erroresParseo).Count -gt 0) {
    Write-Host "FALLO: el archivo objetivo no parsea con 0 errores de sintaxis: $(($erroresParseo | ForEach-Object { $_.Message }) -join ' | ')"
    Write-Host "RF24_PRUEBA_CARDINALIDAD_RESULTADO=FALLOS(parseo)"
    exit 1
}

$nombresFuncionesNecesarias = @('Registrar', 'Fail', 'Exito', 'Comparar-ConjuntoExacto', 'Validar-ResultadoVerificacionPrincipal')
$definicionesFuncion = @($astObjetivo.FindAll({
    param($nodo)
    $nodo -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $nombresFuncionesNecesarias -contains $nodo.Name
}, $true))
if ($definicionesFuncion.Count -ne $nombresFuncionesNecesarias.Count) {
    $encontradas = @($definicionesFuncion | ForEach-Object { $_.Name })
    Write-Host "FALLO: se esperaban $($nombresFuncionesNecesarias.Count) funciones ($($nombresFuncionesNecesarias -join ', ')) en el archivo objetivo; se encontraron $($definicionesFuncion.Count) ($($encontradas -join ', ')). Revisar que el archivo objetivo sea v3 (o posterior)."
    Write-Host "RF24_PRUEBA_CARDINALIDAD_RESULTADO=FALLOS(extraccion)"
    exit 1
}

$nombresConstantesNecesarias = @('RolAdministrativoEsperado', 'ConfigEsperadoFunciones', 'MigracionesRf24EnOrden')
$asignacionesConstante = @($astObjetivo.FindAll({
    param($nodo)
    $nodo -is [System.Management.Automation.Language.AssignmentStatementAst] -and
    $nodo.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
    $nombresConstantesNecesarias -contains $nodo.Left.VariablePath.UserPath
}, $true))
if ($asignacionesConstante.Count -ne $nombresConstantesNecesarias.Count) {
    $encontradas = @($asignacionesConstante | ForEach-Object { $_.Left.VariablePath.UserPath })
    Write-Host "FALLO: se esperaban $($nombresConstantesNecesarias.Count) constantes ($($nombresConstantesNecesarias -join ', ')) en el archivo objetivo; se encontraron $($asignacionesConstante.Count) ($($encontradas -join ', '))."
    Write-Host "RF24_PRUEBA_CARDINALIDAD_RESULTADO=FALLOS(extraccion)"
    exit 1
}

# '$script:DirTrabajo' se fija a una ruta deliberadamente INEXISTENTE --
# 'Registrar' (extraida mas abajo) solo escribe a un archivo de log real
# si 'Test-Path $script:DirTrabajo' es verdadero; al ser inexistente,
# nunca lo es, y 'Registrar'/'Fail'/'Exito' quedan completamente
# operativas (bajo 'Set-StrictMode -Version Latest') sin necesitar
# ningun otro estado del archivo objetivo.
$script:DirTrabajo = Join-Path $env:TEMP 'rf24-prueba-cardinalidad-dummy-inexistente'

# Texto EXACTO ('.Extent.Text', nunca retecleado a mano) de cada
# asignacion de constante y cada funcion, concatenado y evaluado como UN
# UNICO scriptblock dinamico en este ambito.
$textoAEvaluar = (@($asignacionesConstante | ForEach-Object { $_.Extent.Text }) + @($definicionesFuncion | ForEach-Object { $_.Extent.Text })) -join "`n`n"
$bloqueExtraido = [scriptblock]::Create($textoAEvaluar)
. $bloqueExtraido

if (-not (Get-Command -Name Validar-ResultadoVerificacionPrincipal -ErrorAction SilentlyContinue)) {
    Write-Host "FALLO: tras evaluar el scriptblock extraido via AST, 'Validar-ResultadoVerificacionPrincipal' no quedo definida."
    Write-Host "RF24_PRUEBA_CARDINALIDAD_RESULTADO=FALLOS(definicion)"
    exit 1
}
Registrar-Prueba "'Validar-ResultadoVerificacionPrincipal' + 4 funciones auxiliares + 3 constantes reales, extraidas via AST REAL del archivo objetivo (texto exacto, '.Extent.Text') y evaluadas en un scriptblock aislado -- SIN ejecutar en ningun momento su cuerpo principal ni su 'exit' final."

# ----------------------------------------------------------------------
# (1) Extraer, del propio archivo objetivo, 'funcionesEsperadas' y
# 'enumsEsperados' REALES -- via regex sobre su texto crudo (viven
# dentro de texto JS embebido en un here-string, no como AST de
# PowerShell independiente) -- nunca fabricados ni copiados de memoria.
# ----------------------------------------------------------------------
$textoObjetivo = Get-Content -Raw -Path $RutaVerificacion

$matchFunciones = [regex]::Match($textoObjetivo, '(?s)const funcionesEsperadas = \{(.*?)\r?\n\};')
if (-not $matchFunciones.Success) {
    Write-Host "FALLO: no se pudo extraer 'funcionesEsperadas' del archivo objetivo via regex."
    Write-Host "RF24_PRUEBA_CARDINALIDAD_RESULTADO=FALLOS(extraccion)"
    exit 1
}
$funcionesExtraidas = [System.Collections.Generic.List[object]]::new()
foreach ($mf in [regex]::Matches($matchFunciones.Groups[1].Value, '(\w+):\s*\{\s*firma:\s*"([^"]*)",\s*securityDefiner:\s*(true|false),\s*concedeEjecucionChainpulse:\s*(true|false)\s*\}')) {
    $funcionesExtraidas.Add([PSCustomObject]@{
        nombre                     = $mf.Groups[1].Value
        firma                      = $mf.Groups[2].Value
        securityDefiner            = [bool]::Parse($mf.Groups[3].Value)
        concedeEjecucionChainpulse = [bool]::Parse($mf.Groups[4].Value)
    })
}
if ($funcionesExtraidas.Count -ne 12) {
    Write-Host "FALLO: se esperaban 12 funciones extraidas de 'funcionesEsperadas'; se encontraron $($funcionesExtraidas.Count)."
    Write-Host "RF24_PRUEBA_CARDINALIDAD_RESULTADO=FALLOS(extraccion)"
    exit 1
}

$matchEnums = [regex]::Match($textoObjetivo, '(?s)const enumsEsperados = \{(.*?)\r?\n\};')
if (-not $matchEnums.Success) {
    Write-Host "FALLO: no se pudo extraer 'enumsEsperados' del archivo objetivo via regex."
    Write-Host "RF24_PRUEBA_CARDINALIDAD_RESULTADO=FALLOS(extraccion)"
    exit 1
}
$enumsExtraidos = [ordered]@{}
foreach ($me in [regex]::Matches($matchEnums.Groups[1].Value, '(\w+):\s*\[([^\]]*)\]')) {
    $valores = @([regex]::Matches($me.Groups[2].Value, '"([^"]*)"') | ForEach-Object { $_.Groups[1].Value })
    $enumsExtraidos[$me.Groups[1].Value] = $valores
}
if ($enumsExtraidos.Count -ne 5) {
    Write-Host "FALLO: se esperaban 5 enums extraidos de 'enumsEsperados'; se encontraron $($enumsExtraidos.Count)."
    Write-Host "RF24_PRUEBA_CARDINALIDAD_RESULTADO=FALLOS(extraccion)"
    exit 1
}

Registrar-Prueba "12 funciones y 5 enums extraidos REALMENTE del archivo objetivo via regex (nunca fabricados a mano)."

# ----------------------------------------------------------------------
# (2) Construir el payload SANO base (cardinalidad N para casi todo;
# cardinalidad 0 para las colecciones de "hallazgos" -- todas vacias en
# el caso sano; cardinalidad 1 REAL para el ACL de cada funcion con
# ejecucion concedida, exactamente como en produccion). Se construye
# como un objeto PowerShell normal y SOLO AL FINAL se serializa a JSON y
# se vuelve a leer con 'ConvertFrom-Json' -- nunca se usa directamente
# como '$Verif' (eso seria una aproximacion, no una prueba real del
# colapso de PowerShell 5.1).
# ----------------------------------------------------------------------
function Nuevo-PayloadSano {
    $oidBase = 90000
    $funcionesTodosEsquemas = [System.Collections.Generic.List[object]]::new()
    $aclPorFuncion = [System.Collections.Generic.List[object]]::new()
    $i = 0
    foreach ($f in $funcionesExtraidas) {
        $i++
        $oid = $oidBase + $i
        $funcionesTodosEsquemas.Add([ordered]@{
            oid              = $oid
            proname          = $f.nombre
            esquema          = 'public'
            propietario      = $RolAdministrativoEsperado
            security_definer = $f.securityDefiner
            config           = @($ConfigEsperadoFunciones)
            firma            = $f.firma
        })
        if ($f.concedeEjecucionChainpulse) {
            # Cardinalidad 1 REAL por funcion -- exactamente el caso que
            # colapsaba antes de la correccion si se hubiera leido via
            # '.Count' sin envolver (aqui se ejercita el camino completo:
            # agrupacion + 'Where-Object' + '.Count').
            $aclPorFuncion.Add([ordered]@{ oid = $oid; proname = $f.nombre; grantee = 'chainpulse_app'; privilegio = 'EXECUTE' })
        }
    }

    $enumsReales = [ordered]@{}
    foreach ($nombreEnum in $enumsExtraidos.Keys) { $enumsReales[$nombreEnum] = @($enumsExtraidos[$nombreEnum]) }

    $funcionesEsperadasHash = [ordered]@{}
    foreach ($f in $funcionesExtraidas) {
        $funcionesEsperadasHash[$f.nombre] = [ordered]@{ firma = $f.firma; securityDefiner = $f.securityDefiner; concedeEjecucionChainpulse = $f.concedeEjecucionChainpulse }
    }

    [ordered]@{
        ok                          = $true
        migracionesReales           = @($MigracionesRf24EnOrden | ForEach-Object {
            [ordered]@{ migration_name = $_; checksum = 'abc123'; started_at = '2026-10-22T08:00:00Z'; finished_at = '2026-10-22T08:00:01Z'; rolled_back_at = $null; applied_steps_count = 1; logs = $null }
        })
        enumsEsperados              = $enumsExtraidos
        enumsReales                 = $enumsReales
        tablasPresentes             = @('solicitudes_derechos', 'intentos_solicitud_derechos_descartados')
        privilegiosDirectosIndebidos = @()
        primaryKeys                 = @(
            [ordered]@{ tabla = 'solicitudes_derechos'; conname = 'solicitudes_derechos_pkey' },
            [ordered]@{ tabla = 'intentos_solicitud_derechos_descartados'; conname = 'intentos_solicitud_derechos_descartados_pkey' }
        )
        checkConstraints            = @(@(
            'alcance_retiro_coherente', 'token_hash_formato', 'resuelto_canal_administrador_coherente',
            'token_hash_version_pareja', 'envio_confirmado_requiere_token', 'reclamo_lease_pareja',
            'intentos_envio_no_negativo', 'token_key_version_positivo'
        ) | ForEach-Object { [ordered]@{ conname = $_ } })
        foreignKeys                 = @(
            [ordered]@{ conname = 'solicitudes_derechos_evaluacionExpresV2Id_fkey'; definicion = 'FOREIGN KEY (...) REFERENCES evaluaciones_expres_v2(id) ON DELETE RESTRICT ON UPDATE CASCADE' },
            [ordered]@{ conname = 'solicitudes_derechos_resueltoPorUsuarioId_fkey'; definicion = 'FOREIGN KEY (...) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE CASCADE' }
        )
        indices                     = @(@(
            'solicitudes_derechos_pkey', 'solicitudes_derechos_tokenHash_key',
            'solicitudes_derechos_evaluacionExpresV2Id_createdAt_idx', 'solicitudes_derechos_estado_expiraEn_idx',
            'solicitudes_derechos_estado_envioConfirmadoEn_idx', 'solicitudes_derechos_resueltoPorUsuarioId_idx',
            'intentos_solicitud_derechos_descartados_pkey'
        ) | ForEach-Object { [ordered]@{ indexname = $_ } })
        patronCorregidoPresente     = $true
        patronViejoAusente          = $true
        funcionesFueraDePublic      = @()
        duplicados                  = @()
        funcionesTodosEsquemas      = $funcionesTodosEsquemas
        aclPorFuncion               = $aclPorFuncion
        funcionesEsperadas          = $funcionesEsperadasHash
        rls                         = @(
            [ordered]@{ relname = 'solicitudes_derechos'; relrowsecurity = $false },
            [ordered]@{ relname = 'intentos_solicitud_derechos_descartados'; relrowsecurity = $false }
        )
        politicasRls                = @()
    }
}

function Convertir-APayloadReal {
    param([Parameter(Mandatory)]$PayloadPlano)
    # Serializa a JSON REAL y vuelve a leer con 'ConvertFrom-Json' --
    # nunca se usa el objeto PowerShell original directamente: solo asi
    # se reproduce el mismo comportamiento real de colapso (cardinalidad
    # 1 -> objeto suelto) que causo el defecto de esta ronda.
    $json = $PayloadPlano | ConvertTo-Json -Depth 12 -Compress
    return $json | ConvertFrom-Json
}

function Probar-Caso {
    param(
        [Parameter(Mandatory)][string]$Nombre,
        [Parameter(Mandatory)]$PayloadPlano,
        [int]$SentinelEsperado = 0  # 0 = se espera que NO falle
    )
    $verifReal = Convertir-APayloadReal -PayloadPlano $PayloadPlano
    $excepcion = $null
    try {
        Validar-ResultadoVerificacionPrincipal -Verif $verifReal
    } catch {
        $excepcion = $_
    }

    if ($SentinelEsperado -eq 0) {
        if ($excepcion) {
            $script:fallos.Add("[$Nombre] se esperaba EXITO (sin excepcion), pero se lanzo: $($excepcion.Exception.Message)")
        } else {
            Registrar-Prueba "$Nombre -- sin excepcion, como se esperaba."
        }
        return
    }

    if (-not $excepcion) {
        $script:fallos.Add("[$Nombre] se esperaba 'RF24_RO_FAIL:$SentinelEsperado', pero NO se lanzo ninguna excepcion.")
        return
    }
    $patronEsperado = "^RF24_RO_FAIL:$SentinelEsperado`$"
    if ($excepcion.Exception.Message -match $patronEsperado) {
        Registrar-Prueba "$Nombre -- rechazado correctamente por 'RF24_RO_FAIL:$SentinelEsperado' (nunca una excepcion de miembro no encontrado)."
    } else {
        $script:fallos.Add("[$Nombre] se esperaba 'RF24_RO_FAIL:$SentinelEsperado'; se obtuvo en su lugar: '$($excepcion.Exception.Message)' (tipo: $($excepcion.Exception.GetType().FullName)). Si el mensaje menciona 'Count' o 'property'/'propiedad', es una REGRESION del defecto real de esta ronda.")
    }
}

# ----------------------------------------------------------------------
# CASO 1 -- SANO completo (cardinalidad N casi en todo, cardinalidad 1
# real en el ACL por funcion). Debe pasar SIN NINGUNA excepcion.
# ----------------------------------------------------------------------
Probar-Caso -Nombre "Caso sano completo (12 funciones, ACL cardinalidad 1 por funcion, resto en 0/N)" -PayloadPlano (Nuevo-PayloadSano) -SentinelEsperado 0

# ----------------------------------------------------------------------
# CASO 2 -- enum recortado a cardinalidad 1 en AMBOS lados (esperado Y
# real), coincidentes -- variante especifica del fix en '$esperado =
# @(...)'. Debe seguir pasando sin excepcion.
# ----------------------------------------------------------------------
$payloadEnumUno = Nuevo-PayloadSano
$primerEnum = @($enumsExtraidos.Keys)[0]
$payloadEnumUno.enumsEsperados = [ordered]@{}
$payloadEnumUno.enumsReales = [ordered]@{}
foreach ($k in $enumsExtraidos.Keys) {
    if ($k -eq $primerEnum) {
        $unoSoloValor = @($enumsExtraidos[$k])[0]
        $payloadEnumUno.enumsEsperados[$k] = @($unoSoloValor)
        $payloadEnumUno.enumsReales[$k] = @($unoSoloValor)
    } else {
        $payloadEnumUno.enumsEsperados[$k] = @($enumsExtraidos[$k])
        $payloadEnumUno.enumsReales[$k] = @($enumsExtraidos[$k])
    }
}
Probar-Caso -Nombre "Enum '$primerEnum' recortado a cardinalidad 1 en esperado Y real, coincidentes" -PayloadPlano $payloadEnumUno -SentinelEsperado 0

# ----------------------------------------------------------------------
# CASO 3 -- 'tablasPresentes' con cardinalidad 0 (en vez de 2). Debe
# rechazarse con el sentinel 25, nunca con una excepcion de miembro.
# ----------------------------------------------------------------------
$payloadTablasVacias = Nuevo-PayloadSano
$payloadTablasVacias.tablasPresentes = @()
Probar-Caso -Nombre "'tablasPresentes' con cardinalidad 0 (esperado: 2)" -PayloadPlano $payloadTablasVacias -SentinelEsperado 25

# ----------------------------------------------------------------------
# CASO 4 -- 'privilegiosDirectosIndebidos' con cardinalidad 1 (el caso
# real que mas probablemente dispararia este sentinel en produccion si
# alguna vez aparece un privilegio directo indebido). Sentinel 26.
# ----------------------------------------------------------------------
$payloadPrivUno = Nuevo-PayloadSano
$payloadPrivUno.privilegiosDirectosIndebidos = @([ordered]@{ table_name = 'solicitudes_derechos'; grantee = 'PUBLIC'; privilege_type = 'SELECT' })
Probar-Caso -Nombre "'privilegiosDirectosIndebidos' con cardinalidad 1" -PayloadPlano $payloadPrivUno -SentinelEsperado 26

# ----------------------------------------------------------------------
# CASO 5 -- 'privilegiosDirectosIndebidos' con cardinalidad 2 (N>=2, para
# confirmar que el fix tambien sostiene el caso ya-funcionaba-antes).
# Sentinel 26.
# ----------------------------------------------------------------------
$payloadPrivDos = Nuevo-PayloadSano
$payloadPrivDos.privilegiosDirectosIndebidos = @(
    [ordered]@{ table_name = 'solicitudes_derechos'; grantee = 'PUBLIC'; privilege_type = 'SELECT' },
    [ordered]@{ table_name = 'intentos_solicitud_derechos_descartados'; grantee = 'chainpulse_app'; privilege_type = 'INSERT' }
)
Probar-Caso -Nombre "'privilegiosDirectosIndebidos' con cardinalidad 2" -PayloadPlano $payloadPrivDos -SentinelEsperado 26

# ----------------------------------------------------------------------
# CASO 6 -- EXACTAMENTE 1 funcion fuera de 'public' -- este es el punto
# concreto donde fallo la ejecucion real de Alex contra v2 (sentinel 33).
# ----------------------------------------------------------------------
$payloadFueraPublic = Nuevo-PayloadSano
$payloadFueraPublic.funcionesFueraDePublic = @([ordered]@{ oid = 99999; proname = $funcionesExtraidas[0].nombre; esquema = 'otro_esquema' })
Probar-Caso -Nombre "'funcionesFueraDePublic' con cardinalidad 1 (el punto real que fallo en produccion)" -PayloadPlano $payloadFueraPublic -SentinelEsperado 33

# ----------------------------------------------------------------------
# CASO 7 -- EXACTAMENTE 1 funcion duplicada. Sentinel 34.
# ----------------------------------------------------------------------
$payloadDuplicado = Nuevo-PayloadSano
$payloadDuplicado.duplicados = @([ordered]@{ nombre = $funcionesExtraidas[0].nombre; n = 2 })
Probar-Caso -Nombre "'duplicados' con cardinalidad 1" -PayloadPlano $payloadDuplicado -SentinelEsperado 34

# ----------------------------------------------------------------------
# CASO 8 -- EXACTAMENTE 1 grantee no autorizado en el ACL de una funcion
# (ademas de su fila legitima de 'chainpulse_app') -- ejercita
# '$concesionesIndebidas' con cardinalidad 1. Sentinel 40.
# ----------------------------------------------------------------------
$payloadAclIndebido = Nuevo-PayloadSano
$primeraConEjecucion = $funcionesExtraidas | Where-Object { $_.concedeEjecucionChainpulse } | Select-Object -First 1
$oidPrimeraConEjecucion = ($payloadAclIndebido.funcionesTodosEsquemas | Where-Object { $_.proname -eq $primeraConEjecucion.nombre }).oid
$payloadAclIndebido.aclPorFuncion = @($payloadAclIndebido.aclPorFuncion) + [ordered]@{ oid = $oidPrimeraConEjecucion; proname = $primeraConEjecucion.nombre; grantee = 'rol_no_autorizado'; privilegio = 'EXECUTE' }
Probar-Caso -Nombre "ACL con 1 grantee no autorizado en '$($primeraConEjecucion.nombre)' (cardinalidad 1 en 'concesionesIndebidas')" -PayloadPlano $payloadAclIndebido -SentinelEsperado 40

# ----------------------------------------------------------------------
# CASO 9 -- 'rls' con cardinalidad 1 (en vez de 2). Sentinel 43.
# ----------------------------------------------------------------------
$payloadRlsUno = Nuevo-PayloadSano
$payloadRlsUno.rls = @([ordered]@{ relname = 'solicitudes_derechos'; relrowsecurity = $false })
Probar-Caso -Nombre "'rls' con cardinalidad 1 (esperado: 2)" -PayloadPlano $payloadRlsUno -SentinelEsperado 43

# ----------------------------------------------------------------------
# CASO 10 -- EXACTAMENTE 1 politica RLS. Sentinel 45.
# ----------------------------------------------------------------------
$payloadPoliticaUna = Nuevo-PayloadSano
$payloadPoliticaUna.politicasRls = @([ordered]@{ tablename = 'solicitudes_derechos'; policyname = 'politica_inesperada' })
Probar-Caso -Nombre "'politicasRls' con cardinalidad 1" -PayloadPlano $payloadPoliticaUna -SentinelEsperado 45

Write-Host ""
if ($fallos.Count -eq 0) {
    Write-Host "RF24_PRUEBA_CARDINALIDAD_RESULTADO=TODO_OK ($pruebasEjecutadas pruebas)"
    exit 0
} else {
    foreach ($f in $fallos) { Write-Host "FALLO: $f" }
    Write-Host "RF24_PRUEBA_CARDINALIDAD_RESULTADO=FALLOS($($fallos.Count) de $pruebasEjecutadas pruebas)"
    exit 1
}
