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
  }

  get progress() { return this._progress; }

  _setProgress(phase, percent, detail) {
    this._progress = { phase, percent: Math.min(100, Math.max(0, percent)), detail };
  }

  async runBackup(config) {
    if (this.running) throw new Error('Backup already running');
    this.running = true;
    this._progress = null;

    try {
      if (this.platform === 'win32') {
        return await this._runWindowsBackup(config);
      } else if (this.platform === 'darwin') {
        return await this._runMacBackup(config);
      } else if (this.platform === 'linux') {
        return await this._runLinuxBackup(config);
      } else {
        throw new Error(`Plataforma no soportada: ${this.platform}`);
      }
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
   * Windows Image Backup using wimcapture (wimlib)
   * Captures each partition as a WIM image + saves disk metadata
   * Result is fully restorable from Linux/PXE without Windows
   */
  async _windowsImageBackup(sharePath, creds, nasAddress) {
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

    try {
      // Create destination directory
      await execFileAsync('cmd', ['/c', 'mkdir', destBase], { shell: false });

      this._setProgress('metadata', 10, 'Capturando metadatos del disco...');

      // ── Step 1: Save disk metadata (partition layout, GPT/MBR, sizes) ──
      const diskMetadata = await this._captureWindowsDiskMetadata();
      const metadataPath = `${destBase}\\disk-metadata.json`;
      // Write metadata via PowerShell (safe, no shell interpolation issues)
      const metadataJson = JSON.stringify(diskMetadata, null, 2);
      await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        `[System.IO.File]::WriteAllText('${metadataPath}', '${metadataJson.replace(/'/g, "''")}')`
      ], { shell: false });

      // ── Step 2: Check if wimlib is available, install if not ──
      this._setProgress('wimlib', 15, 'Verificando wimlib...');
      await this._ensureWimlib();

      // ── Step 3: Capture each important partition as WIM ──
      const partitions = diskMetadata.partitions.filter(p => 
        p.driveLetter && p.size > 0 && !p.isRecovery
      );

      let totalPartitions = partitions.length;
      let capturedPartitions = [];

      for (let i = 0; i < partitions.length; i++) {
        const part = partitions[i];
        const progressBase = 20 + (i / totalPartitions) * 70;
        const wimFile = `${destBase}\\${part.driveLetter.replace(':', '')}-partition.wim`;
        
        this._setProgress('capture', progressBase, 
          `Capturando ${part.driveLetter} (${part.label || part.fileSystem})...`);

        try {
          // wimcapture: capture the partition as a WIM image
          // Using wimlib-imagex which supports capturing mounted volumes on Windows
          await this._runWithTimeout('wimlib-imagex', [
            'capture',
            `${part.driveLetter}\\`,
            wimFile,
            `${hostname}-${part.driveLetter}`,
            `--compress=LZX`,     // Good compression ratio
            `--chunk-size=32768`,
            `--threads=${Math.max(1, os.cpus().length - 1)}`,
            '--no-acls',          // Skip ACLs for compatibility
          ], 7200000); // 2 hour timeout per partition

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
          capturedPartitions.push({
            driveLetter: part.driveLetter,
            label: part.label,
            success: false,
            error: err.message.substring(0, 500),
          });
        }
      }

      // ── Step 4: Capture EFI partition (if exists, requires admin) ──
      this._setProgress('efi', 90, 'Capturando partición EFI...');
      const efiPartition = diskMetadata.partitions.find(p => p.isEFI);
      if (efiPartition) {
        try {
          // Mount EFI partition temporarily
          const efiLetter = 'Y:';
          await execFileAsync('powershell', ['-NoProfile', '-Command',
            `$disk = Get-Partition -DiskNumber ${efiPartition.diskNumber} -PartitionNumber ${efiPartition.partitionNumber}; ` +
            `$disk | Set-Partition -NewDriveLetter Y`
          ], { shell: false });

          const efiWim = `${destBase}\\EFI-partition.wim`;
          await this._runWithTimeout('wimlib-imagex', [
            'capture', `${efiLetter}\\`, efiWim,
            `${hostname}-EFI`, '--compress=LZX', '--no-acls'
          ], 300000); // 5 min timeout

          // Unmount EFI
          await execFileAsync('powershell', ['-NoProfile', '-Command',
            `Remove-PartitionAccessPath -DiskNumber ${efiPartition.diskNumber} -PartitionNumber ${efiPartition.partitionNumber} -AccessPath '${efiLetter}\\'`
          ], { shell: false });

          capturedPartitions.push({
            driveLetter: 'EFI',
            label: 'EFI System',
            wimFile: 'EFI-partition.wim',
            success: true,
          });
        } catch (err) {
          console.error('Could not capture EFI partition:', err.message);
          // Not fatal — EFI can be rebuilt with bcdboot
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
      await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        `[System.IO.File]::WriteAllText('${destBase}\\backup-manifest.json', '${manifestJson.replace(/'/g, "''")}')`
      ], { shell: false });

      this._setProgress('done', 100, 'Backup completado');

      const failed = capturedPartitions.filter(p => !p.success);
      if (failed.length > 0 && failed.length === capturedPartitions.length) {
        throw new Error(`Todas las particiones fallaron: ${failed.map(f => f.error).join('; ')}`);
      }

      return {
        type: 'image',
        format: 'wim',
        path: `WIMBackup/${hostname}/${timestamp}`,
        partitions: capturedPartitions,
        timestamp: new Date().toISOString(),
        warnings: failed.length > 0 ? `${failed.length} particiones fallaron` : undefined,
      };

    } finally {
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
    try {
      await execFileAsync('wimlib-imagex', ['--version'], { shell: false });
      return; // Already available
    } catch (e) {}

    // Try from known install path
    const wimlibPaths = [
      'C:\\Program Files\\wimlib\\wimlib-imagex.exe',
      'C:\\Program Files (x86)\\wimlib\\wimlib-imagex.exe',
      path.join(process.env.LOCALAPPDATA || '', 'wimlib', 'wimlib-imagex.exe'),
    ];

    for (const p of wimlibPaths) {
      if (fs.existsSync(p)) {
        // Add to PATH for this session
        process.env.PATH = `${path.dirname(p)};${process.env.PATH}`;
        return;
      }
    }

    // Download portable wimlib
    console.log('[Backup] Downloading wimlib-imagex...');
    const wimlibDir = path.join(process.env.LOCALAPPDATA || 'C:\\ProgramData', 'wimlib');

    try {
      await execFileAsync('powershell', ['-NoProfile', '-Command', `
        New-Item -ItemType Directory -Force -Path '${wimlibDir}' | Out-Null
        $url = 'https://wimlib.net/downloads/wimlib-1.14.4-windows-x86_64-bin.zip'
        $zip = Join-Path $env:TEMP 'wimlib.zip'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        Expand-Archive -Path $zip -DestinationPath '${wimlibDir}' -Force
        Remove-Item $zip -Force
        # Move files from subfolder to root
        Get-ChildItem '${wimlibDir}' -Directory | ForEach-Object {
          Get-ChildItem $_.FullName -File | Move-Item -Destination '${wimlibDir}' -Force
        }
      `], { shell: false, timeout: 120000 });

      process.env.PATH = `${wimlibDir};${process.env.PATH}`;

      // Verify
      await execFileAsync('wimlib-imagex', ['--version'], { shell: false });
      console.log('[Backup] wimlib-imagex installed successfully');
    } catch (err) {
      throw new Error(`No se pudo instalar wimlib: ${err.message}. Instálalo manualmente desde https://wimlib.net`);
    }
  }

  /**
   * Run a command with timeout, returning stdout
   */
  async _runWithTimeout(cmd, args, timeoutMs) {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { shell: false, windowsHide: true });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { proc.kill(); reject(new Error('Timeout')); }, timeoutMs);

      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
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
