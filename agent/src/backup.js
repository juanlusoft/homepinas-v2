/**
 * Backup Manager - Execute backups on Windows/Mac/Linux
 * Windows: wimcapture (image) or robocopy (files)
 * Linux:   partclone (image) or rsync (files)
 * Mac:     rsync (files only — Apple restrictions prevent full image restore)
 *
 * SECURITY: Uses execFile (no shell) to prevent command injection.
 * Credentials are never interpolated into command strings.
 */

const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);

class BackupManager {
  constructor() {
    this.platform = process.platform;
    this.running = false;
    this._progress = null;  // { phase, percent, detail }
    this._logLines = [];    // Backup log buffer
    this._logFile = null;   // Path to log file on disk
    this._wimlibPath = 'wimlib-imagex'; // Updated by _ensureWimlib
  }

  get progress() { return this._progress; }
  get logContent() { return this._logLines.join('\n'); }

  _setProgress(phase, percent, detail) {
    this._progress = { phase, percent: Math.min(100, Math.max(0, percent)), detail };
    this._log(`[${phase}] ${percent}% — ${detail}`);
  }

  _log(msg) {
    const ts = new Date().toISOString();
    const line = `${ts} ${msg}`;
    this._logLines.push(line);
    console.log(`[Backup] ${msg}`);
  }

  _initLog() {
    this._logLines = [];
    const logDir = this.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || 'C:\\ProgramData', 'HomePiNAS')
      : path.join(os.homedir(), '.homepinas');
    try { fs.mkdirSync(logDir, { recursive: true }); } catch(e) {}
    this._logFile = path.join(logDir, 'backup.log');
    this._log(`=== Backup started on ${os.hostname()} (${this.platform}) ===`);
    this._log(`OS: ${os.type()} ${os.release()} ${os.arch()}`);
    this._log(`RAM: ${Math.round(os.totalmem() / 1073741824)}GB`);
  }

  _flushLog() {
    if (this._logFile) {
      try {
        fs.writeFileSync(this._logFile, this._logLines.join('\n') + '\n');
      } catch(e) {
        console.error('[Backup] Could not write log file:', e.message);
      }
    }
  }

  async runBackup(config) {
    if (this.running) throw new Error('Backup already running');
    this.running = true;
    this._progress = null;
    this._initLog();

    try {
      let result;
      if (this.platform === 'win32') {
        result = await this._runWindowsBackup(config);
      } else if (this.platform === 'darwin') {
        result = await this._runMacBackup(config);
      } else if (this.platform === 'linux') {
        result = await this._runLinuxBackup(config);
      } else {
        throw new Error(`Plataforma no soportada: ${this.platform}`);
      }
      this._log(`=== Backup completed successfully ===`);
      result.log = this.logContent;
      this._flushLog();
      return result;
    } catch (err) {
      this._log(`=== Backup FAILED: ${err.message} ===`);
      this._flushLog();
      err.backupLog = this.logContent;
      throw err;
    } finally {
      this.running = false;
      this._progress = null;
    }
  }

  // ══════════════════════════════════════
  // WINDOWS — Image backup with wimcapture
  // ══════════════════════════════════════

  async _runWindowsBackup(config) {
    const { nasAddress, backupType, sambaShare, sambaUser, sambaPass } = config;
    const shareName = sambaShare || 'active-backup';
    const sharePath = `\\\\${nasAddress}\\${shareName}`;

    if (!sambaUser || !sambaPass) {
      throw new Error('Samba credentials are required for backup');
    }
    const creds = { user: sambaUser, pass: sambaPass };

    if (backupType === 'image') {
      return this._windowsImageBackup(sharePath, creds, nasAddress);
    } else {
      return this._windowsFileBackup(sharePath, config.backupPaths, creds);
    }
  }

  /**
   * Windows Image Backup using PowerShell worker process
   * Launches backup-worker.ps1 as independent process to avoid Node.js deadlocks.
   * Monitors progress via JSON status file — Node.js event loop stays free.
   * Result: WIM images + EFI + metadata, fully restorable from Linux/PXE.
   */
  async _windowsImageBackup(sharePath, creds, nasAddress) {
    const server = sharePath.split('\\').filter(Boolean)[0];

    // ── Step 0: Verify admin privileges (required for VSS snapshots) ──
    this._setProgress('admin-check', 2, 'Verificando privilegios de administrador...');
    try {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
      ], { shell: false });
      this._log(`Admin check result: ${stdout.trim()}`);
      if (stdout.trim() !== 'True') {
        throw new Error('El agente debe ejecutarse como Administrador para crear backups de imagen (VSS). Haz clic derecho → Ejecutar como administrador.');
      }
      this._log('Running with admin privileges ✓');
    } catch (err) {
      if (err.message.includes('Administrador')) throw err;
      throw new Error('No se pudo verificar privilegios de administrador: ' + err.message);
    }

    // ── Ensure wimlib is available ──
    await this._ensureWimlib();

    // ── Launch backup worker as independent PowerShell process ──
    this._setProgress('worker-launch', 3, 'Lanzando proceso de backup...');

    const hostname = os.hostname();
    const statusFile = path.join(os.tmpdir(), `homepinas-backup-status-${Date.now()}.json`);
    const workerLog = path.join(os.tmpdir(), `homepinas-backup-worker-${Date.now()}.log`);

    // Find the worker script (shipped as extraResource, NOT inside asar)
    const workerPaths = [
      path.join(process.resourcesPath || '', 'backup-worker.ps1'),
      path.join(path.dirname(process.execPath), 'resources', 'backup-worker.ps1'),
      path.join(__dirname, 'backup-worker.ps1'),
    ];
    let workerScript = null;
    for (const p of workerPaths) {
      if (fs.existsSync(p)) { workerScript = p; break; }
    }
    if (!workerScript) {
      throw new Error('backup-worker.ps1 not found. Reinstall the agent.');
    }
    this._log(`Worker script: ${workerScript}`);
    this._log(`Status file: ${statusFile}`);
    this._log(`Worker log: ${workerLog}`);

    // Launch PowerShell worker as fully detached process
    const workerArgs = [
      '-ExecutionPolicy', 'Bypass',
      '-File', workerScript,
      '-WimlibPath', this._wimlibPath,
      '-SharePath', sharePath,
      '-SambaUser', creds.user,
      '-SambaPass', creds.pass,
      '-Hostname', hostname,
      '-StatusFile', statusFile,
      '-LogFile', workerLog,
    ];

    // Build PowerShell command string for cmd.exe /c start
    // This ensures PowerShell runs completely independently, even if Node.js crashes
    const psArgs = workerArgs.slice(2).map(a => a.includes(' ') ? `"${a.replace(/"/g, '""')}"` : a).join(' ');
    const cmd = `cmd.exe`;
    const cmdArgs = ['/c', 'start', '/b', 'powershell.exe', ...workerArgs];
    
    this._log(`Launching worker via cmd.exe: powershell ${workerArgs.slice(0, 4).join(' ')}...`);
    
    const worker = spawn(cmd, cmdArgs, {
      detached: true,
      stdio: 'ignore', // Must be 'ignore' for truly detached process on Windows
      windowsHide: true,
      shell: false,
    });
    
    worker.unref(); // Don't block Node.js exit
    this._log(`Worker launched (detached)`);

    // ── Monitor progress via status file ──
    // The worker writes a JSON status file every few seconds.
    // We poll it here — Node.js event loop stays completely free.
    const POLL_INTERVAL = 5000; // 5 seconds
    const TIMEOUT = 7200000; // 2 hours
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      let lastPhase = '';
      let lastDetail = '';
      let workerDone = false;

      const pollTimer = setInterval(() => {
        // Check timeout
        if (Date.now() - startTime > TIMEOUT) {
          clearInterval(pollTimer);
          this._log('[worker] TIMEOUT after 2 hours');
          try { process.kill(workerPid); } catch(e) {}
          reject(new Error('Backup timeout (2 hours)'));
          return;
        }

        // Read status file (worker updates it every few seconds)
        let status = null;
        try {
          if (fs.existsSync(statusFile)) {
            const raw = fs.readFileSync(statusFile, 'utf-8');
            status = JSON.parse(raw);
          }
        } catch(e) {
          // File might be mid-write, retry next poll
        }

        if (status) {
          // Update progress if changed
          if (status.phase !== lastPhase || status.detail !== lastDetail) {
            lastPhase = status.phase;
            lastDetail = status.detail;
            this._setProgress(status.phase, status.percent, status.detail);
            this._log(`[worker] ${status.phase} ${status.percent}% — ${status.detail}`);
          }

          // Check for completion
          if (status.phase === 'done') {
            workerDone = true;
            clearInterval(pollTimer);
            this._log('[worker] Backup completed successfully');

            // Read worker log for full details
            try {
              const wlog = fs.readFileSync(workerLog, 'utf-8');
              this._log(`[worker:log]\n${wlog}`);
            } catch(e) {}

            // Clean up temp files
            try { fs.unlinkSync(statusFile); } catch(e) {}
            try { fs.unlinkSync(workerLog); } catch(e) {}

            // Parse the backup path from the worker log
            let backupPath = '';
            try {
              const wlog = fs.readFileSync(workerLog, 'utf-8');
              const pathMatch = wlog.match(/Path: (.+)/);
              if (pathMatch) backupPath = pathMatch[1].trim();
            } catch(e) {}

            resolve({
              type: 'image',
              format: 'wim',
              path: backupPath || `WIMBackup/${hostname}/unknown`,
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Check for error
          if (status.phase === 'error') {
            workerDone = true;
            clearInterval(pollTimer);
            const errMsg = status.error || status.detail || 'Unknown worker error';
            this._log(`[worker] FAILED: ${errMsg}`);

            // Read worker log
            try {
              const wlog = fs.readFileSync(workerLog, 'utf-8');
              this._log(`[worker:log]\n${wlog}`);
            } catch(e) {}

            try { fs.unlinkSync(statusFile); } catch(e) {}
            reject(new Error(errMsg));
            return;
          }
        }

        // If no status updates for too long, worker probably died
        // (We can't check PID with cmd.exe /c start, so we rely on status file)
        const noStatusForMs = Date.now() - (status ? new Date(status.timestamp).getTime() : startTime);
        if (!status && noStatusForMs > 30000 && !workerDone) {
          // No status file created after 30 seconds = worker died at startup
          clearInterval(pollTimer);
          let errMsg = 'Worker failed to start (no status file after 30s)';
          try {
            const wlog = fs.readFileSync(workerLog, 'utf-8');
            this._log(`[worker:log]\n${wlog}`);
            errMsg += ` | Log: ${wlog.split('\n').slice(-5).join(' ')}`;
          } catch(e) {
            errMsg += ' | No worker log file created';
          }
          try { fs.unlinkSync(statusFile); } catch(e) {}
          reject(new Error(errMsg));
        }
      }, POLL_INTERVAL);
    });
  }

  /**
   * OLD: Windows Image Backup using direct wimcapture from Node.js
   * DEPRECATED: Replaced by worker process. Kept for reference.
   */
  async _windowsImageBackup_legacy(sharePath, creds, nasAddress) {
    const server = sharePath.split('\\').filter(Boolean)[0];

    this._setProgress('connect', 5, 'Conectando al NAS...');

    // Clean existing connections
    try { await execFileAsync('net', ['use', `\\\\${server}`, '/delete', '/y'], { shell: false }); } catch (e) {}
    try { await execFileAsync('net', ['use', sharePath, '/delete', '/y'], { shell: false }); } catch (e) {}

    // Clean mapped drives to this server
    try {
      const { stdout } = await execFileAsync('net', ['use'], { shell: false });
      const lines = stdout.split('\n').filter(l => l.includes(server));
      for (const line of lines) {
        const match = line.match(/([A-Z]:)\s/);
        if (match) {
          try { await execFileAsync('net', ['use', match[1], '/delete', '/y'], { shell: false }); } catch(e) {}
        }
      }
    } catch(e) {}

    // Connect to NAS share
    try {
      await execFileAsync('net', ['use', sharePath, `/user:${creds.user}`, creds.pass, '/persistent:no'], { shell: false });
    } catch (e) {
      throw new Error(`No se pudo conectar al share ${sharePath}: ${e.message}`);
    }

    const hostname = os.hostname();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destBase = `${sharePath}\\WIMBackup\\${hostname}\\${timestamp}`;
    
    // Local temp directory — capture locally first, then copy to NAS
    // This avoids SMB disconnections during long wimcapture operations
    const localBase = path.join(os.tmpdir(), `homepinas-backup-${timestamp}`);

    try {
      // Create local and remote directories
      fs.mkdirSync(localBase, { recursive: true });
      await execFileAsync('cmd', ['/c', 'mkdir', destBase], { shell: false });
      this._log(`Local capture dir: ${localBase}`);
      this._log(`Remote dest dir: ${destBase}`);

      // Use NAS share directly for WIM output to avoid filling local disk
      // Metadata and manifest still go to local temp first (small files)
      const useDirectNas = true;
      const wimOutputDir = useDirectNas ? destBase : localBase;
      this._log(`WIM output dir: ${wimOutputDir} (direct-to-NAS: ${useDirectNas})`);

      // Create remote directory early so wimlib can write directly to NAS
      if (useDirectNas) {
        try {
          await execFileAsync('cmd', ['/c', 'mkdir', destBase], { shell: false });
          this._log(`Remote dir created: ${destBase}`);
        } catch(e) {
          this._log(`Remote dir may already exist: ${e.message}`);
        }
      }

      this._setProgress('metadata', 10, 'Capturando metadatos del disco...');

      // ── Step 1: Save disk metadata (partition layout, GPT/MBR, sizes) ──
      const diskMetadata = await this._captureWindowsDiskMetadata();
      const metadataJson = JSON.stringify(diskMetadata, null, 2);
      fs.writeFileSync(path.join(localBase, 'disk-metadata.json'), metadataJson);
      this._log('Disk metadata saved locally');

      // ── Step 2: Check if wimlib is available, install if not ──
      this._setProgress('wimlib', 15, 'Verificando wimlib...');
      await this._ensureWimlib();

      // ── Step 3: Capture each important partition as WIM ──
      const partitions = diskMetadata.partitions.filter(p => 
        p.driveLetter && p.size > 0 && !p.isRecovery && !p.isEFI
      );

      let totalPartitions = partitions.length;
      let capturedPartitions = [];

      for (let i = 0; i < partitions.length; i++) {
        const part = partitions[i];
        const progressBase = 20 + (i / totalPartitions) * 70;
        const wimFile = path.join(wimOutputDir, `${part.driveLetter.replace(':', '')}-partition.wim`);
        
        this._setProgress('capture', progressBase, 
          `Capturando ${part.driveLetter} (${part.label || part.fileSystem})...`);

        try {
          this._log(`Capturing ${part.driveLetter} (${part.label || 'no label'}, ${part.fileSystem}, ${part.size} bytes)`);

          // Create VSS shadow copy manually (wimlib --snapshot is unreliable)
          let capturePath = `${part.driveLetter}\\`;
          let shadowId = null;
          try {
            this._log(`Creating VSS shadow copy for ${part.driveLetter}...`);
            const { stdout: vssOut } = await execFileAsync('powershell', [
              '-NoProfile', '-Command',
              `$s = (Get-WmiObject -List Win32_ShadowCopy).Create("${part.driveLetter}\\", "ClientAccessible"); ` +
              `if ($s.ReturnValue -ne 0) { throw "VSS failed: code $($s.ReturnValue)" }; ` +
              `$shadow = Get-WmiObject Win32_ShadowCopy | Where-Object { $_.ID -eq $s.ShadowID }; ` +
              `Write-Output "$($s.ShadowID)|$($shadow.DeviceObject)"`
            ], { shell: false, timeout: 120000 });
            const [vssId, deviceObj] = vssOut.trim().split('|');
            if (deviceObj) {
              shadowId = vssId;
              capturePath = deviceObj + '\\';
              this._log(`VSS shadow created: ${shadowId} → ${capturePath}`);
            }
          } catch (vssErr) {
            this._log(`VSS failed for ${part.driveLetter}, falling back to live capture: ${vssErr.message}`);
          }

          // wimcapture from shadow copy (or live if VSS failed)
          // allowPartial: exit code 47 = some files couldn't be read (non-fatal, WIM is valid)
          await this._runWithTimeout(this._wimlibPath || 'wimlib-imagex', [
            'capture',
            capturePath,
            wimFile,
            `${hostname}-${part.driveLetter}`,
            `--compress=LZX`,     // Good compression ratio
            `--chunk-size=32768`,
            `--threads=${Math.max(1, os.cpus().length - 1)}`,
            '--no-acls',          // Skip ACLs for compatibility
          ], 7200000, { allowPartial: true }); // 2 hour timeout per partition

          // Delete shadow copy
          if (shadowId) {
            try {
              await execFileAsync('powershell', ['-NoProfile', '-Command',
                `Get-WmiObject Win32_ShadowCopy | Where-Object { $_.ID -eq '${shadowId}' } | ForEach-Object { $_.Delete() }`
              ], { shell: false, timeout: 30000 });
              this._log(`VSS shadow ${shadowId} deleted`);
            } catch(e) { this._log(`Warning: could not delete shadow ${shadowId}: ${e.message}`); }
          }

          // Get WIM file size
          let wimSize = 0;
          try {
            const { stdout } = await execFileAsync('powershell', [
              '-NoProfile', '-Command',
              `(Get-Item '${wimFile}').Length`
            ], { shell: false });
            wimSize = parseInt(stdout.trim()) || 0;
          } catch(e) {}

          capturedPartitions.push({
            driveLetter: part.driveLetter,
            label: part.label,
            fileSystem: part.fileSystem,
            wimFile: path.basename(wimFile),
            wimSize,
            originalSize: part.size,
            success: true,
          });
        } catch (err) {
          this._log(`FAILED ${part.driveLetter}: ${err.message.substring(0, 1000)}`);
          capturedPartitions.push({
            driveLetter: part.driveLetter,
            label: part.label,
            success: false,
            error: err.message.substring(0, 500),
          });
        }
      }

      // ── Step 4: Capture EFI partition (if exists, requires admin) ──
      // Mount to a hidden temp folder (NOT a drive letter) so it doesn't
      // appear in Explorer and users can't accidentally break EFI files.
      this._setProgress('efi', 90, 'Capturando partición EFI...');

      // Reconnect SMB — the connection likely dropped during the long wimlib capture
      this._log('[smb] Reconnecting to NAS before EFI capture...');
      try { await execFileAsync('net', ['use', sharePath, '/delete', '/y'], { shell: false }); } catch(e) {}
      try {
        await execFileAsync('net', ['use', sharePath, `/user:${creds.user}`, creds.pass, '/persistent:no'], { shell: false });
        this._log('[smb] Reconnected successfully ✓');
      } catch(e) {
        this._log(`[smb] Reconnect failed: ${e.message} — will retry before upload`);
      }

      const efiPartition = diskMetadata.partitions.find(p => p.isEFI);
      if (efiPartition) {
        const efiMountPath = path.join(os.tmpdir(), `homepinas-efi-${Date.now()}`);
        let efiMountedByUs = false;
        try {
          // Create temp folder for mount point
          fs.mkdirSync(efiMountPath, { recursive: true });

          // Mount EFI to folder (invisible — no drive letter in Explorer)
          await execFileAsync('powershell', ['-NoProfile', '-Command',
            `Add-PartitionAccessPath -DiskNumber ${efiPartition.diskNumber} -PartitionNumber ${efiPartition.partitionNumber} -AccessPath '${efiMountPath}'`
          ], { shell: false });
          efiMountedByUs = true;
          this._log(`EFI mounted at hidden path: ${efiMountPath}`);

          // Copy EFI files with robocopy (no drive letter exposed)
          const efiDest = path.join(wimOutputDir, 'EFI');
          await execFileAsync('cmd', ['/c', 'mkdir', efiDest], { shell: false }).catch(() => {});
          
          // robocopy: /E = recurse, /R:0 = no retries, /W:0 = no wait
          // robocopy returns 0-7 for success, 8+ for errors
          await new Promise((resolve, reject) => {
            const robo = spawn('robocopy', [
              efiMountPath, efiDest,
              '/E', '/R:0', '/W:0', '/NFL', '/NDL', '/NP', '/COPY:DAT'
            ], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';
            robo.stderr.on('data', d => { stderr += d.toString(); });
            const timer = setTimeout(() => { robo.kill(); reject(new Error('EFI copy timeout')); }, 120000);
            robo.on('close', code => {
              clearTimeout(timer);
              if (code <= 7) resolve();
              else reject(new Error(`robocopy failed with code ${code}: ${stderr}`));
            });
            robo.on('error', err => { clearTimeout(timer); reject(err); });
          });
          this._log(`EFI copied with robocopy`);

          // Get total size of copied EFI directory
          let efiTotalSize = 0;
          try {
            const { stdout: sizeOut } = await execFileAsync('powershell', [
              '-NoProfile', '-Command',
              `(Get-ChildItem '${efiDest}' -Recurse -File | Measure-Object -Property Length -Sum).Sum`
            ], { shell: false });
            efiTotalSize = parseInt(sizeOut.trim()) || 0;
          } catch(e) {}

          capturedPartitions.push({
            driveLetter: 'EFI',
            label: 'EFI System',
            fileSystem: 'FAT32',
            wimFile: null,
            efiDir: 'EFI',
            wimSize: efiTotalSize,
            originalSize: efiPartition.size,
            success: true,
          });
          this._log(`EFI captured successfully as directory (${efiTotalSize} bytes)`);
        } catch (err) {
          console.error('Could not capture EFI partition:', err.message);
          this._log(`EFI capture failed: ${err.message}`);
          // Not fatal — EFI can be rebuilt with bcdboot
        } finally {
          // Always clean up: unmount EFI and remove temp folder
          if (efiMountedByUs) {
            try {
              await execFileAsync('powershell', ['-NoProfile', '-Command',
                `Remove-PartitionAccessPath -DiskNumber ${efiPartition.diskNumber} -PartitionNumber ${efiPartition.partitionNumber} -AccessPath '${efiMountPath}'`
              ], { shell: false });
              this._log(`EFI unmounted from ${efiMountPath}`);
            } catch(e) {
              this._log(`Warning: could not unmount EFI: ${e.message}`);
            }
          }
          // Clean up temp mount folder
          try { fs.rmdirSync(efiMountPath); } catch(e) {}
        }
      }

      // ── Step 5: Save backup manifest ──
      this._setProgress('manifest', 95, 'Guardando manifiesto...');
      const manifest = {
        version: '2.0',
        format: 'wim',
        hostname,
        timestamp: new Date().toISOString(),
        os: 'windows',
        osVersion: os.release(),
        arch: os.arch(),
        disk: diskMetadata,
        partitions: capturedPartitions,
        agent: 'HomePiNAS Backup Agent',
      };

      const manifestJson = JSON.stringify(manifest, null, 2);
      fs.writeFileSync(path.join(localBase, 'backup-manifest.json'), manifestJson);
      this._log('Manifest saved locally');

      const failed = capturedPartitions.filter(p => !p.success);
      if (failed.length > 0 && failed.length === capturedPartitions.length) {
        throw new Error(`Todas las particiones fallaron: ${failed.map(f => f.error).join('; ')}`);
      }

      // ── Step 6: Copy remaining local files to NAS ──
      // WIMs are already on NAS (direct write), only copy metadata & manifest
      this._setProgress('upload', 95, 'Subiendo metadatos al NAS...');
      
      // Reconnect SMB with retries (connection may have dropped during long capture)
      let smbConnected = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await execFileAsync('net', ['use', sharePath, '/delete', '/y'], { shell: false }).catch(() => {});
          await execFileAsync('net', ['use', sharePath, `/user:${creds.user}`, creds.pass, '/persistent:no'], { shell: false });
          smbConnected = true;
          this._log(`[smb] Upload reconnect OK (attempt ${attempt})`);
          break;
        } catch(e) {
          this._log(`[smb] Upload reconnect attempt ${attempt}/3 failed: ${e.message}`);
          if (attempt < 3) await new Promise(r => setTimeout(r, 5000)); // wait 5s
        }
      }
      if (!smbConnected) {
        this._log('[smb] CRITICAL: Could not reconnect to NAS for metadata upload');
        throw new Error('No se pudo reconectar al NAS para subir metadatos. El WIM se guardó correctamente pero faltan metadata y manifest.');
      }
      
      const localFiles = fs.readdirSync(localBase);
      for (const file of localFiles) {
        const src = path.join(localBase, file);
        const dst = `${destBase}\\${file}`;
        const fileSize = fs.statSync(src).size;
        this._log(`Uploading ${file} (${Math.round(fileSize/1048576)}MB)...`);
        try {
          await execFileAsync('cmd', ['/c', 'copy', '/y', src, dst], { shell: false, timeout: 60000 });
          this._log(`Uploaded ${file} ✓`);
        } catch(e) {
          this._log(`Upload failed for ${file}: ${e.message}`);
        }
      }
      this._log('Metadata upload complete');

      this._setProgress('done', 100, 'Backup completado');

      return {
        type: 'image',
        format: 'wim',
        path: `WIMBackup/${hostname}/${timestamp}`,
        partitions: capturedPartitions,
        timestamp: new Date().toISOString(),
        warnings: failed.length > 0 ? `${failed.length} particiones fallaron` : undefined,
      };

    } finally {
      // Cleanup local temp files
      try {
        const files = fs.readdirSync(localBase);
        for (const f of files) fs.unlinkSync(path.join(localBase, f));
        fs.rmdirSync(localBase);
        this._log('Local temp files cleaned up');
      } catch(e) {}
      try { await execFileAsync('net', ['use', sharePath, '/delete', '/y'], { shell: false }); } catch (e) {}
    }
  }

  /**
   * Capture Windows disk metadata via PowerShell
   * Includes GPT/MBR layout, partition sizes, flags, UUIDs
   */
  async _captureWindowsDiskMetadata() {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-Command', `
        $disks = Get-Disk | Select-Object Number, FriendlyName, SerialNumber, Size, PartitionStyle, @{N='SectorSize';E={$_.LogicalSectorSize}}
        $partitions = Get-Partition | Select-Object DiskNumber, PartitionNumber, DriveLetter, Size, Offset, Type, GptType, IsSystem, IsBoot, IsActive, @{N='Label';E={(Get-Volume -Partition $_ -ErrorAction SilentlyContinue).FileSystemLabel}}, @{N='FileSystem';E={(Get-Volume -Partition $_ -ErrorAction SilentlyContinue).FileSystem}}
        @{disks=$disks; partitions=$partitions} | ConvertTo-Json -Depth 5
      `
    ], { shell: false, timeout: 30000 });

    const raw = JSON.parse(stdout);

    // Normalize into our format
    const disks = (Array.isArray(raw.disks) ? raw.disks : [raw.disks]).map(d => ({
      number: d.Number,
      name: d.FriendlyName,
      serial: d.SerialNumber,
      size: d.Size,
      partitionStyle: d.PartitionStyle, // GPT or MBR
      sectorSize: d.SectorSize,
    }));

    const partitions = (Array.isArray(raw.partitions) ? raw.partitions : [raw.partitions]).map(p => ({
      diskNumber: p.DiskNumber,
      partitionNumber: p.PartitionNumber,
      driveLetter: p.DriveLetter ? `${p.DriveLetter}:` : null,
      size: p.Size,
      offset: p.Offset,
      type: p.Type,
      gptType: p.GptType,
      isSystem: p.IsSystem,
      isBoot: p.IsBoot,
      isActive: p.IsActive,
      isEFI: p.GptType === '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}',
      isRecovery: p.GptType === '{de94bba4-06d1-4d40-a16a-bfd50179d6ac}',
      label: p.Label || '',
      fileSystem: p.FileSystem || '',
    }));

    return { disks, partitions, capturedAt: new Date().toISOString() };
  }

  /**
   * Ensure wimlib-imagex is available on Windows
   * Downloads portable wimlib if not found
   */
  async _ensureWimlib() {
    // 1. Check bundled wimlib (shipped with agent)
    const bundledPaths = [
      path.join(process.resourcesPath || '', 'wimlib', 'wimlib-imagex.exe'),
      path.join(path.dirname(process.execPath), 'resources', 'wimlib', 'wimlib-imagex.exe'),
    ];
    
    for (const p of bundledPaths) {
      if (fs.existsSync(p)) {
        this._wimlibPath = p;
        // Also add to PATH so DLLs are found
        process.env.PATH = `${path.dirname(p)};${process.env.PATH}`;
        this._log(`Using bundled wimlib: ${p}`);
        return;
      }
    }

    // 2. Check system PATH
    try {
      await execFileAsync('wimlib-imagex', ['--version'], { shell: false });
      this._wimlibPath = 'wimlib-imagex';
      this._log('Using system wimlib-imagex');
      return;
    } catch (e) {}

    // 3. Check known install locations
    const knownPaths = [
      'C:\\Windows\\System32\\wimlib-imagex.exe',
      'C:\\Program Files\\wimlib\\wimlib-imagex.exe',
      'C:\\Program Files (x86)\\wimlib\\wimlib-imagex.exe',
      path.join(process.env.LOCALAPPDATA || '', 'wimlib', 'wimlib-imagex.exe'),
    ];

    for (const p of knownPaths) {
      if (fs.existsSync(p)) {
        this._wimlibPath = p;
        process.env.PATH = `${path.dirname(p)};${process.env.PATH}`;
        this._log(`Using wimlib at: ${p}`);
        return;
      }
    }

    throw new Error('wimlib-imagex no encontrado. Está incluido en el instalador — reinstala el agente o descárgalo de https://wimlib.net');
  }

  /**
   * Run a command with timeout, returning stdout
   */
  async _runWithTimeout(cmd, args, timeoutMs, opts = {}) {
    this._log(`[exec] ${cmd} ${args.slice(0, 3).join(' ')}... (timeout: ${Math.round(timeoutMs/1000)}s)`);

    // On Windows: run via cmd.exe with output redirected to temp files
    // This avoids Node.js pipe issues that silently kill child processes
    const isWin = process.platform === 'win32';
    const logBase = path.join(os.tmpdir(), `homepinas-exec-${Date.now()}`);
    const outFile = logBase + '.stdout.log';
    const errFile = logBase + '.stderr.log';

    if (isWin) {
      return this._runWithFileRedirect(cmd, args, timeoutMs, opts, outFile, errFile);
    }

    // Non-Windows: use regular spawn
    return this._runWithSpawn(cmd, args, timeoutMs, opts);
  }

  async _runWithFileRedirect(cmd, args, timeoutMs, opts, outFile, errFile) {
    // Write a .bat file to avoid cmd.exe quoting hell with \\?\ paths
    const batFile = outFile.replace('.stdout.log', '.run.bat');
    // Don't quote args that end with \ (batch interprets \" as escaped quote)
    // Also don't quote simple args without spaces (flags like --compress=LZX)
    const escapedArgs = args.map(a => {
      if (a.endsWith('\\')) return a;  // paths ending in \ must NOT be quoted
      if (/\s/.test(a)) return `"${a}"`;  // quote if has spaces
      return a;  // no quotes needed for simple args
    }).join(' ');
    const batContent = `@echo off\r\n"${cmd}" ${escapedArgs} > "${outFile}" 2> "${errFile}"\r\nexit /b %errorlevel%\r\n`;
    fs.writeFileSync(batFile, batContent, 'utf-8');
    this._log(`[exec:bat] ${batFile} → ${cmd} ${args.slice(0, 3).join(' ')}...`);

    return new Promise((resolve, reject) => {
      const proc = spawn('cmd.exe', ['/c', batFile], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });

      const timer = setTimeout(() => {
        this._log(`[exec] TIMEOUT after ${Math.round(timeoutMs/1000)}s`);
        proc.kill();
        reject(new Error('Timeout'));
      }, timeoutMs);

      // Monitor progress using async PowerShell to read stdout file tail.
      // CRITICAL: We MUST NOT use fs.openSync() here. On Windows, cmd.exe's
      // output redirect (>) holds an exclusive write lock on the file.
      // fs.openSync() blocks the Node.js event loop waiting for the lock,
      // which prevents the 'close' event from ever being processed.
      // PowerShell's Get-Content opens with shared access — no blocking.
      let lastProgressLine = '';
      let progressErrors = 0;
      const progressInterval = setInterval(() => {
        // Use async exec to avoid blocking the event loop
        execFile('powershell', [
          '-NoProfile', '-Command',
          `if (Test-Path '${outFile}') { $f = Get-Item '${outFile}'; Write-Host $f.Length; Get-Content '${outFile}' -Tail 1 } else { Write-Host '0' }`
        ], { timeout: 8000, windowsHide: true, shell: false }, (err, stdout) => {
          if (err) {
            progressErrors++;
            if (progressErrors <= 3) this._log(`[progress] Read error (${progressErrors}): ${err.message.substring(0, 100)}`);
            return;
          }
          progressErrors = 0;
          const lines = (stdout || '').trim().split(/[\r\n]+/);
          const fileSize = parseInt(lines[0]) || 0;
          const last = lines.slice(1).join(' ').trim();
          if (last && last !== lastProgressLine) {
            lastProgressLine = last;
            this._log(`[wimlib] ${last.substring(0, 200)}`);
            const pctMatch = last.match(/(\d+)%/);
            if (pctMatch) {
              const wimlibPct = parseInt(pctMatch[1]);
              this._setProgress('capture', 20 + Math.round(wimlibPct * 0.7), last.substring(0, 100));
            }
          }
        });
      }, 10000); // Every 10 seconds (PowerShell is heavier than file read)

      proc.on('close', code => {
        clearTimeout(timer);
        clearInterval(progressInterval);
        this._log(`[exec] cmd.exe exited with code ${code}`);

        // Read output files (safe now — cmd.exe released the lock)
        let stdout = '', stderr = '';
        try { stdout = fs.readFileSync(outFile, 'utf-8').slice(-100000); } catch(e) {
          this._log(`[exec] Could not read stdout file: ${e.message}`);
        }
        try { stderr = fs.readFileSync(errFile, 'utf-8'); } catch(e) {}

        // Clean up temp files
        for (const f of [outFile, errFile, batFile]) {
          try { fs.unlinkSync(f); } catch(e) {}
        }

        if (stderr) this._log(`[exec:stderr] ${stderr.trim().substring(0, 500)}`);

        if (code === 0) {
          resolve(stdout);
        } else if (opts.allowPartial && code === 47) {
          this._log(`[exec] Partial success (code 47) — WIM is valid`);
          resolve(stdout);
        } else {
          reject(new Error(stderr || stdout || `Exit code ${code}`));
        }
      });

      proc.on('error', err => {
        clearTimeout(timer);
        clearInterval(progressInterval);
        this._log(`[exec] process error: ${err.message}`);
        reject(err);
      });
    });
  }

  async _runWithSpawn(cmd, args, timeoutMs, opts) {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { proc.kill(); reject(new Error('Timeout')); }, timeoutMs);

      proc.stdout.on('data', d => { stdout += d.toString().slice(0, 100000); });
      proc.stderr.on('data', d => { stderr += d.toString(); this._log(`[stderr] ${d.toString().trim().substring(0, 200)}`); });
      proc.on('close', code => {
        clearTimeout(timer);
        if (code === 0 || (opts.allowPartial && code === 47)) resolve(stdout);
        else reject(new Error(stderr || stdout || `Exit code ${code}`));
      });
      proc.on('error', err => { clearTimeout(timer); reject(err); });
    });
  }

  // ══════════════════════════════════════
  // WINDOWS — File backup (unchanged)
  // ══════════════════════════════════════

  async _windowsFileBackup(sharePath, paths, creds) {
    if (!paths || paths.length === 0) throw new Error('No hay carpetas configuradas para respaldar');

    try { await execFileAsync('net', ['use', 'Z:', '/delete', '/y'], { shell: false }); } catch (e) {}
    try {
      await execFileAsync('net', ['use', 'Z:', sharePath, `/user:${creds.user}`, creds.pass, '/persistent:no'], { shell: false });
    } catch (e) {
      throw new Error(`No se pudo conectar al share ${sharePath}: ${e.message}`);
    }

    const results = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destBase = `Z:\\FileBackup\\${os.hostname()}\\${timestamp}`;

    for (const srcPath of paths) {
      const folderName = path.basename(srcPath) || 'root';
      const dest = `${destBase}\\${folderName}`;
      try {
        const result = await execFileAsync('robocopy', [
          srcPath, dest,
          '/MIR', '/R:2', '/W:5', '/NP', '/NFL', '/NDL', '/MT:8'
        ], { timeout: 3600000, windowsHide: true, shell: false });
        results.push({ path: srcPath, success: true });
      } catch (err) {
        const exitCode = err.code || 0;
        if (exitCode < 8) {
          results.push({ path: srcPath, success: true });
        } else {
          results.push({ path: srcPath, success: false, error: err.message });
        }
      }
    }

    try { await execFileAsync('net', ['use', 'Z:', '/delete', '/y'], { shell: false }); } catch (e) {}

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) throw new Error(`${failed.length} carpetas fallaron: ${failed.map(f => f.path).join(', ')}`);

    return { type: 'files', results, timestamp: new Date().toISOString() };
  }

  // ══════════════════════════════════════
  // LINUX — Image backup with partclone
  // ══════════════════════════════════════

  async _runLinuxBackup(config) {
    const { nasAddress, backupType, sambaShare, sambaUser, sambaPass, backupPaths } = config;

    if (!sambaUser || !sambaPass) {
      throw new Error('Samba credentials are required for backup');
    }

    if (backupType === 'files') {
      return this._linuxFileBackup(nasAddress, sambaShare, { user: sambaUser, pass: sambaPass }, backupPaths);
    }
    return this._linuxImageBackup(nasAddress, sambaShare, { user: sambaUser, pass: sambaPass });
  }

  async _linuxImageBackup(nasAddress, shareName, creds) {
    const mountPoint = '/tmp/homepinas-backup-mount';
    const hostname = os.hostname();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    this._setProgress('connect', 5, 'Montando share del NAS...');

    // Mount SMB share
    try { await execFileAsync('mkdir', ['-p', mountPoint]); } catch(e) {}
    try { await execFileAsync('umount', [mountPoint]); } catch(e) {}

    // Create credentials file (not in command line)
    const credFile = '/tmp/.homepinas-smb-creds';
    fs.writeFileSync(credFile, `username=${creds.user}\npassword=${creds.pass}\n`, { mode: 0o600 });

    try {
      await execFileAsync('mount', [
        '-t', 'cifs',
        `//${nasAddress}/${shareName}`,
        mountPoint,
        '-o', `credentials=${credFile},iocharset=utf8`
      ]);
    } catch(e) {
      fs.unlinkSync(credFile);
      throw new Error(`No se pudo montar el share: ${e.message}`);
    }
    fs.unlinkSync(credFile);

    const destBase = `${mountPoint}/PartcloneBackup/${hostname}/${timestamp}`;

    try {
      await execFileAsync('mkdir', ['-p', destBase]);

      this._setProgress('metadata', 10, 'Capturando metadatos del disco...');

      // Capture disk metadata
      const diskMetadata = await this._captureLinuxDiskMetadata();
      fs.writeFileSync(`${destBase}/disk-metadata.json`, JSON.stringify(diskMetadata, null, 2));

      // Capture each partition
      const partitions = diskMetadata.partitions.filter(p => 
        p.fstype && p.size > 0 && !['swap', 'linux-swap'].includes(p.fstype)
      );

      let capturedPartitions = [];

      for (let i = 0; i < partitions.length; i++) {
        const part = partitions[i];
        const progressBase = 15 + (i / partitions.length) * 75;
        const imageFile = `${destBase}/${part.name}.partclone.gz`;

        this._setProgress('capture', progressBase,
          `Capturando ${part.name} (${part.fstype}, ${part.mountpoint || 'no montado'})...`);

        try {
          // Select the right partclone variant
          const tool = `partclone.${part.fstype === 'vfat' ? 'fat32' : part.fstype}`;

          await this._runWithTimeout('sh', ['-c',
            `${tool} -c -s ${part.path} | gzip -c > '${imageFile}'`
          ], 7200000);

          capturedPartitions.push({
            name: part.name,
            path: part.path,
            fstype: part.fstype,
            mountpoint: part.mountpoint,
            imageFile: path.basename(imageFile),
            success: true,
          });
        } catch (err) {
          capturedPartitions.push({
            name: part.name,
            success: false,
            error: err.message.substring(0, 500),
          });
        }
      }

      // Save backup manifest
      this._setProgress('manifest', 95, 'Guardando manifiesto...');
      const manifest = {
        version: '2.0',
        format: 'partclone',
        hostname,
        timestamp: new Date().toISOString(),
        os: 'linux',
        osVersion: os.release(),
        arch: os.arch(),
        disk: diskMetadata,
        partitions: capturedPartitions,
        agent: 'HomePiNAS Backup Agent',
      };
      fs.writeFileSync(`${destBase}/backup-manifest.json`, JSON.stringify(manifest, null, 2));

      this._setProgress('done', 100, 'Backup completado');

      return {
        type: 'image',
        format: 'partclone',
        path: `PartcloneBackup/${hostname}/${timestamp}`,
        partitions: capturedPartitions,
        timestamp: new Date().toISOString(),
      };
    } finally {
      try { await execFileAsync('umount', [mountPoint]); } catch(e) {}
    }
  }

  async _captureLinuxDiskMetadata() {
    // Get disk info with lsblk
    const { stdout: lsblkOut } = await execFileAsync('lsblk', [
      '-J', '-b', '-o', 'NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,UUID,PARTUUID,PARTTYPE,MODEL,SERIAL'
    ]);
    const lsblk = JSON.parse(lsblkOut);

    // Get partition table with sfdisk (GPT/MBR dump)
    const disks = lsblk.blockdevices.filter(d => d.type === 'disk');
    const partTableDumps = {};

    for (const disk of disks) {
      try {
        const { stdout } = await execFileAsync('sfdisk', ['--dump', `/dev/${disk.name}`]);
        partTableDumps[disk.name] = stdout;
      } catch(e) {}
    }

    const partitions = lsblk.blockdevices
      .flatMap(d => (d.children || []).map(p => ({ ...p, parentDisk: d.name })))
      .filter(p => p.type === 'part')
      .map(p => ({
        name: p.name,
        path: `/dev/${p.name}`,
        size: p.size,
        fstype: p.fstype,
        mountpoint: p.mountpoint,
        uuid: p.uuid,
        partuuid: p.partuuid,
        parttype: p.parttype,
        parentDisk: p.parentDisk,
      }));

    return {
      blockdevices: lsblk.blockdevices,
      partitionTables: partTableDumps,
      partitions,
      capturedAt: new Date().toISOString(),
    };
  }

  async _linuxFileBackup(nasAddress, shareName, creds, paths) {
    if (!paths || paths.length === 0) throw new Error('No hay carpetas configuradas para respaldar');

    const mountPoint = '/tmp/homepinas-backup-mount';
    const hostname = os.hostname();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    try { await execFileAsync('mkdir', ['-p', mountPoint]); } catch(e) {}
    try { await execFileAsync('umount', [mountPoint]); } catch(e) {}

    const credFile = '/tmp/.homepinas-smb-creds';
    fs.writeFileSync(credFile, `username=${creds.user}\npassword=${creds.pass}\n`, { mode: 0o600 });

    try {
      await execFileAsync('mount', ['-t', 'cifs', `//${nasAddress}/${shareName}`, mountPoint,
        '-o', `credentials=${credFile},iocharset=utf8`]);
    } catch(e) {
      fs.unlinkSync(credFile);
      throw new Error(`No se pudo montar el share: ${e.message}`);
    }
    fs.unlinkSync(credFile);

    const results = [];
    try {
      for (const srcPath of paths) {
        const folderName = path.basename(srcPath) || 'root';
        const dest = `${mountPoint}/FileBackup/${hostname}/${timestamp}/${folderName}`;
        try {
          await execFileAsync('mkdir', ['-p', dest]);
          await execFileAsync('rsync', ['-az', '--delete', `${srcPath}/`, `${dest}/`], { timeout: 3600000 });
          results.push({ path: srcPath, success: true });
        } catch (err) {
          results.push({ path: srcPath, success: false, error: err.message });
        }
      }
    } finally {
      try { await execFileAsync('umount', [mountPoint]); } catch(e) {}
    }

    return { type: 'files', results, timestamp: new Date().toISOString() };
  }

  // ══════════════════════════════════════
  // MAC — File backup only
  // ══════════════════════════════════════

  async _runMacBackup(config) {
    const { nasAddress, backupType, backupPaths, sambaShare, sambaUser, sambaPass } = config;

    if (!sambaUser || !sambaPass) {
      throw new Error('Samba credentials are required for backup');
    }

    // Mac: always file backup (image restore not supported due to Apple restrictions)
    const paths = backupPaths && backupPaths.length > 0
      ? backupPaths
      : [os.homedir()]; // Default: user home directory

    return this._macFileBackup(nasAddress, sambaShare || 'active-backup', { user: sambaUser, pass: sambaPass }, paths);
  }

  async _macFileBackup(nasAddress, shareName, creds, paths) {
    if (!paths || paths.length === 0) throw new Error('No hay carpetas configuradas para respaldar');

    const mountPoint = '/Volumes/homepinas-backup';
    try { await execFileAsync('mkdir', ['-p', mountPoint]); } catch(e) {}

    const smbUrl = `smb://${encodeURIComponent(creds.user)}:${encodeURIComponent(creds.pass)}@${nasAddress}/${shareName}`;
    try {
      await execFileAsync('mount_smbfs', ['-N', smbUrl, mountPoint]);
    } catch (e) {
      throw new Error(`No se pudo montar el share: ${e.message}`);
    }

    const hostname = os.hostname();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const results = [];

    try {
      for (const srcPath of paths) {
        const folderName = path.basename(srcPath) || 'root';
        const dest = `${mountPoint}/FileBackup/${hostname}/${timestamp}/${folderName}`;
        try {
          await execFileAsync('mkdir', ['-p', dest]);
          await execFileAsync('rsync', ['-az', '--delete', `${srcPath}/`, `${dest}/`], { timeout: 3600000 });
          results.push({ path: srcPath, success: true });
        } catch (err) {
          results.push({ path: srcPath, success: false, error: err.message });
        }
      }
    } finally {
      try { await execFileAsync('umount', [mountPoint]); } catch (e) {}
    }

    return { type: 'files', results, timestamp: new Date().toISOString() };
  }
}

module.exports = { BackupManager };
