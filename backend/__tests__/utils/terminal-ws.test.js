/**
 * HomePiNAS - Terminal WebSocket Utility Tests
 * Tests for WebSocket-based terminal access utilities
 */

// Mock child_process
const mockTerminal = {
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    stdin: { write: jest.fn() },
    on: jest.fn(),
    kill: jest.fn(),
    pid: 1234
};

jest.mock('child_process', () => ({
    spawn: jest.fn(() => mockTerminal)
}));

// Mock WebSocket
jest.mock('ws', () => ({
    OPEN: 1
}));

// Mock utils
jest.mock('../../utils/session', () => ({
    validateSession: jest.fn()
}));

jest.mock('../../utils/security', () => ({
    logSecurityEvent: jest.fn()
}));

const { spawn } = require('child_process');
const { validateSession } = require('../../utils/session');
const { logSecurityEvent } = require('../../utils/security');
const {
    validateCommand,
    createTerminalSession,
    sendInput,
    killSession,
    getActiveSessions,
    ALLOWED_COMMANDS,
    activeSessions
} = require('../../utils/terminal-ws');

const mockWS = {
    readyState: 1,
    send: jest.fn(),
    close: jest.fn()
};

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
    console.error.mockRestore();
    console.warn.mockRestore();
});

beforeEach(() => {
    // Clear any sessions if activeSessions is available
    if (activeSessions && activeSessions.clear) {
        activeSessions.clear();
    }
    jest.clearAllMocks();
});

describe('ALLOWED_COMMANDS', () => {
    test('contains expected system commands', () => {
        expect(ALLOWED_COMMANDS).toContain('bash');
        expect(ALLOWED_COMMANDS).toContain('ls');
        expect(ALLOWED_COMMANDS).toContain('docker');
        expect(ALLOWED_COMMANDS).toContain('htop');
    });

    test('is an array with reasonable length', () => {
        expect(Array.isArray(ALLOWED_COMMANDS)).toBe(true);
        expect(ALLOWED_COMMANDS.length).toBeGreaterThan(10);
    });
});

describe('validateCommand', () => {
    test('allows valid commands', () => {
        expect(validateCommand('bash')).toBe(true);
        expect(validateCommand('ls -la')).toBe(true);
        expect(validateCommand('docker ps')).toBe(true);
    });

    test('rejects empty or invalid commands', () => {
        expect(validateCommand('')).toBe(false);
        expect(validateCommand(null)).toBe(false);
        expect(validateCommand('malicious-command')).toBe(false);
    });

    test('rejects dangerous commands', () => {
        expect(validateCommand('sudo ls')).toBe(false);
        expect(validateCommand('su root')).toBe(false);
        expect(validateCommand('ls && rm file')).toBe(false);
        expect(validateCommand('ls || echo done')).toBe(false);
        expect(validateCommand('ls; rm file')).toBe(false);
    });

    test('handles whitespace correctly', () => {
        expect(validateCommand('  ls  ')).toBe(true);
        expect(validateCommand('\tbash\n')).toBe(true);
    });
});

describe('createTerminalSession', () => {
    test('creates session successfully', () => {
        const result = createTerminalSession('session1', mockWS, 'bash');

        expect(result).toBe(mockTerminal);
        expect(spawn).toHaveBeenCalledWith('bash', [], expect.objectContaining({
            stdio: ['pipe', 'pipe', 'pipe'],
            env: expect.objectContaining({
                TERM: 'xterm-256color'
            })
        }));
        expect(activeSessions.has('session1')).toBe(true);
        expect(mockWS.send).toHaveBeenCalledWith(
            JSON.stringify({ type: 'ready', sessionId: 'session1' })
        );
    });

    test('rejects invalid commands', () => {
        const result = createTerminalSession('session1', mockWS, 'malicious-cmd');

        expect(result).toBeNull();
        expect(spawn).not.toHaveBeenCalled();
        expect(mockWS.send).toHaveBeenCalledWith(
            expect.stringContaining('not allowed for security reasons')
        );
    });

    test('defaults to bash', () => {
        createTerminalSession('session1', mockWS);
        expect(spawn).toHaveBeenCalledWith('bash', [], expect.any(Object));
    });

    test('sets up event handlers', () => {
        createTerminalSession('session1', mockWS, 'bash');

        expect(mockTerminal.stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
        expect(mockTerminal.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
        expect(mockTerminal.on).toHaveBeenCalledWith('exit', expect.any(Function));
        expect(mockTerminal.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
});

describe('sendInput', () => {
    test('sends input to existing session', () => {
        createTerminalSession('session1', mockWS, 'bash');
        
        const result = sendInput('session1', 'ls\n');

        expect(result).toBe(true);
        expect(mockTerminal.stdin.write).toHaveBeenCalledWith('ls\n');
    });

    test('returns false for non-existent session', () => {
        const result = sendInput('nonexistent', 'ls\n');
        expect(result).toBe(false);
    });

    test('handles write error', () => {
        createTerminalSession('session1', mockWS, 'bash');
        mockTerminal.stdin.write.mockImplementation(() => {
            throw new Error('Write failed');
        });

        const result = sendInput('session1', 'ls\n');
        expect(result).toBe(false);
    });
});

describe('killSession', () => {
    test('kills existing session', () => {
        createTerminalSession('session1', mockWS, 'bash');

        const result = killSession('session1');

        expect(result).toBe(true);
        expect(mockTerminal.kill).toHaveBeenCalled();
        expect(activeSessions.has('session1')).toBe(false);
    });

    test('returns false for non-existent session', () => {
        const result = killSession('nonexistent');
        expect(result).toBe(false);
    });

    test('handles kill error', () => {
        createTerminalSession('session1', mockWS, 'bash');
        mockTerminal.kill.mockImplementation(() => {
            throw new Error('Kill failed');
        });

        const result = killSession('session1');
        expect(result).toBe(false);
    });
});

describe('getActiveSessions', () => {
    test('returns empty array when no sessions', () => {
        const sessions = getActiveSessions();
        expect(sessions).toEqual([]);
    });

    test('returns session information', () => {
        const startTime = Date.now();
        jest.spyOn(Date, 'now')
            .mockReturnValueOnce(startTime) // createTerminalSession call
            .mockReturnValueOnce(startTime + 5000); // getActiveSessions call

        createTerminalSession('session1', mockWS, 'bash');
        const sessions = getActiveSessions();

        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({
            sessionId: 'session1',
            command: 'bash',
            startTime: startTime,
            uptime: 5000
        });

        Date.now.mockRestore();
    });
});