/**
 * Backup Manager - Execute backups on Windows/Mac
 * Windows: wbadmin (image) or robocopy (files)
 * Mac: tmutil (image) or rsync (files)
 */

const { execFile, exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);
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
        throw new Error(`Unsupported platform: ${this.platform}`);
      }
    } finally {
      this.running = false;
    }
  }

  // ══════════════════════════════════════
  // WINDOWS
  // ══════════════════════════════════════

  async _runWindowsBackup(config) {
    const { nasAddress, nasPort, username, backupType } = config;
    const sharePath = `\\\\${nasAddress}\\active-backup`;

    if (backupType === 'image') {
      return this._windowsImageBackup(sharePath, username);
    } else {
      return this._windowsFileBackup(sharePath, config.backupPaths);
    }
  }

  async _windowsImageBackup(sharePath, username) {
    // Map network drive if not already mapped
    try {
      await execAsync(`net use B: ${sharePath} /persistent:no 2>nul`, { shell: 'cmd.exe' });
    } catch (e) {
      // May already be mapped
    }

    // Run wbadmin for full system image
    const cmd = `wbadmin start backup -backupTarget:${sharePath} -include:C: -allCritical -quiet`;
    
    const result = await execAsync(cmd, {
      shell: 'cmd.exe',
      timeout: 7200000, // 2 hours max
      windowsHide: true,
    });

    // Cleanup drive mapping
    try {
      await execAsync('net use B: /delete /y 2>nul', { shell: 'cmd.exe' });
    } catch (e) {}

    return {
      type: 'image',
      output: result.stdout,
      timestamp: new Date().toISOString(),
    };
  }

  async _windowsFileBackup(sharePath, paths) {
    if (!paths || paths.length === 0) {
      throw new Error('No backup paths configured');
    }

    const results = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destBase = `${sharePath}\\FileBackup\\${os.hostname()}\\${timestamp}`;

    for (const srcPath of paths) {
      const folderName = path.basename(srcPath) || 'root';
      const dest = `${destBase}\\${folderName}`;

      try {
        // robocopy: mirror mode, retry 2 times, wait 5 sec
        const cmd = `robocopy "${srcPath}" "${dest}" /MIR /R:2 /W:5 /NP /NFL /NDL /MT:8`;
        const result = await execAsync(cmd, {
          shell: 'cmd.exe',
          timeout: 3600000,
          windowsHide: true,
        });

        // robocopy exit codes: 0-7 = success, 8+ = error
        results.push({ path: srcPath, success: true, output: result.stdout });
      } catch (err) {
        // robocopy returns non-zero for "files copied" which is success
        const exitCode = err.code || 0;
        if (exitCode < 8) {
          results.push({ path: srcPath, success: true, output: err.stdout });
        } else {
          results.push({ path: srcPath, success: false, error: err.message });
        }
      }
    }

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      throw new Error(`${failed.length} paths failed: ${failed.map(f => f.path).join(', ')}`);
    }

    return { type: 'files', results, timestamp: new Date().toISOString() };
  }

  // ══════════════════════════════════════
  // MAC
  // ══════════════════════════════════════

  async _runMacBackup(config) {
    const { nasAddress, backupType, backupPaths } = config;
    const sharePath = `smb://${nasAddress}/active-backup`;

    if (backupType === 'image') {
      return this._macImageBackup(nasAddress);
    } else {
      return this._macFileBackup(nasAddress, backupPaths);
    }
  }

  async _macImageBackup(nasAddress) {
    // Mount SMB share
    const mountPoint = '/Volumes/homepinas-backup';
    try {
      await execAsync(`mkdir -p "${mountPoint}"`);
      await execAsync(`mount -t smbfs //guest@${nasAddress}/active-backup "${mountPoint}"`);
    } catch (e) {}

    // Use Time Machine CLI or asr
    const hostname = os.hostname();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destPath = `${mountPoint}/ImageBackup/${hostname}/${timestamp}`;

    try {
      await execAsync(`mkdir -p "${destPath}"`);
      
      // Create a compressed disk image of the system
      const cmd = `sudo asr create --source / --target "${destPath}/system.dmg" --erase --noprompt`;
      await execAsync(cmd, { timeout: 7200000 });

      return { type: 'image', timestamp: new Date().toISOString() };
    } finally {
      try { await execAsync(`umount "${mountPoint}"`); } catch (e) {}
    }
  }

  async _macFileBackup(nasAddress, paths) {
    if (!paths || paths.length === 0) {
      throw new Error('No backup paths configured');
    }

    const mountPoint = '/Volumes/homepinas-backup';
    try {
      await execAsync(`mkdir -p "${mountPoint}"`);
      await execAsync(`mount -t smbfs //guest@${nasAddress}/active-backup "${mountPoint}"`);
    } catch (e) {}

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

  // ══════════════════════════════════════
  // UTILS
  // ══════════════════════════════════════

  getDrives() {
    if (this.platform === 'win32') {
      return this._getWindowsDrives();
    } else {
      return this._getMacDrives();
    }
  }

  _getWindowsDrives() {
    try {
      const { execSync } = require('child_process');
      const output = execSync(
        'Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free,Root | ConvertTo-Json',
        { shell: 'powershell.exe', encoding: 'utf8', timeout: 10000 }
      );
      const drives = JSON.parse(output);
      return (Array.isArray(drives) ? drives : [drives]).map(d => ({
        letter: d.Name,
        root: d.Root,
        used: d.Used,
        free: d.Free,
      }));
    } catch (e) {
      return [{ letter: 'C', root: 'C:\\', used: 0, free: 0 }];
    }
  }

  _getMacDrives() {
    try {
      const { execSync } = require('child_process');
      const output = execSync('df -h / /Volumes/* 2>/dev/null', { encoding: 'utf8', timeout: 10000 });
      const lines = output.trim().split('\n').slice(1);
      return lines.map(line => {
        const parts = line.split(/\s+/);
        return {
          mount: parts[parts.length - 1],
          size: parts[1],
          used: parts[2],
          free: parts[3],
        };
      });
    } catch (e) {
      return [{ mount: '/', size: '?', used: '?', free: '?' }];
    }
  }
}

module.exports = { BackupManager };
