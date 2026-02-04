/**
 * Backup Manager - Execute backups on Windows/Mac
 * Windows: wbadmin (image) or robocopy (files)
 * Mac: asr (image) or rsync (files)
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');

const execAsync = promisify(exec);

class BackupManager {
  constructor() {
    this.platform = process.platform;
    this.running = false;
  }

  async runBackup(config) {
    if (this.running) throw new Error('Backup already running');
    this.running = true;

    try {
      if (this.platform === 'win32') {
        return await this._runWindowsBackup(config);
      } else if (this.platform === 'darwin') {
        return await this._runMacBackup(config);
      } else {
        throw new Error(`Plataforma no soportada: ${this.platform}`);
      }
    } finally {
      this.running = false;
    }
  }

  // ══════════════════════════════════════
  // WINDOWS
  // ══════════════════════════════════════

  async _runWindowsBackup(config) {
    const { nasAddress, backupType, sambaShare, sambaUser, sambaPass } = config;
    const shareName = sambaShare || 'active-backup';
    const sharePath = `\\\\${nasAddress}\\${shareName}`;
    const creds = { user: sambaUser || 'homepinas', pass: sambaPass || 'homepinas' };

    if (backupType === 'image') {
      return this._windowsImageBackup(sharePath, creds);
    } else {
      return this._windowsFileBackup(sharePath, config.backupPaths, creds);
    }
  }

  async _windowsImageBackup(sharePath, creds) {
    // Clean ALL connections to this server first (error 1219 workaround)
    const server = sharePath.split('\\').filter(Boolean)[0];
    try { await execAsync(`net use \\\\${server} /delete /y 2>nul`, { shell: 'cmd.exe' }); } catch (e) {}
    try { await execAsync(`net use ${sharePath} /delete /y 2>nul`, { shell: 'cmd.exe' }); } catch (e) {}
    // Also clean any mapped drives to this server
    try {
      const { stdout } = await execAsync('net use', { shell: 'cmd.exe' });
      const lines = stdout.split('\n').filter(l => l.includes(server));
      for (const line of lines) {
        const match = line.match(/([A-Z]:)\s/);
        if (match) try { await execAsync(`net use ${match[1]} /delete /y 2>nul`, { shell: 'cmd.exe' }); } catch(e) {}
      }
    } catch(e) {}

    try {
      await execAsync(`net use ${sharePath} /user:${creds.user} ${creds.pass} /persistent:no`, { shell: 'cmd.exe' });
    } catch (e) {
      throw new Error(`No se pudo conectar al share ${sharePath}: ${e.message}`);
    }

    const cmd = `wbadmin start backup -backupTarget:${sharePath} -include:C: -allCritical -quiet`;

    try {
      const result = await execAsync(cmd, {
        shell: 'cmd.exe',
        timeout: 7200000, // 2 hours
        windowsHide: true,
      });
      return { type: 'image', output: result.stdout, timestamp: new Date().toISOString() };
    } finally {
      try { await execAsync(`net use ${sharePath} /delete /y 2>nul`, { shell: 'cmd.exe' }); } catch (e) {}
    }
  }

  async _windowsFileBackup(sharePath, paths, creds) {
    if (!paths || paths.length === 0) throw new Error('No hay carpetas configuradas para respaldar');

    try { await execAsync(`net use Z: /delete /y 2>nul`, { shell: 'cmd.exe' }); } catch (e) {}
    try {
      await execAsync(`net use Z: ${sharePath} /user:${creds.user} ${creds.pass} /persistent:no`, { shell: 'cmd.exe' });
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
        const cmd = `robocopy "${srcPath}" "${dest}" /MIR /R:2 /W:5 /NP /NFL /NDL /MT:8`;
        const result = await execAsync(cmd, { shell: 'cmd.exe', timeout: 3600000, windowsHide: true });
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

    try { await execAsync('net use Z: /delete /y 2>nul', { shell: 'cmd.exe' }); } catch (e) {}

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) throw new Error(`${failed.length} carpetas fallaron: ${failed.map(f => f.path).join(', ')}`);

    return { type: 'files', results, timestamp: new Date().toISOString() };
  }

  // ══════════════════════════════════════
  // MAC
  // ══════════════════════════════════════

  async _runMacBackup(config) {
    const { nasAddress, backupType, backupPaths, sambaShare, sambaUser, sambaPass } = config;
    const shareName = sambaShare || 'active-backup';
    const creds = { user: sambaUser || 'homepinas', pass: sambaPass || 'homepinas' };

    if (backupType === 'image') {
      return this._macImageBackup(nasAddress, shareName, creds);
    } else {
      return this._macFileBackup(nasAddress, shareName, creds, backupPaths);
    }
  }

  async _macImageBackup(nasAddress, shareName, creds) {
    const mountPoint = '/Volumes/homepinas-backup';
    try { await execAsync(`mkdir -p "${mountPoint}"`); } catch(e) {}
    try { await execAsync(`mount -t smbfs //${creds.user}:${creds.pass}@${nasAddress}/${shareName} "${mountPoint}"`); } catch (e) {
      throw new Error(`No se pudo montar el share: ${e.message}`);
    }

    const hostname = os.hostname();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destPath = `${mountPoint}/ImageBackup/${hostname}/${timestamp}`;

    try {
      await execAsync(`mkdir -p "${destPath}"`);
      await execAsync(`sudo asr create --source / --target "${destPath}/system.dmg" --erase --noprompt`, { timeout: 7200000 });
      return { type: 'image', timestamp: new Date().toISOString() };
    } finally {
      try { await execAsync(`umount "${mountPoint}"`); } catch (e) {}
    }
  }

  async _macFileBackup(nasAddress, shareName, creds, paths) {
    if (!paths || paths.length === 0) throw new Error('No hay carpetas configuradas para respaldar');

    const mountPoint = '/Volumes/homepinas-backup';
    try { await execAsync(`mkdir -p "${mountPoint}"`); } catch(e) {}
    try { await execAsync(`mount -t smbfs //${creds.user}:${creds.pass}@${nasAddress}/${shareName} "${mountPoint}"`); } catch (e) {
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
          await execAsync(`mkdir -p "${dest}"`);
          await execAsync(`rsync -az --delete "${srcPath}/" "${dest}/"`, { timeout: 3600000 });
          results.push({ path: srcPath, success: true });
        } catch (err) {
          results.push({ path: srcPath, success: false, error: err.message });
        }
      }
    } finally {
      try { await execAsync(`umount "${mountPoint}"`); } catch (e) {}
    }

    return { type: 'files', results, timestamp: new Date().toISOString() };
  }
}

module.exports = { BackupManager };
