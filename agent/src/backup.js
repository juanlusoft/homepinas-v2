/**
 * Backup Manager - Execute backups on Windows/Mac
 * Windows: wbadmin (image) or robocopy (files)
 * Mac: asr (image) or rsync (files)
 *
 * SECURITY: Uses execFile (no shell) to prevent command injection.
 * Credentials are never interpolated into command strings.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);

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

    if (!sambaUser || !sambaPass) {
      throw new Error('Samba credentials are required for backup');
    }
    const creds = { user: sambaUser, pass: sambaPass };

    if (backupType === 'image') {
      return this._windowsImageBackup(sharePath, creds);
    } else {
      return this._windowsFileBackup(sharePath, config.backupPaths, creds);
    }
  }

  async _windowsImageBackup(sharePath, creds) {
    const server = sharePath.split('\\').filter(Boolean)[0];

    // Clean connections using execFile (no shell interpolation)
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

    // Connect with credentials — passed as separate args, never interpolated
    try {
      await execFileAsync('net', ['use', sharePath, `/user:${creds.user}`, creds.pass, '/persistent:no'], { shell: false });
    } catch (e) {
      throw new Error(`No se pudo conectar al share ${sharePath}: ${e.message}`);
    }

    try {
      // Run wbadmin with execFile and capture output
      let stdout = '', stderr = '';
      try {
        const result = await execFileAsync('wbadmin', [
          'start', 'backup',
          `-backupTarget:${sharePath}`,
          '-include:C:',
          '-allCritical',
          '-quiet'
        ], {
          timeout: 7200000, // 2 hours
          windowsHide: true,
          shell: false,
        });
        stdout = result.stdout || '';
        stderr = result.stderr || '';
      } catch (execErr) {
        stdout = execErr.stdout || '';
        stderr = execErr.stderr || '';

        const output = (stdout + stderr).toLowerCase();
        const successIndicators = [
          'completed successfully',
          'successfully completed',
          'the backup operation completed',
          'backup completed',
        ];
        const failureIndicators = [
          'the backup operation failed',
          'backup failed',
          'error:',
          'access is denied',
          'cannot find the path',
        ];

        const hasSuccess = successIndicators.some(s => output.includes(s));
        const hasFailure = failureIndicators.some(f => output.includes(f));

        if (hasSuccess && !hasFailure) {
          console.log('[wbadmin] Backup completed despite non-zero exit code');
        } else if (hasFailure || !hasSuccess) {
          const errorMsg = stderr || stdout || execErr.message;
          throw new Error(`wbadmin falló: ${errorMsg.substring(0, 500)}`);
        }
      }

      return { type: 'image', output: stdout, timestamp: new Date().toISOString() };
    } finally {
      try { await execFileAsync('net', ['use', sharePath, '/delete', '/y'], { shell: false }); } catch (e) {}
    }
  }

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
        // robocopy with execFile — paths as separate arguments
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
  // MAC
  // ══════════════════════════════════════

  async _runMacBackup(config) {
    const { nasAddress, backupType, backupPaths, sambaShare, sambaUser, sambaPass } = config;
    const shareName = sambaShare || 'active-backup';

    if (!sambaUser || !sambaPass) {
      throw new Error('Samba credentials are required for backup');
    }
    const creds = { user: sambaUser, pass: sambaPass };

    if (backupType === 'image') {
      return this._macImageBackup(nasAddress, shareName, creds);
    } else {
      return this._macFileBackup(nasAddress, shareName, creds, backupPaths);
    }
  }

  async _macImageBackup(nasAddress, shareName, creds) {
    const mountPoint = '/Volumes/homepinas-backup';
    try { await execFileAsync('mkdir', ['-p', mountPoint]); } catch(e) {}

    // Mount using mount_smbfs with -N (no password prompt) and URL-encoded credentials
    // Credentials are passed via the SMB URL, not interpolated in a shell command
    const smbUrl = `smb://${encodeURIComponent(creds.user)}:${encodeURIComponent(creds.pass)}@${nasAddress}/${shareName}`;
    try {
      await execFileAsync('mount_smbfs', ['-N', smbUrl, mountPoint]);
    } catch (e) {
      throw new Error(`No se pudo montar el share: ${e.message}`);
    }

    const hostname = os.hostname();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destPath = `${mountPoint}/ImageBackup/${hostname}/${timestamp}`;

    try {
      await execFileAsync('mkdir', ['-p', destPath]);
      await execFileAsync('sudo', ['asr', 'create', '--source', '/', '--target', `${destPath}/system.dmg`, '--erase', '--noprompt'], { timeout: 7200000 });
      return { type: 'image', timestamp: new Date().toISOString() };
    } finally {
      try { await execFileAsync('umount', [mountPoint]); } catch (e) {}
    }
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
          // rsync with execFile — paths as separate arguments
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
