<#
Pruebas A, B, C, D1 y D2 de la migracion `rf19_rf20_revoke_create_public`
(docs/architecture/rf19-rf20/adenda-diseno-rf19-rf20-v7.md, SS3.1/SS3.2).

Este script es la transcripcion LITERAL, sin alterar su logica, de los
cinco bloques PowerShell que v7 SS3.2 documenta como la validacion formal
de la migracion 1 del plan de PRs (SS10, PR 2) -- la unica diferencia es
que el literal de ruta `prisma\migrations\<TIMESTAMP>_...\migration.sql`
se parametrizo como $RutaMigracion (resuelta por defecto contra la
migracion real ya creada en este PR), en vez de repetirse hardcodeado en
cada bloque.

ALCANCE DE ESTE PR: unicamente este archivo de codigo. NINGUNA de estas
cinco pruebas se ejecuto contra Neon para producir este PR -- crearlas
como codigo no autoriza ejecutarlas (AGENTS.md: no conectarse a Neon, no
aplicar migraciones, no crear roles sin autorizacion separada y
explicita). Ejecutarlas requiere:
  - El clon nativo de Windows (AGENTS.md), nunca la vista compartida del
    Mac.
  - $env:DATABASE_URL apuntando a Neon con la credencial neondb_owner
    (nunca chainpulse_app -- ver precondicion de SS3.1).
  - `psql` y `prisma` disponibles en PATH.
  - Autorizacion separada y explicita de Alex para la ejecucion real,
    distinta de la autorizacion de crear este archivo.

Cada prueba es una funcion independiente (Invoke-PruebaA .. Invoke-D2),
para poder ejecutarlas selectivamente. El parametro -Prueba del script
decide cual(es) correr; por defecto no ejecuta ninguna (-Prueba Ninguna),
asi que invocar el script sin argumentos nunca toca Neon por accidente.

Uso (una vez autorizado, desde el clon nativo de Windows):
  pwsh -File rf19-rf20-pruebas-revoke-create-public-v1.ps1 -Prueba A
  pwsh -File rf19-rf20-pruebas-revoke-create-public-v1.ps1 -Prueba Todas
#>

[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet('Ninguna', 'A', 'B', 'C', 'D1', 'D2', 'Todas')]
    [string]$Prueba = 'Ninguna',

    [Parameter()]
    [string]$RutaMigracion = (Join-Path $PSScriptRoot '..\..\..\prisma\migrations\20261030090000_rf19_rf20_revoke_create_public\migration.sql')
)

$ErrorActionPreference = 'Stop'

if (-not $env:DATABASE_URL -and $Prueba -ne 'Ninguna') {
    throw "DATABASE_URL no esta definida. Estas pruebas requieren una credencial neondb_owner real (SS3.1) y autorizacion explicita separada antes de ejecutarse -- nunca se ejecutan por defecto."
}

function Invoke-ComandoExterno {
    <#
    .SYNOPSIS
    Ejecuta un comando externo (psql, prisma, etc.), captura su salida y su
    codigo de salida de forma robusta, con independencia de
    $ErrorActionPreference y de si se ejecuta en Windows PowerShell 5.1 o en
    PowerShell 7+.

    .DESCRIPTION
    En Windows PowerShell 5.1 (y en PowerShell 7+ con
    $PSNativeCommandUseErrorActionPreference en $false, su valor
    confirmado por defecto) un comando externo que termina con un codigo
    de salida distinto de cero NO genera un error terminante:
    $ErrorActionPreference = 'Stop' no tiene ningun efecto sobre comandos
    nativos. El codigo de llamada debe comprobar $LASTEXITCODE
    explicitamente despues de cada invocacion, y debe leerlo antes de que
    cualquier otro comando pueda sobrescribirlo.

    Este helper distingue dos clases de fallo:
      - Fallo de arranque (FalloInvocacion = $true): el ejecutable no
        existe o no pudo lanzarse (CommandNotFoundException u otro error
        terminante al invocar). CodigoSalida es $null en este caso --
        $LASTEXITCODE no es significativo porque el proceso nunca
        arranco.
      - Codigo de salida distinto de cero (FalloInvocacion = $false,
        CodigoSalida -ne 0): el proceso arranco y termino, pero reporto
        fallo via su codigo de salida.

    .PARAMETER Ejecutable
    Nombre o ruta del ejecutable a invocar (p. ej. 'psql', 'prisma').

    .PARAMETER Argumentos
    Arreglo de argumentos a pasar al ejecutable, en el mismo orden en que
    se pasarian a una invocacion directa.

    .OUTPUTS
    [pscustomobject] con:
      CodigoSalida    -- [int] o $null si FalloInvocacion es $true.
      Salida          -- [string] stdout+stderr combinados (Out-String).
      FalloInvocacion -- [bool] $true si el ejecutable no pudo arrancar.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Ejecutable,

        [Parameter()]
        [string[]]$Argumentos = @()
    )

    $PreferenciaOriginal = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        try {
            $SalidaCapturada = & $Ejecutable @Argumentos 2>&1 | Out-String
            # $LASTEXITCODE se lee inmediatamente despues de la invocacion
            # nativa; Out-String es un cmdlet y no lo modifica, asi que el
            # pipeline de arriba es seguro.
            $CodigoCapturado = $LASTEXITCODE
            return [pscustomobject]@{
                CodigoSalida    = $CodigoCapturado
                Salida          = $SalidaCapturada
                FalloInvocacion = $false
            }
        } catch {
            return [pscustomobject]@{
                CodigoSalida    = $null
                Salida          = $_.Exception.Message
                FalloInvocacion = $true
            }
        }
    } finally {
        $ErrorActionPreference = $PreferenciaOriginal
    }
}

function Invoke-PruebaA {
    $Resultado = Invoke-ComandoExterno -Ejecutable 'prisma' -Argumentos @('migrate', 'deploy')
    if ($Resultado.FalloInvocacion) {
        throw "Prueba A: no se pudo invocar 'prisma migrate deploy' -- $($Resultado.Salida)"
    }
    if ($Resultado.CodigoSalida -ne 0) {
        throw "Prueba A: se esperaba codigo de salida 0, codigo real: $($Resultado.CodigoSalida). Salida: $($Resultado.Salida)"
    }
}

function Invoke-PruebaB {
    $Resultado = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
        '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-f', $RutaMigracion
    )
    if ($Resultado.FalloInvocacion) {
        throw "Prueba B: no se pudo invocar psql -- $($Resultado.Salida)"
    }
    if ($Resultado.CodigoSalida -ne 0) {
        throw "Prueba B: se esperaba codigo de salida 0 (segunda ejecucion, sobre un estado ya correcto tras la Prueba A), codigo real: $($Resultado.CodigoSalida). Salida: $($Resultado.Salida)"
    }
}

function Invoke-PruebaC {
    $Sufijo = [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $RolPrueba = "_prueba_rf19rf20_$Sufijo"

    if ($RolPrueba -notmatch '^[a-z_][a-z0-9_]{0,62}$') {
        throw "Nombre de rol de prueba invalido: $RolPrueba"
    }

    $ResultadoExiste = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
        '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-t', '-c',
        "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RolPrueba');"
    )
    if ($ResultadoExiste.FalloInvocacion) {
        throw "No se pudo invocar psql para comprobar si el rol de prueba ya existe -- $($ResultadoExiste.Salida)"
    }
    if ($ResultadoExiste.CodigoSalida -ne 0) {
        throw "La comprobacion de existencia del rol de prueba fallo con codigo $($ResultadoExiste.CodigoSalida). Salida: $($ResultadoExiste.Salida)"
    }
    if ($ResultadoExiste.Salida.Trim() -ne 'f') {
        throw "El rol de prueba generado ya existe por catalogo -- regenerar el sufijo: $RolPrueba"
    }

    $FalloOriginal = $null
    try {
        $ResultadoPreparacion = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
            '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-c',
            "CREATE ROLE $RolPrueba; GRANT CREATE ON SCHEMA public TO $RolPrueba;"
        )
        if ($ResultadoPreparacion.FalloInvocacion) {
            throw "No se pudo invocar psql para preparar el rol de prueba -- $($ResultadoPreparacion.Salida)"
        }
        if ($ResultadoPreparacion.CodigoSalida -ne 0) {
            throw "No se pudo preparar el rol de prueba -- codigo $($ResultadoPreparacion.CodigoSalida). Salida: $($ResultadoPreparacion.Salida)"
        }

        $ResultadoMigracion = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
            '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-f', $RutaMigracion
        )
        if ($ResultadoMigracion.FalloInvocacion) {
            throw "No se pudo invocar psql para ejecutar la migracion -- $($ResultadoMigracion.Salida)"
        }
        $Salida = $ResultadoMigracion.Salida
        $Codigo = $ResultadoMigracion.CodigoSalida

        if ($Codigo -eq 0) {
            throw "Se esperaba fallo bloqueante y la ejecucion termino con codigo 0. Salida: $Salida"
        }
        if ($Salida -notmatch [regex]::Escape('RF19RF20_POSTCONDICION_3_ROL_INESPERADO')) {
            throw "Codigo distinto de cero pero la salida no contiene RF19RF20_POSTCONDICION_3_ROL_INESPERADO -- no se puede distinguir el bloqueo esperado de un error no relacionado (sintaxis, conexion, codificacion, archivo faltante). Salida: $Salida"
        }
        if ($Salida -notmatch [regex]::Escape($RolPrueba)) {
            throw "La salida no menciona el nombre exacto del rol de prueba ($RolPrueba) -- no se puede confirmar que el bloqueo correspondiera a este rol. Salida: $Salida"
        }
    } catch {
        $FalloOriginal = $_
    } finally {
        $ResultadoLimpieza = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
            '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-c',
            "REVOKE CREATE ON SCHEMA public FROM $RolPrueba; DROP ROLE $RolPrueba;"
        )
        $HayFalloDeLimpieza = $ResultadoLimpieza.FalloInvocacion -or ($ResultadoLimpieza.CodigoSalida -ne 0)

        if ($HayFalloDeLimpieza) {
            $DetalleLimpieza = if ($ResultadoLimpieza.FalloInvocacion) {
                "no se pudo invocar psql para la limpieza -- $($ResultadoLimpieza.Salida)"
            } else {
                "la limpieza fallo con codigo $($ResultadoLimpieza.CodigoSalida). Salida: $($ResultadoLimpieza.Salida)"
            }

            if ($FalloOriginal) {
                throw "Fallo original de la prueba: $FalloOriginal -- ADEMAS $DetalleLimpieza (rol $RolPrueba puede haber quedado huerfano, revisar manualmente)"
            } else {
                throw "La prueba paso pero $DetalleLimpieza -- rol $RolPrueba puede haber quedado huerfano, revisar manualmente"
            }
        }
    }

    if ($FalloOriginal) {
        throw $FalloOriginal
    }
}

function Invoke-D1 {
    $FalloOriginal = $null
    try {
        # (a) Simular drift: GRANT CREATE a PUBLIC antes de ejecutar la migracion.
        $ResultadoDrift = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
            '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-c',
            'GRANT CREATE ON SCHEMA public TO PUBLIC;'
        )
        if ($ResultadoDrift.FalloInvocacion) {
            throw "D1: no se pudo invocar psql para preparar el escenario de drift -- $($ResultadoDrift.Salida)"
        }
        if ($ResultadoDrift.CodigoSalida -ne 0) {
            throw "D1: no se pudo preparar el escenario de drift (GRANT CREATE a PUBLIC) -- codigo $($ResultadoDrift.CodigoSalida). Salida: $($ResultadoDrift.Salida)"
        }

        # (b) Ejecutar la migracion completa -- debe corregir el drift y terminar en 0.
        #     Si fallara ANTES de su propio REVOKE, PUBLIC quedaria con CREATE --
        #     de ahi que el REVOKE de limpieza del finally se ejecute siempre,
        #     nunca solo cuando este paso tiene exito.
        $ResultadoMigracion = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
            '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-f', $RutaMigracion
        )
        if ($ResultadoMigracion.FalloInvocacion) {
            throw "D1: no se pudo invocar psql para ejecutar la migracion -- $($ResultadoMigracion.Salida)"
        }
        if ($ResultadoMigracion.CodigoSalida -ne 0) {
            throw "D1: se esperaba que la migracion corrigiera el drift y terminara en codigo 0 -- codigo real: $($ResultadoMigracion.CodigoSalida). Salida: $($ResultadoMigracion.Salida)"
        }

        # (c) Confirmacion independiente por catalogo, con la consulta exacta de arriba.
        $ResultadoConfirmacion = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
            '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-t', '-c',
            "SELECT EXISTS (SELECT 1 FROM pg_namespace n, LATERAL aclexplode(n.nspacl) a WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE');"
        )
        if ($ResultadoConfirmacion.FalloInvocacion) {
            throw "D1: no se pudo invocar psql para la confirmacion independiente por catalogo -- $($ResultadoConfirmacion.Salida)"
        }
        if ($ResultadoConfirmacion.CodigoSalida -ne 0) {
            throw "D1: la confirmacion independiente por catalogo fallo con codigo $($ResultadoConfirmacion.CodigoSalida). Salida: $($ResultadoConfirmacion.Salida)"
        }
        if ($ResultadoConfirmacion.Salida.Trim() -ne 'f') {
            throw "D1: PUBLIC no deberia conservar CREATE tras el REVOKE -- resultado: $($ResultadoConfirmacion.Salida)"
        }
    } catch {
        $FalloOriginal = $_
    } finally {
        # Limpieza incondicional: deja PUBLIC sin CREATE sin importar en que
        # paso fallo (o no) lo de arriba.
        $ResultadoLimpieza = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
            '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-c',
            'REVOKE CREATE ON SCHEMA public FROM PUBLIC;'
        )
        $HayFalloDeLimpieza = $ResultadoLimpieza.FalloInvocacion -or ($ResultadoLimpieza.CodigoSalida -ne 0)

        if ($HayFalloDeLimpieza) {
            $DetalleLimpieza = if ($ResultadoLimpieza.FalloInvocacion) {
                "no se pudo invocar psql para la limpieza (REVOKE CREATE ON SCHEMA public FROM PUBLIC) -- $($ResultadoLimpieza.Salida)"
            } else {
                "la limpieza (REVOKE CREATE ON SCHEMA public FROM PUBLIC) fallo con codigo $($ResultadoLimpieza.CodigoSalida). Salida: $($ResultadoLimpieza.Salida)"
            }

            if ($FalloOriginal) {
                throw "Fallo original de D1: $FalloOriginal -- ADEMAS $DetalleLimpieza -- PUBLIC puede haber quedado con CREATE, revisar manualmente"
            } else {
                throw "D1 paso pero $DetalleLimpieza -- PUBLIC puede haber quedado con CREATE, revisar manualmente"
            }
        }
    }

    if ($FalloOriginal) {
        throw $FalloOriginal
    }
}

function Invoke-D2 {
    $Sufijo = [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $RolPrueba = "_prueba_rf19rf20_d2_$Sufijo"

    if ($RolPrueba -notmatch '^[a-z_][a-z0-9_]{0,62}$') {
        throw "Nombre de rol de prueba invalido: $RolPrueba"
    }

    $ResultadoExiste = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
        '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-t', '-c',
        "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RolPrueba');"
    )
    if ($ResultadoExiste.FalloInvocacion) {
        throw "D2: no se pudo invocar psql para comprobar si el rol de prueba ya existe -- $($ResultadoExiste.Salida)"
    }
    if ($ResultadoExiste.CodigoSalida -ne 0) {
        throw "D2: la comprobacion de existencia del rol de prueba fallo con codigo $($ResultadoExiste.CodigoSalida). Salida: $($ResultadoExiste.Salida)"
    }
    if ($ResultadoExiste.Salida.Trim() -ne 'f') {
        throw "El rol de prueba generado ya existe por catalogo -- regenerar el sufijo: $RolPrueba"
    }

    $Archivo = $RutaMigracion
    $Lineas = Get-Content $Archivo
    $Inicio = ($Lineas | Select-String -Pattern '-- === INICIO POSTCONDICION RF19RF20 ===').LineNumber
    $Fin    = ($Lineas | Select-String -Pattern '-- === FIN POSTCONDICION RF19RF20 ===').LineNumber
    if (-not $Inicio -or -not $Fin -or $Fin -le $Inicio) {
        throw "No se pudieron localizar los marcadores de postcondicion en $Archivo"
    }
    $BloqueAislado = $Lineas[($Inicio - 1)..($Fin - 1)]
    $ArchivoTemporal = [System.IO.Path]::GetTempFileName()

    # Escritura explicita en UTF-8 sin BOM -- Set-Content en Windows
    # PowerShell 5.1 usaria UTF-16LE por defecto, lo que podria hacer fallar
    # a psql -f por codificacion y que la prueba interpretara ese fallo,
    # incorrectamente, como el bloqueo esperado.
    $Utf8SinBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines(
        $ArchivoTemporal,
        [string[]]$BloqueAislado,
        $Utf8SinBom
    )

    $FalloOriginal = $null
    try {
        $ResultadoPreparacion = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
            '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-c',
            "CREATE ROLE $RolPrueba; GRANT CREATE ON SCHEMA public TO $RolPrueba;"
        )
        if ($ResultadoPreparacion.FalloInvocacion) {
            throw "No se pudo invocar psql para preparar el rol de prueba -- $($ResultadoPreparacion.Salida)"
        }
        if ($ResultadoPreparacion.CodigoSalida -ne 0) {
            throw "No se pudo preparar el rol de prueba -- codigo $($ResultadoPreparacion.CodigoSalida). Salida: $($ResultadoPreparacion.Salida)"
        }

        $ResultadoMigracionAislada = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
            '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-f', $ArchivoTemporal
        )
        if ($ResultadoMigracionAislada.FalloInvocacion) {
            throw "D2: no se pudo invocar psql para ejecutar el bloque aislado -- $($ResultadoMigracionAislada.Salida)"
        }
        $Salida = $ResultadoMigracionAislada.Salida
        $Codigo = $ResultadoMigracionAislada.CodigoSalida

        if ($Codigo -eq 0) {
            throw "D2: se esperaba que la Comprobacion 3 detectara a $RolPrueba y abortara -- la ejecucion aislada termino con codigo 0. Salida: $Salida"
        }
        if ($Salida -notmatch [regex]::Escape('RF19RF20_POSTCONDICION_3_ROL_INESPERADO')) {
            throw "D2: codigo distinto de cero pero la salida no contiene RF19RF20_POSTCONDICION_3_ROL_INESPERADO -- no se puede distinguir el bloqueo esperado de un error no relacionado (sintaxis, conexion, codificacion, archivo faltante). Salida: $Salida"
        }
        if ($Salida -notmatch [regex]::Escape($RolPrueba)) {
            throw "D2: la salida no menciona el nombre exacto del rol de prueba ($RolPrueba) -- no se puede confirmar que el bloqueo correspondiera a este rol. Salida: $Salida"
        }
    } catch {
        $FalloOriginal = $_
    } finally {
        $ResultadoLimpiezaRol = Invoke-ComandoExterno -Ejecutable 'psql' -Argumentos @(
            '-v', 'ON_ERROR_STOP=1', $env:DATABASE_URL, '-c',
            "REVOKE CREATE ON SCHEMA public FROM $RolPrueba; DROP ROLE $RolPrueba;"
        )
        $HayFalloDeLimpiezaRol = $ResultadoLimpiezaRol.FalloInvocacion -or ($ResultadoLimpiezaRol.CodigoSalida -ne 0)

        Remove-Item $ArchivoTemporal -ErrorAction SilentlyContinue
        $ArchivoTemporalSigueExistiendo = Test-Path $ArchivoTemporal

        $HayFalloDeLimpieza = $HayFalloDeLimpiezaRol -or $ArchivoTemporalSigueExistiendo
        if ($HayFalloDeLimpieza) {
            $DetalleLimpieza = @()
            if ($HayFalloDeLimpiezaRol) {
                if ($ResultadoLimpiezaRol.FalloInvocacion) {
                    $DetalleLimpieza += "no se pudo invocar psql para REVOKE/DROP ROLE -- $($ResultadoLimpiezaRol.Salida)"
                } else {
                    $DetalleLimpieza += "REVOKE/DROP ROLE fallo con codigo $($ResultadoLimpiezaRol.CodigoSalida). Salida: $($ResultadoLimpiezaRol.Salida)"
                }
            }
            if ($ArchivoTemporalSigueExistiendo) { $DetalleLimpieza += "el archivo temporal $ArchivoTemporal sigue existiendo tras Remove-Item" }
            $DetalleLimpiezaTexto = $DetalleLimpieza -join '; '

            if ($FalloOriginal) {
                throw "Fallo original de D2: $FalloOriginal -- ADEMAS la limpieza fallo ($DetalleLimpiezaTexto) -- rol $RolPrueba y/o archivo temporal pueden haber quedado huerfanos, revisar manualmente"
            } else {
                throw "D2 paso pero la limpieza fallo ($DetalleLimpiezaTexto) -- rol $RolPrueba y/o archivo temporal pueden haber quedado huerfanos, revisar manualmente"
            }
        }
    }

    if ($FalloOriginal) {
        throw $FalloOriginal
    }
}


switch ($Prueba) {
    'Ninguna' {
        Write-Host "Ninguna prueba seleccionada (-Prueba Ninguna, valor por defecto). Nada se ejecuto, no se toco Neon."
    }
    'A'      { Invoke-PruebaA }
    'B'      { Invoke-PruebaB }
    'C'      { Invoke-PruebaC }
    'D1'     { Invoke-D1 }
    'D2'     { Invoke-D2 }
    'Todas'  {
        Invoke-PruebaA
        Invoke-PruebaB
        Invoke-PruebaC
        Invoke-D1
        Invoke-D2
        Write-Host "Pruebas A, B, C, D1 y D2 completadas sin excepcion."
    }
}
