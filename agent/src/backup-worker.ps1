# HomePiNAS Backup Worker — Runs as independent process
# Node.js launches this and monitors $StatusFile for progress
# This script NEVER hangs Node.js because it's fully detached
#
# Usage: powershell -ExecutionPolicy Bypass -File backup-worker.ps1 
#   -WimlibPath "C:\...\wimlib-imagex.exe"
#   -SharePath "\\192.168.1.100\backup-xxx"
#   -SambaUser "backup-xxx"
#   -SambaPass "xxx"
#   -Hostname "homelabs"
#   -StatusFile "C:\Users\...\backup-status.json"
#   -LogFile "C:\Users\...\backup-worker.log"

param(
    [Parameter(Mandatory=$true)][string]$WimlibPath,
    [Parameter(Mandatory=$true)][string]$SharePath,
    [Parameter(Mandatory=$true)][string]$SambaUser,
    [Parameter(Mandatory=$true)][string]$SambaPass,
    [Parameter(Mandatory=$true)][string]$Hostname,
    [Parameter(Mandatory=$true)][string]$StatusFile,
    [Parameter(Mandatory=$true)][string]$LogFile
)

$ErrorActionPreference = "Stop"

# ── Helpers ──
function Write-Status($phase, $percent, $detail, $error = $null) {
    $obj = @{
        phase = $phase
        percent = $percent
        detail = $detail
        error = $error
        pid = $PID
        timestamp = (Get-Date -Format "o")
    }
    $obj | ConvertTo-Json -Compress | Set-Content -Path $StatusFile -Force
}

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffZ') $msg"
    Add-Content -Path $LogFile -Value $line
}

try {
    Write-Status "starting" 0 "Iniciando backup worker..."
    Write-Log "=== Backup Worker started (PID $PID) ==="
    Write-Log "WimlibPath: $WimlibPath"
    Write-Log "SharePath: $SharePath"
    Write-Log "Hostname: $Hostname"

    # ── Step 0: Admin check ──
    Write-Status "admin-check" 2 "Verificando privilegios..."
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        throw "Se requieren privilegios de administrador"
    }
    Write-Log "Admin check OK"

    # ── Step 1: Connect to NAS ──
    Write-Status "connect" 5 "Conectando al NAS..."
    $server = ($SharePath -split '\\' | Where-Object { $_ })[0]
    
    # Clean existing connections
    net use "\\$server" /delete /y 2>$null
    net use $SharePath /delete /y 2>$null
    
    # Connect
    $netResult = net use $SharePath /user:$SambaUser $SambaPass /persistent:no 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "SMB connect failed: $netResult"
    }
    Write-Log "SMB connected to $SharePath"

    # ── Step 2: Create backup directory ──
    $timestamp = (Get-Date -Format "yyyy-MM-ddTHH-mm-ss-fffZ")
    $destBase = "$SharePath\WIMBackup\$Hostname\$timestamp"
    New-Item -ItemType Directory -Path $destBase -Force | Out-Null
    Write-Log "Backup dir: $destBase"

    # ── Step 3: Capture disk metadata ──
    Write-Status "metadata" 8 "Capturando metadatos del disco..."
    $disks = Get-Disk | Select-Object Number, FriendlyName, SerialNumber, Size, PartitionStyle, @{N='SectorSize';E={$_.LogicalSectorSize}}
    $partitions = Get-Partition | Select-Object DiskNumber, PartitionNumber, DriveLetter, Size, Offset, Type, GptType, IsSystem, IsBoot, IsActive, `
        @{N='Label';E={(Get-Volume -Partition $_ -ErrorAction SilentlyContinue).FileSystemLabel}}, `
        @{N='FileSystem';E={(Get-Volume -Partition $_ -ErrorAction SilentlyContinue).FileSystem}}
    
    $metadata = @{ disks = $disks; partitions = $partitions; capturedAt = (Get-Date -Format "o") }
    $metadata | ConvertTo-Json -Depth 5 | Set-Content "$destBase\disk-metadata.json"
    Write-Log "Disk metadata saved"

    # ── Step 4: Find partitions to capture ──
    $efiGptType = "{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}"
    $recoveryGptType = "{de94bba4-06d1-4d40-a16a-bfd50179d6ac}"
    
    $capturePartitions = @($partitions | Where-Object {
        $_.DriveLetter -and $_.Size -gt 0 -and 
        $_.GptType -ne $efiGptType -and $_.GptType -ne $recoveryGptType
    })
    
    Write-Log "Partitions to capture: $($capturePartitions.Count)"
    $capturedResults = @()
    $totalParts = $capturePartitions.Count
    
    # ── Step 5: Capture each partition ──
    for ($i = 0; $i -lt $capturePartitions.Count; $i++) {
        $part = $capturePartitions[$i]
        $letter = "$($part.DriveLetter):"
        $pctBase = 15 + [math]::Floor(($i / $totalParts) * 70)
        $wimFile = "$destBase\$($part.DriveLetter)-partition.wim"
        
        Write-Status "capture" $pctBase "Capturando $letter..."
        Write-Log "Capturing $letter ($('{0:N1}' -f ($part.Size / 1GB)) GB)"
        
        # Create VSS shadow
        $shadowId = $null
        $capturePath = "$letter\"
        try {
            Write-Log "Creating VSS shadow for $letter..."
            $s = (Get-WmiObject -List Win32_ShadowCopy).Create("$letter\", "ClientAccessible")
            if ($s.ReturnValue -eq 0) {
                $shadow = Get-WmiObject Win32_ShadowCopy | Where-Object { $_.ID -eq $s.ShadowID }
                $shadowId = $s.ShadowID
                $capturePath = "$($shadow.DeviceObject)\"
                Write-Log "VSS shadow: $shadowId -> $capturePath"
            } else {
                Write-Log "VSS returned code $($s.ReturnValue), using live capture"
            }
        } catch {
            Write-Log "VSS failed: $($_.Exception.Message), using live capture"
        }
        
        # Run wimlib-imagex capture
        # Write output to a progress file that we can monitor
        $progressFile = "$destBase\wimlib-progress-$($part.DriveLetter).log"
        $threads = [Math]::Max(1, [Environment]::ProcessorCount - 1)
        
        $wimArgs = @(
            "capture"
            $capturePath
            $wimFile
            "$Hostname-$letter"
            "--compress=LZX"
            "--chunk-size=32768"
            "--threads=$threads"
            "--no-acls"
        )
        
        Write-Log "Running: $WimlibPath $($wimArgs -join ' ')"
        
        # Launch wimlib as completely independent process with output to file
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $WimlibPath
        $psi.Arguments = $wimArgs -join ' '
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.CreateNoWindow = $true
        
        $wimlibProc = [System.Diagnostics.Process]::Start($psi)
        
        # Read output asynchronously
        $stdoutTask = $wimlibProc.StandardOutput.ReadToEndAsync()
        $stderrTask = $wimlibProc.StandardError.ReadToEndAsync()
        
        # Monitor progress while wimlib runs
        $lastUpdate = ""
        while (-not $wimlibProc.HasExited) {
            Start-Sleep -Seconds 10
            
            # Check if WIM file is growing
            if (Test-Path $wimFile) {
                $wimSize = (Get-Item $wimFile).Length
                $wimSizeGB = '{0:N1}' -f ($wimSize / 1GB)
                $totalGB = '{0:N1}' -f ($part.Size / 1GB)
                $progressMsg = "Archiving $letter : $wimSizeGB GiB written"
                
                if ($progressMsg -ne $lastUpdate) {
                    $lastUpdate = $progressMsg
                    # Estimate percent based on typical compression ratio (~0.5)
                    $estimatedTotal = $part.Size * 0.55
                    $pct = if ($estimatedTotal -gt 0) { [math]::Min(99, [math]::Floor($wimSize / $estimatedTotal * 100)) } else { 0 }
                    $overallPct = $pctBase + [math]::Floor($pct * 0.7 / $totalParts)
                    Write-Status "capture" $overallPct $progressMsg
                    Write-Log $progressMsg
                }
            }
            
            # Reconnect SMB if it dropped (keep-alive)
            try {
                $testFile = "$destBase\disk-metadata.json"
                if (-not (Test-Path $testFile)) {
                    Write-Log "[smb] Connection lost, reconnecting..."
                    net use $SharePath /delete /y 2>$null
                    net use $SharePath /user:$SambaUser $SambaPass /persistent:no 2>$null
                    Write-Log "[smb] Reconnected"
                }
            } catch {
                Write-Log "[smb] Keep-alive check failed: $($_.Exception.Message)"
            }
        }
        
        # Get exit code and output
        $exitCode = $wimlibProc.ExitCode
        $stdout = $stdoutTask.Result
        $stderr = $stderrTask.Result
        
        # Save wimlib output
        if ($stdout) { Add-Content -Path $progressFile -Value $stdout }
        if ($stderr) { Write-Log "[wimlib:stderr] $stderr" }
        Write-Log "wimlib exited with code $exitCode"
        
        # Delete VSS shadow
        if ($shadowId) {
            try {
                Get-WmiObject Win32_ShadowCopy | Where-Object { $_.ID -eq $shadowId } | ForEach-Object { $_.Delete() }
                Write-Log "VSS shadow $shadowId deleted"
            } catch {
                Write-Log "Could not delete VSS shadow: $($_.Exception.Message)"
            }
        }
        
        # Record result
        $wimSize = 0
        if (Test-Path $wimFile) { $wimSize = (Get-Item $wimFile).Length }
        
        if ($exitCode -eq 0 -or $exitCode -eq 47) {
            $capturedResults += @{
                driveLetter = $letter
                label = $part.Label
                fileSystem = $part.FileSystem
                wimFile = [System.IO.Path]::GetFileName($wimFile)
                wimSize = $wimSize
                originalSize = $part.Size
                success = $true
                exitCode = $exitCode
            }
            Write-Log "Captured $letter OK ($('{0:N1}' -f ($wimSize / 1GB)) GB WIM, exit code $exitCode)"
        } else {
            $capturedResults += @{
                driveLetter = $letter
                success = $false
                error = "wimlib exit code $exitCode : $stderr"
            }
            Write-Log "FAILED $letter : exit code $exitCode"
        }
    }

    # ── Step 6: Capture EFI partition ──
    Write-Status "efi" 88 "Capturando partición EFI..."
    $efiPart = $partitions | Where-Object { $_.GptType -eq $efiGptType } | Select-Object -First 1
    
    if ($efiPart) {
        $efiMountPath = Join-Path $env:TEMP "homepinas-efi-$(Get-Date -Format 'yyyyMMddHHmmss')"
        $efiMounted = $false
        try {
            New-Item -ItemType Directory -Path $efiMountPath -Force | Out-Null
            Add-PartitionAccessPath -DiskNumber $efiPart.DiskNumber -PartitionNumber $efiPart.PartitionNumber -AccessPath $efiMountPath
            $efiMounted = $true
            Write-Log "EFI mounted at $efiMountPath"
            
            # Reconnect SMB before EFI copy
            net use $SharePath /delete /y 2>$null
            net use $SharePath /user:$SambaUser $SambaPass /persistent:no 2>$null
            
            $efiDest = "$destBase\EFI"
            New-Item -ItemType Directory -Path $efiDest -Force | Out-Null
            
            # robocopy (exit codes 0-7 = success)
            $roboResult = robocopy $efiMountPath $efiDest /E /R:0 /W:0 /NFL /NDL /NP /COPY:DAT 2>&1
            $roboExit = $LASTEXITCODE
            Write-Log "EFI robocopy exit: $roboExit"
            
            if ($roboExit -le 7) {
                $efiSize = (Get-ChildItem $efiDest -Recurse -File | Measure-Object -Property Length -Sum).Sum
                $capturedResults += @{
                    driveLetter = "EFI"
                    label = "EFI System"
                    fileSystem = "FAT32"
                    efiDir = "EFI"
                    wimSize = $efiSize
                    originalSize = $efiPart.Size
                    success = $true
                }
                Write-Log "EFI captured ($efiSize bytes)"
            } else {
                Write-Log "EFI robocopy failed: code $roboExit"
            }
        } catch {
            Write-Log "EFI capture error: $($_.Exception.Message)"
        } finally {
            if ($efiMounted) {
                try {
                    Remove-PartitionAccessPath -DiskNumber $efiPart.DiskNumber -PartitionNumber $efiPart.PartitionNumber -AccessPath $efiMountPath
                    Write-Log "EFI unmounted"
                } catch {
                    Write-Log "EFI unmount failed: $($_.Exception.Message)"
                }
            }
            Remove-Item -Path $efiMountPath -Force -ErrorAction SilentlyContinue
        }
    }

    # ── Step 7: Save manifest ──
    Write-Status "manifest" 95 "Guardando manifiesto..."
    
    $manifest = @{
        version = "2.0"
        format = "wim"
        hostname = $Hostname
        timestamp = (Get-Date -Format "o")
        os = "windows"
        osVersion = [Environment]::OSVersion.VersionString
        arch = [Environment]::Is64BitOperatingSystem
        partitions = $capturedResults
        agent = "HomePiNAS Backup Agent (worker)"
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content "$destBase\backup-manifest.json"
    Write-Log "Manifest saved"

    # ── Step 8: Check results ──
    $failedCount = ($capturedResults | Where-Object { -not $_.success }).Count
    $successCount = ($capturedResults | Where-Object { $_.success }).Count
    
    if ($successCount -eq 0) {
        throw "All partitions failed"
    }

    $resultPath = "WIMBackup/$Hostname/$timestamp"
    Write-Status "done" 100 "Backup completado ($successCount particiones)" 
    Write-Log "=== Backup completed: $successCount OK, $failedCount failed ==="
    Write-Log "Path: $resultPath"

} catch {
    $errMsg = $_.Exception.Message
    Write-Log "=== BACKUP FAILED: $errMsg ==="
    Write-Status "error" -1 $errMsg $errMsg
} finally {
    # Cleanup SMB
    try { net use $SharePath /delete /y 2>$null } catch {}
}
