<#
Prueba REAL y aislada (nunca simulada a mano) de la correccion de firma
en 'rf24-post-deploy-verificacion-solo-lectura-v1.ps1' -- ver DEFECTO en
la cabecera de ese archivo (sentinel 80 real, observado por Alex contra
produccion: 'pg_get_function_identity_arguments' devolvio nombre+tipo en
vez de solo tipo).

Parsea el archivo objetivo via AST REAL
('[System.Management.Automation.Language.Parser]::ParseFile', el mismo
parser que usa PowerShell para ejecutar el archivo -- nunca una
busqueda de texto a ciegas) y confirma, sobre el ARBOL DE SINTAXIS
real, nunca sobre una copia reescrita a mano:

  1. El archivo objetivo parsea con CERO errores de sintaxis.
  2. Contiene exactamente 3 bloques here-string de una sola comilla
     embebidos ('@'...'@') -- los 3 validadores de Node (destino,
     verificacion principal, residuos).
  3. Al menos uno de esos 3 bloques (la consulta REAL que Postgres
     ejecuta) contiene literalmente 'oidvectortypes(p.proargtypes) AS
     firma' -- la correccion presente en el SQL real, no solo
     mencionada en un comentario.
  4. NINGUNO de los 3 bloques contiene 'pg_get_function_identity_
     arguments' -- la funcion antigua, causante del defecto real, debe
     estar completamente ausente de toda consulta REAL enviada a
     Postgres (puede, a proposito, seguir apareciendo en la CABECERA de
     comentarios del archivo objetivo, que la cita para explicar el
     defecto corregido -- esta prueba solo mira el SQL real, extraido
     via AST, nunca los comentarios).

Uso:
  pwsh -File rf24-prueba-firma-oidvectortypes-v1.ps1 `
       -RutaVerificacion <ruta a rf24-post-deploy-verificacion-solo-lectura-v1.ps1>

Esta prueba NUNCA se conecta a ninguna base de datos, nunca ejecuta
ningun validador embebido -- solo parsea el ARCHIVO como TEXTO/AST.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$RutaVerificacion
)

$ErrorActionPreference = 'Stop'
$fallos = [System.Collections.Generic.List[string]]::new()

if (-not (Test-Path $RutaVerificacion)) {
    Write-Host "FALLO: no se encontro el archivo objetivo en '$RutaVerificacion'."
    Write-Host "RF24_PRUEBA_FIRMA_OIDVECTORTYPES_RESULTADO=FALLOS(archivo no encontrado)"
    exit 1
}

# -------- (1) Parseo AST real, 0 errores --------
$erroresParseo = $null
$tokensParseo = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($RutaVerificacion, [ref]$tokensParseo, [ref]$erroresParseo)
if ($erroresParseo -and @($erroresParseo).Count -gt 0) {
    $detalleErrores = ($erroresParseo | ForEach-Object { $_.Message }) -join ' | '
    $fallos.Add("El archivo objetivo NO parsea con 0 errores de sintaxis: $detalleErrores")
} else {
    Write-Host "OK (1/4): '$RutaVerificacion' parsea con 0 errores de sintaxis (AST real)."
}

# -------- (2) Exactamente 3 bloques here-string embebidos --------
$tipoHereString = [System.Management.Automation.Language.StringConstantType]::SingleQuotedHereString
$hereStrings = @($ast.FindAll({
    param($nodo)
    $nodo -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
    $nodo.StringConstantType -eq $tipoHereString
}, $true))

if ($hereStrings.Count -ne 3) {
    $fallos.Add("Se esperaban exactamente 3 bloques here-string embebidos (destino / verificacion principal / residuos); se encontraron $($hereStrings.Count).")
} else {
    Write-Host "OK (2/4): se encontraron exactamente 3 bloques here-string embebidos (los 3 validadores de Node)."
}

# -------- (3) y (4): contenido REAL de cada bloque, via AST --------
$algunoConOidvectortypes = $false
$algunoConFuncionVieja = $false
foreach ($hs in $hereStrings) {
    $textoReal = $hs.Value
    if ($textoReal.Contains('oidvectortypes(p.proargtypes) AS firma')) { $algunoConOidvectortypes = $true }
    if ($textoReal.Contains('pg_get_function_identity_arguments')) { $algunoConFuncionVieja = $true }
}

if (-not $algunoConOidvectortypes) {
    $fallos.Add("Ningun bloque here-string embebido (SQL real) contiene 'oidvectortypes(p.proargtypes) AS firma' -- la correccion NO esta presente en la consulta real.")
} else {
    Write-Host "OK (3/4): al menos un bloque here-string embebido contiene, literalmente, 'oidvectortypes(p.proargtypes) AS firma' -- la correccion esta presente en el SQL real."
}

if ($algunoConFuncionVieja) {
    $fallos.Add("Al menos un bloque here-string embebido (SQL real enviado a Postgres) todavia contiene 'pg_get_function_identity_arguments' -- regresion del defecto ya corregido.")
} else {
    Write-Host "OK (4/4): 'pg_get_function_identity_arguments' esta AUSENTE de los 3 bloques here-string (SQL real) -- solo aparece, a proposito, en los comentarios del archivo objetivo que explican el defecto corregido."
}

if ($fallos.Count -eq 0) {
    Write-Host "RF24_PRUEBA_FIRMA_OIDVECTORTYPES_RESULTADO=TODO_OK"
    exit 0
} else {
    foreach ($f in $fallos) { Write-Host "FALLO: $f" }
    Write-Host "RF24_PRUEBA_FIRMA_OIDVECTORTYPES_RESULTADO=FALLOS($($fallos.Count))"
    exit 1
}
