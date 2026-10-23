$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Building capture helpers requires PowerShell 7. The installed app uses Windows PowerShell 5.' }
# Compile the existing C# in memory at build time. Windows PowerShell 5's
# runtime Add-Type writes temporary source files, which some managed desktops
# transparently transform before the compiler can read them.
Add-Type -Path (Join-Path $PSHOME 'Microsoft.CodeAnalysis.dll')
Add-Type -Path (Join-Path $PSHOME 'Microsoft.CodeAnalysis.CSharp.dll')
$captureRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../resources/capture'))
$framework = Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319'
$references = [Microsoft.CodeAnalysis.MetadataReference[]] @(
    'mscorlib.dll', 'System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Security.dll' | ForEach-Object {
        [Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile((Join-Path $framework $_))
    }
)
foreach ($name in @('ta-capture-host', 'ta-clipboard-monitor')) {
    $scriptText = [IO.File]::ReadAllText((Join-Path $captureRoot ($name + '.ps1')))
    $match = [regex]::Match($scriptText, "(?s)@'\r?\n(.*?)\r?\n'@")
    if (-not $match.Success) { throw "C# source block not found in $name" }
    $tree = [Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText($match.Groups[1].Value)
    $options = [Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions]::new([Microsoft.CodeAnalysis.OutputKind]::DynamicallyLinkedLibrary).WithOptimizationLevel([Microsoft.CodeAnalysis.OptimizationLevel]::Release).WithDeterministic($true)
    $compilation = [Microsoft.CodeAnalysis.CSharp.CSharpCompilation]::Create($name, [Microsoft.CodeAnalysis.SyntaxTree[]]@($tree), $references, $options)
    $stream = [IO.MemoryStream]::new()
    try {
        $result = $compilation.Emit($stream)
        if (-not $result.Success) { throw ($result.Diagnostics -join "`n") }
        [IO.File]::WriteAllBytes((Join-Path $captureRoot ($name + '.dll')), $stream.ToArray())
    } finally { $stream.Dispose() }
    Write-Host "Built $name.dll for .NET Framework"
}
