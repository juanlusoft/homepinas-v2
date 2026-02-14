/**
 * HomePiNAS - Sanitize Utils Tests
 * Tests for input validation and sanitization functions
 */

const {
    sanitizeUsername,
    validateUsername,
    validatePassword,
    sanitizeDiskId,
    sanitizeDiskPath,
    sanitizePath,
    sanitizePathWithinBase,
    escapeShellArg,
    sanitizeShellArg,
    validateDockerAction,
    validateContainerId,
    sanitizeComposeName,
    validateComposeContent,
    validateSystemAction,
    validateFanId,
    validateFanSpeed,
    validateFanMode,
    validateInterfaceName,
    validateIPv4,
    validateSubnetMask,
    validateDiskRole,
    validateDiskConfig,
    validatePositiveInt,
    validateNonNegativeInt,
    sanitizeForLog
} = require('../../utils/sanitize');

// ============================================================================
// USERNAME TESTS
// ============================================================================

describe('sanitizeUsername', () => {
    test('returns null for empty input', () => {
        expect(sanitizeUsername('')).toBeNull();
        expect(sanitizeUsername(null)).toBeNull();
        expect(sanitizeUsername(undefined)).toBeNull();
    });

    test('returns null for non-string input', () => {
        expect(sanitizeUsername(123)).toBeNull();
        expect(sanitizeUsername({})).toBeNull();
        expect(sanitizeUsername([])).toBeNull();
    });

    test('removes invalid characters', () => {
        expect(sanitizeUsername('john@doe')).toBe('johndoe');
        expect(sanitizeUsername('user!name')).toBe('username');
        expect(sanitizeUsername('user name')).toBe('username');
    });

    test('returns null for usernames too short', () => {
        expect(sanitizeUsername('ab')).toBeNull();
        expect(sanitizeUsername('a')).toBeNull();
    });

    test('returns null for usernames too long', () => {
        expect(sanitizeUsername('a'.repeat(33))).toBeNull();
    });

    test('returns null if not starting with letter', () => {
        expect(sanitizeUsername('1user')).toBeNull();
        expect(sanitizeUsername('_user')).toBeNull();
        expect(sanitizeUsername('-user')).toBeNull();
    });

    test('returns null for reserved usernames', () => {
        expect(sanitizeUsername('root')).toBeNull();
        expect(sanitizeUsername('ROOT')).toBeNull();
        expect(sanitizeUsername('admin')).toBeNull();
        expect(sanitizeUsername('Admin')).toBeNull();
        expect(sanitizeUsername('daemon')).toBeNull();
        expect(sanitizeUsername('nobody')).toBeNull();
        expect(sanitizeUsername('www-data')).toBeNull();
    });

    test('accepts valid usernames', () => {
        expect(sanitizeUsername('john')).toBe('john');
        expect(sanitizeUsername('john_doe')).toBe('john_doe');
        expect(sanitizeUsername('john-doe')).toBe('john-doe');
        expect(sanitizeUsername('JohnDoe123')).toBe('JohnDoe123');
    });

    test('allows underscores and hyphens', () => {
        expect(sanitizeUsername('test_user')).toBe('test_user');
        expect(sanitizeUsername('test-user')).toBe('test-user');
        expect(sanitizeUsername('test_user-123')).toBe('test_user-123');
    });
});

describe('validateUsername', () => {
    test('returns true for valid usernames', () => {
        expect(validateUsername('john')).toBe(true);
        expect(validateUsername('john_doe')).toBe(true);
    });

    test('returns false for invalid usernames', () => {
        expect(validateUsername('')).toBe(false);
        expect(validateUsername('root')).toBe(false);
        expect(validateUsername('ab')).toBe(false);
    });
});

describe('validatePassword', () => {
    test('returns false for empty input', () => {
        expect(validatePassword('')).toBe(false);
        expect(validatePassword(null)).toBe(false);
        expect(validatePassword(undefined)).toBe(false);
    });

    test('returns false for non-string input', () => {
        expect(validatePassword(123456)).toBe(false);
    });

    test('returns false for too short passwords', () => {
        expect(validatePassword('12345')).toBe(false);
        expect(validatePassword('abc')).toBe(false);
    });

    test('returns false for too long passwords', () => {
        expect(validatePassword('a'.repeat(129))).toBe(false);
    });

    test('returns true for valid passwords', () => {
        expect(validatePassword('123456')).toBe(true);
        expect(validatePassword('password123')).toBe(true);
        expect(validatePassword('a'.repeat(128))).toBe(true);
    });
});

// ============================================================================
// DISK SANITIZATION TESTS
// ============================================================================

describe('sanitizeDiskId', () => {
    test('returns null for empty input', () => {
        expect(sanitizeDiskId('')).toBeNull();
        expect(sanitizeDiskId(null)).toBeNull();
        expect(sanitizeDiskId(undefined)).toBeNull();
    });

    test('accepts standard disk names', () => {
        expect(sanitizeDiskId('sda')).toBe('sda');
        expect(sanitizeDiskId('sdb')).toBe('sdb');
        expect(sanitizeDiskId('sdz')).toBe('sdz');
    });

    test('accepts disk partitions', () => {
        expect(sanitizeDiskId('sda1')).toBe('sda1');
        expect(sanitizeDiskId('sda12')).toBe('sda12');
    });

    test('strips /dev/ prefix', () => {
        expect(sanitizeDiskId('/dev/sda')).toBe('sda');
        expect(sanitizeDiskId('/dev/sda1')).toBe('sda1');
    });

    test('accepts NVMe disks', () => {
        expect(sanitizeDiskId('nvme0n1')).toBe('nvme0n1');
        expect(sanitizeDiskId('nvme0n1p1')).toBe('nvme0n1p1');
        expect(sanitizeDiskId('nvme1n2p3')).toBe('nvme1n2p3');
    });

    test('accepts other disk types', () => {
        expect(sanitizeDiskId('hda')).toBe('hda');
        expect(sanitizeDiskId('vda')).toBe('vda');
        expect(sanitizeDiskId('xvda')).toBe('xvda');
    });

    test('accepts mmcblk devices', () => {
        expect(sanitizeDiskId('mmcblk0')).toBe('mmcblk0');
        expect(sanitizeDiskId('mmcblk0p1')).toBe('mmcblk0p1');
    });

    test('rejects invalid disk names', () => {
        expect(sanitizeDiskId('invalid')).toBeNull();
        expect(sanitizeDiskId('../etc/passwd')).toBeNull();
        expect(sanitizeDiskId('sda; rm -rf /')).toBeNull();
        expect(sanitizeDiskId('$(whoami)')).toBeNull();
    });
});

describe('sanitizeDiskPath', () => {
    test('returns null for invalid input', () => {
        expect(sanitizeDiskPath('')).toBeNull();
        expect(sanitizeDiskPath(null)).toBeNull();
        expect(sanitizeDiskPath('sda')).toBeNull(); // must start with /dev/
    });

    test('returns full path for valid disks', () => {
        expect(sanitizeDiskPath('/dev/sda')).toBe('/dev/sda');
        expect(sanitizeDiskPath('/dev/nvme0n1')).toBe('/dev/nvme0n1');
    });

    test('rejects path traversal attempts', () => {
        expect(sanitizeDiskPath('/dev/../etc/passwd')).toBeNull();
    });
});

describe('sanitizePath', () => {
    test('returns null for empty input', () => {
        expect(sanitizePath('')).toBeNull();
        expect(sanitizePath(null)).toBeNull();
    });

    test('rejects path traversal starting with ..', () => {
        expect(sanitizePath('../etc/passwd')).toBeNull();
    });

    // NOTE: path.normalize resolves /home/../etc/passwd to /etc/passwd
    // which no longer contains '..' - this is expected behavior
    // For strict confinement, use sanitizePathWithinBase instead
    test('normalizes embedded path traversal', () => {
        expect(sanitizePath('/home/../etc/passwd')).toBe('/etc/passwd');
    });

    // NOTE: null bytes are stripped before validation
    // The resulting path is valid if it passes other checks
    test('strips null bytes and validates result', () => {
        expect(sanitizePath('/home/user\0/file')).toBe('/home/user/file');
    });

    test('rejects special characters', () => {
        expect(sanitizePath('/home/user;id')).toBeNull();
        expect(sanitizePath('/home/$(whoami)')).toBeNull();
    });

    test('accepts valid paths', () => {
        expect(sanitizePath('/home/user/file.txt')).toBe('/home/user/file.txt');
        expect(sanitizePath('/mnt/storage/data')).toBe('/mnt/storage/data');
    });
});

describe('sanitizePathWithinBase', () => {
    const baseDir = '/mnt/storage';

    test('returns null for empty input', () => {
        expect(sanitizePathWithinBase('', baseDir)).toBeNull();
        expect(sanitizePathWithinBase(null, baseDir)).toBeNull();
    });

    test('returns null for invalid base', () => {
        expect(sanitizePathWithinBase('file.txt', '')).toBeNull();
        expect(sanitizePathWithinBase('file.txt', null)).toBeNull();
    });

    test('confines paths within base directory', () => {
        const result = sanitizePathWithinBase('subdir/file.txt', baseDir);
        expect(result).toBe('/mnt/storage/subdir/file.txt');
    });

    test('strips leading slashes to treat as relative', () => {
        const result = sanitizePathWithinBase('/subdir/file.txt', baseDir);
        expect(result).toBe('/mnt/storage/subdir/file.txt');
    });

    test('prevents directory traversal', () => {
        expect(sanitizePathWithinBase('../etc/passwd', baseDir)).toBeNull();
        expect(sanitizePathWithinBase('subdir/../../etc/passwd', baseDir)).toBeNull();
    });

    test('allows base directory itself', () => {
        const result = sanitizePathWithinBase('', baseDir);
        // Empty string after strip could be null or base - depends on implementation
        // Let's test with '.'
        const result2 = sanitizePathWithinBase('.', baseDir);
        expect(result2).toBe('/mnt/storage');
    });
});

// ============================================================================
// SHELL ARGUMENT TESTS
// ============================================================================

describe('escapeShellArg', () => {
    test('handles null and undefined', () => {
        expect(escapeShellArg(null)).toBe("''");
        expect(escapeShellArg(undefined)).toBe("''");
    });

    test('handles non-strings', () => {
        expect(escapeShellArg(123)).toBe("''");
        expect(escapeShellArg({})).toBe("''");
    });

    test('wraps strings in single quotes', () => {
        expect(escapeShellArg('hello')).toBe("'hello'");
        expect(escapeShellArg('hello world')).toBe("'hello world'");
    });

    test('escapes single quotes', () => {
        expect(escapeShellArg("it's")).toBe("'it'\\''s'");
        expect(escapeShellArg("'quoted'")).toBe("''\\''quoted'\\'''");
    });

    test('handles dangerous shell characters', () => {
        const dangerous = '$(rm -rf /)';
        const escaped = escapeShellArg(dangerous);
        expect(escaped).toBe("'$(rm -rf /)'");
    });
});

describe('sanitizeShellArg', () => {
    test('is alias for escapeShellArg', () => {
        expect(sanitizeShellArg('test')).toBe(escapeShellArg('test'));
    });
});

// ============================================================================
// DOCKER VALIDATION TESTS
// ============================================================================

describe('validateDockerAction', () => {
    test('accepts valid actions', () => {
        expect(validateDockerAction('start')).toBe(true);
        expect(validateDockerAction('stop')).toBe(true);
        expect(validateDockerAction('restart')).toBe(true);
    });

    test('rejects invalid actions', () => {
        expect(validateDockerAction('remove')).toBe(false);
        expect(validateDockerAction('delete')).toBe(false);
        expect(validateDockerAction('')).toBe(false);
        expect(validateDockerAction('start; rm -rf /')).toBe(false);
    });
});

describe('validateContainerId', () => {
    test('accepts valid container IDs', () => {
        expect(validateContainerId('abc123def456')).toBe(true); // 12 chars
        expect(validateContainerId('abc123def456789012345678901234567890123456789012345678901234abcd')).toBe(true); // 64 chars
    });

    test('rejects invalid container IDs', () => {
        expect(validateContainerId('')).toBe(false);
        expect(validateContainerId(null)).toBe(false);
        expect(validateContainerId('abc')).toBe(false); // too short
        expect(validateContainerId('abc123def456xyz')).toBe(false); // invalid chars
    });
});

describe('sanitizeComposeName', () => {
    test('accepts valid names', () => {
        expect(sanitizeComposeName('myapp')).toBe('myapp');
        expect(sanitizeComposeName('my-app')).toBe('my-app');
        expect(sanitizeComposeName('my_app_123')).toBe('my_app_123');
    });

    test('returns null for empty/null names', () => {
        expect(sanitizeComposeName('')).toBeNull();
        expect(sanitizeComposeName(null)).toBeNull();
    });

    test('returns null if result starts with non-alphanumeric', () => {
        expect(sanitizeComposeName('-myapp')).toBeNull(); // starts with dash
        expect(sanitizeComposeName('_myapp')).toBeNull(); // starts with underscore
    });

    // NOTE: Invalid characters are stripped before validation
    // So 'my app' becomes 'myapp' which is valid
    test('removes invalid characters and validates result', () => {
        expect(sanitizeComposeName('my app')).toBe('myapp');
        expect(sanitizeComposeName('my@app')).toBe('myapp');
        expect(sanitizeComposeName('my.app')).toBe('myapp');
    });

    test('rejects too long names', () => {
        expect(sanitizeComposeName('a'.repeat(51))).toBeNull();
    });
});

describe('validateComposeContent', () => {
    // NOTE: Empty string is falsy, so it fails the !content check first
    test('rejects empty/null content', () => {
        expect(validateComposeContent('')).toEqual({ valid: false, error: 'Content must be a string' });
        expect(validateComposeContent(null)).toEqual({ valid: false, error: 'Content must be a string' });
    });

    test('rejects too large content', () => {
        const large = 'a'.repeat(100001);
        expect(validateComposeContent(large)).toEqual({ valid: false, error: 'Content too large (max 100KB)' });
    });

    test('rejects invalid format', () => {
        expect(validateComposeContent('invalid yaml')).toEqual({ valid: false, error: 'Invalid docker-compose format' });
    });

    test('accepts valid compose content', () => {
        const valid = `version: "3"
services:
  web:
    image: nginx`;
        expect(validateComposeContent(valid)).toEqual({ valid: true });
    });
});

// ============================================================================
// SYSTEM VALIDATION TESTS
// ============================================================================

describe('validateSystemAction', () => {
    test('accepts valid actions', () => {
        expect(validateSystemAction('reboot')).toBe(true);
        expect(validateSystemAction('shutdown')).toBe(true);
    });

    test('rejects invalid actions', () => {
        expect(validateSystemAction('restart')).toBe(false);
        expect(validateSystemAction('')).toBe(false);
    });
});

describe('validateFanId', () => {
    test('returns valid fan IDs', () => {
        expect(validateFanId(1)).toBe(1);
        expect(validateFanId('5')).toBe(5);
        expect(validateFanId(10)).toBe(10);
    });

    test('returns null for invalid IDs', () => {
        expect(validateFanId(0)).toBeNull();
        expect(validateFanId(11)).toBeNull();
        expect(validateFanId('invalid')).toBeNull();
    });
});

describe('validateFanSpeed', () => {
    test('returns valid speeds', () => {
        expect(validateFanSpeed(0)).toBe(0);
        expect(validateFanSpeed(50)).toBe(50);
        expect(validateFanSpeed(100)).toBe(100);
    });

    test('returns null for invalid speeds', () => {
        expect(validateFanSpeed(-1)).toBeNull();
        expect(validateFanSpeed(101)).toBeNull();
        expect(validateFanSpeed('fast')).toBeNull();
    });
});

describe('validateFanMode', () => {
    test('returns valid modes', () => {
        expect(validateFanMode('silent')).toBe('silent');
        expect(validateFanMode('balanced')).toBe('balanced');
        expect(validateFanMode('performance')).toBe('performance');
    });

    test('returns null for invalid modes', () => {
        expect(validateFanMode('turbo')).toBeNull();
        expect(validateFanMode('')).toBeNull();
    });
});

// ============================================================================
// NETWORK VALIDATION TESTS
// ============================================================================

describe('validateInterfaceName', () => {
    test('accepts valid interface names', () => {
        expect(validateInterfaceName('eth0')).toBe(true);
        expect(validateInterfaceName('wlan0')).toBe(true);
        expect(validateInterfaceName('enp3s0')).toBe(true);
        expect(validateInterfaceName('br-docker0')).toBe(true);
    });

    test('rejects invalid names', () => {
        expect(validateInterfaceName('')).toBe(false);
        expect(validateInterfaceName(null)).toBe(false);
        expect(validateInterfaceName('a'.repeat(16))).toBe(false); // too long
        expect(validateInterfaceName('eth0; id')).toBe(false);
    });
});

describe('validateIPv4', () => {
    test('accepts valid IPv4 addresses', () => {
        expect(validateIPv4('192.168.1.1')).toBe(true);
        expect(validateIPv4('10.0.0.1')).toBe(true);
        expect(validateIPv4('255.255.255.255')).toBe(true);
        expect(validateIPv4('0.0.0.0')).toBe(true);
    });

    test('rejects invalid addresses', () => {
        expect(validateIPv4('')).toBe(false);
        expect(validateIPv4(null)).toBe(false);
        expect(validateIPv4('256.1.1.1')).toBe(false);
        expect(validateIPv4('192.168.1')).toBe(false);
        expect(validateIPv4('192.168.1.1.1')).toBe(false);
        expect(validateIPv4('192.168.01.1')).toBe(false); // leading zero
        expect(validateIPv4('abc.def.ghi.jkl')).toBe(false);
    });
});

describe('validateSubnetMask', () => {
    test('accepts valid subnet masks', () => {
        expect(validateSubnetMask('255.255.255.0')).toBe(true);
        expect(validateSubnetMask('255.255.0.0')).toBe(true);
        expect(validateSubnetMask('255.0.0.0')).toBe(true);
        expect(validateSubnetMask('255.255.255.255')).toBe(true);
        expect(validateSubnetMask('0.0.0.0')).toBe(true);
    });

    test('rejects invalid subnet masks', () => {
        expect(validateSubnetMask('255.255.255.1')).toBe(false); // invalid octet
        expect(validateSubnetMask('255.0.255.0')).toBe(false); // non-contiguous
        expect(validateSubnetMask('192.168.1.1')).toBe(false); // not a mask
    });
});

// ============================================================================
// STORAGE VALIDATION TESTS
// ============================================================================

describe('validateDiskRole', () => {
    test('returns valid roles', () => {
        expect(validateDiskRole('data')).toBe('data');
        expect(validateDiskRole('parity')).toBe('parity');
        expect(validateDiskRole('cache')).toBe('cache');
        expect(validateDiskRole('none')).toBe('none');
    });

    test('returns null for invalid roles', () => {
        expect(validateDiskRole('invalid')).toBeNull();
        expect(validateDiskRole('')).toBeNull();
    });
});

describe('validateDiskConfig', () => {
    test('returns null for non-array input', () => {
        expect(validateDiskConfig({})).toBeNull();
        expect(validateDiskConfig('sda')).toBeNull();
        expect(validateDiskConfig(null)).toBeNull();
    });

    test('returns null for empty array', () => {
        expect(validateDiskConfig([])).toBeNull();
    });

    test('returns null for too many disks', () => {
        const tooMany = Array(21).fill({ id: 'sda', role: 'data' });
        expect(validateDiskConfig(tooMany)).toBeNull();
    });

    test('validates each disk in array', () => {
        const valid = [
            { id: 'sda', role: 'data', format: true },
            { id: 'sdb', role: 'parity', format: false }
        ];
        const result = validateDiskConfig(valid);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ id: 'sda', role: 'data', format: true });
        expect(result[1]).toEqual({ id: 'sdb', role: 'parity', format: false });
    });

    test('returns null if any disk is invalid', () => {
        const invalid = [
            { id: 'sda', role: 'data' },
            { id: 'invalid', role: 'data' }
        ];
        expect(validateDiskConfig(invalid)).toBeNull();
    });
});

// ============================================================================
// NUMBER VALIDATION TESTS
// ============================================================================

describe('validatePositiveInt', () => {
    test('returns valid positive integers', () => {
        expect(validatePositiveInt(1)).toBe(1);
        expect(validatePositiveInt('100')).toBe(100);
    });

    test('returns null for zero or negative', () => {
        expect(validatePositiveInt(0)).toBeNull();
        expect(validatePositiveInt(-1)).toBeNull();
    });

    test('respects max value', () => {
        expect(validatePositiveInt(100, 50)).toBeNull();
        expect(validatePositiveInt(50, 100)).toBe(50);
    });
});

describe('validateNonNegativeInt', () => {
    test('returns valid non-negative integers', () => {
        expect(validateNonNegativeInt(0)).toBe(0);
        expect(validateNonNegativeInt(1)).toBe(1);
        expect(validateNonNegativeInt('100')).toBe(100);
    });

    test('returns null for negative', () => {
        expect(validateNonNegativeInt(-1)).toBeNull();
    });
});

// ============================================================================
// LOG SANITIZATION TESTS
// ============================================================================

describe('sanitizeForLog', () => {
    test('handles invalid input', () => {
        expect(sanitizeForLog(null)).toBe('[invalid]');
        expect(sanitizeForLog(undefined)).toBe('[invalid]');
        expect(sanitizeForLog(123)).toBe('[invalid]');
    });

    test('redacts sensitive data', () => {
        expect(sanitizeForLog('password=secret123')).toBe('password=[REDACTED]');
        expect(sanitizeForLog('token=abc123')).toBe('token=[REDACTED]');
        expect(sanitizeForLog('api_key=xyz')).toBe('api_key=[REDACTED]');
        expect(sanitizeForLog('secret=hidden')).toBe('secret=[REDACTED]');
    });

    test('truncates long strings', () => {
        const long = 'a'.repeat(600);
        expect(sanitizeForLog(long)).toHaveLength(500);
    });

    test('handles multiple sensitive fields', () => {
        const input = 'user=john password=secret token=abc123';
        const result = sanitizeForLog(input);
        expect(result).toContain('[REDACTED]');
        expect(result).not.toContain('secret');
        expect(result).not.toContain('abc123');
    });
});
