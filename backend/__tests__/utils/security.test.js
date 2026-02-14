/**
 * HomePiNAS - Security Utils Tests
 * Tests for security logging and safe command execution
 */

const path = require('path');

// Mock child_process before requiring the module
jest.mock('child_process', () => ({
    execFile: jest.fn()
}));

// Mock fs.promises
jest.mock('fs', () => ({
    promises: {
        rm: jest.fn()
    }
}));

const { execFile } = require('child_process');
const fs = require('fs').promises;
const { logSecurityEvent, safeExec, safeRemove } = require('../../utils/security');

// ============================================================================
// logSecurityEvent TESTS
// ============================================================================

describe('logSecurityEvent', () => {
    let consoleSpy;
    
    beforeEach(() => {
        consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });
    
    afterEach(() => {
        consoleSpy.mockRestore();
    });

    test('logs security events with IP string', () => {
        logSecurityEvent('LOGIN_SUCCESS', { username: 'john' }, '192.168.1.100');
        
        expect(consoleSpy).toHaveBeenCalledTimes(1);
        const logOutput = consoleSpy.mock.calls[0][0];
        expect(logOutput).toContain('[SECURITY]');
        expect(logOutput).toContain('LOGIN_SUCCESS');
        expect(logOutput).toContain('192.168.1.100');
        expect(logOutput).toContain('john');
    });

    test('logs security events with metadata object', () => {
        logSecurityEvent('FILE_ACCESS', { username: 'jane' }, { 
            ip: '10.0.0.1', 
            file: '/mnt/storage/data.txt',
            action: 'read'
        });
        
        const logOutput = consoleSpy.mock.calls[0][0];
        expect(logOutput).toContain('10.0.0.1');
        expect(logOutput).toContain('FILE_ACCESS');
        expect(logOutput).toContain('data.txt');
    });

    test('handles missing IP gracefully', () => {
        logSecurityEvent('LOGOUT', { username: 'user' }, undefined);
        
        const logOutput = consoleSpy.mock.calls[0][0];
        expect(logOutput).toContain('IP: -');
    });
});

// ============================================================================
// safeExec TESTS
// ============================================================================

describe('safeExec', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Mock execFile to call callback with success
        execFile.mockImplementation((cmd, args, opts, callback) => {
            if (typeof opts === 'function') {
                callback = opts;
                opts = {};
            }
            // Simulate async behavior
            process.nextTick(() => callback(null, 'output', ''));
        });
    });

    test('allows whitelisted commands', async () => {
        await expect(safeExec('ls', ['-la'])).resolves.toBeDefined();
        await expect(safeExec('cat', ['/etc/hostname'])).resolves.toBeDefined();
        await expect(safeExec('df', ['-h'])).resolves.toBeDefined();
    });

    test('rejects non-whitelisted commands', async () => {
        await expect(safeExec('rm', ['-rf', '/'])).rejects.toThrow('Command not allowed');
        await expect(safeExec('bash', ['-c', 'evil'])).rejects.toThrow('Command not allowed');
        await expect(safeExec('wget', ['http://evil.com'])).rejects.toThrow('Command not allowed');
        await expect(safeExec('curl', ['http://evil.com'])).rejects.toThrow('Command not allowed');
    });

    test('extracts base command from full path', async () => {
        await expect(safeExec('/usr/bin/ls', ['-la'])).resolves.toBeDefined();
        await expect(safeExec('/bin/cat', ['/etc/hostname'])).resolves.toBeDefined();
    });

    test('allows storage-related commands', async () => {
        await expect(safeExec('mkfs.ext4', ['/dev/sda1'])).resolves.toBeDefined();
        await expect(safeExec('mount', ['/dev/sda1', '/mnt/disk'])).resolves.toBeDefined();
        await expect(safeExec('smartctl', ['-a', '/dev/sda'])).resolves.toBeDefined();
    });

    test('allows user management commands', async () => {
        await expect(safeExec('useradd', ['newuser'])).resolves.toBeDefined();
        await expect(safeExec('usermod', ['-aG', 'sudo', 'user'])).resolves.toBeDefined();
        await expect(safeExec('smbpasswd', ['-a', 'user'])).resolves.toBeDefined();
    });

    test('allows system commands', async () => {
        await expect(safeExec('systemctl', ['status', 'homepinas'])).resolves.toBeDefined();
        await expect(safeExec('journalctl', ['-u', 'homepinas'])).resolves.toBeDefined();
    });
});

// ============================================================================
// safeRemove TESTS
// ============================================================================

describe('safeRemove', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fs.rm.mockResolvedValue(undefined);
    });

    test('throws if basePath is not provided', async () => {
        await expect(safeRemove('file.txt')).rejects.toThrow('basePath is required');
        await expect(safeRemove('file.txt', '')).rejects.toThrow('basePath is required');
        await expect(safeRemove('file.txt', null)).rejects.toThrow('basePath is required');
    });

    test('allows removal within base directory', async () => {
        await safeRemove('subdir/file.txt', '/mnt/storage');
        
        expect(fs.rm).toHaveBeenCalledWith(
            '/mnt/storage/subdir/file.txt',
            { recursive: true, force: true }
        );
    });

    test('prevents path traversal', async () => {
        await expect(
            safeRemove('../etc/passwd', '/mnt/storage')
        ).rejects.toThrow('Path traversal attempt blocked');
        
        await expect(
            safeRemove('../../root', '/mnt/storage')
        ).rejects.toThrow('Path traversal attempt blocked');
    });

    test('prevents removing base directory itself', async () => {
        await expect(
            safeRemove('.', '/mnt/storage')
        ).rejects.toThrow('Cannot remove base directory');
        
        await expect(
            safeRemove('', '/mnt/storage')
        ).rejects.toThrow('Cannot remove base directory');
    });

    test('handles nested paths correctly', async () => {
        await safeRemove('a/b/c/d.txt', '/mnt/storage');
        
        expect(fs.rm).toHaveBeenCalledWith(
            '/mnt/storage/a/b/c/d.txt',
            { recursive: true, force: true }
        );
    });

    test('rejects tricky path traversal attempts', async () => {
        // Encoded traversal
        await expect(
            safeRemove('subdir/../../etc', '/mnt/storage')
        ).rejects.toThrow('Path traversal attempt blocked');
    });
});
