/**
 * HomePiNAS - Data Utility Tests
 * Tests for data persistence utilities
 */

// Mock fs synchronous methods
jest.mock('fs', () => ({
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn()
}));

const fs = require('fs');
const { getData, saveData, DATA_FILE, initialState } = require('../../utils/data');

// Get mock references
const mockExistsSync = fs.existsSync;
const mockMkdirSync = fs.mkdirSync;
const mockReadFileSync = fs.readFileSync;
const mockWriteFileSync = fs.writeFileSync;

const mockData = {
    user: { username: 'admin' },
    users: [{ username: 'admin' }, { username: 'user1' }],
    storageConfig: [],
    network: {
        interfaces: [],
        ddns: []
    },
    notifications: {
        email: null,
        telegram: null,
        history: []
    },
    backups: [],
    scheduledTasks: [],
    ups: {
        config: {
            lowBatteryThreshold: 30
        },
        history: []
    }
};

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
    console.error.mockRestore();
});

beforeEach(() => {
    // Reset mocks
    mockExistsSync.mockReset();
    mockMkdirSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
});

describe('getData', () => {
    test('reads data from existing file', () => {
        mockExistsSync.mockImplementation((path) => {
            if (path.includes('config')) return true; // config dir exists
            if (path.includes('data.json')) return true; // data file exists
            return false;
        });
        mockReadFileSync.mockReturnValue(JSON.stringify(mockData));

        const result = getData();

        expect(result).toEqual(mockData);
        expect(mockReadFileSync).toHaveBeenCalledWith(DATA_FILE, 'utf8');
    });

    test('creates file with initial state when file does not exist', () => {
        mockExistsSync.mockImplementation((path) => {
            if (path.includes('config')) return true; // config dir exists
            if (path.includes('data.json')) return false; // data file doesn't exist
            return false;
        });

        const result = getData();

        expect(result).toEqual(initialState);
        expect(mockWriteFileSync).toHaveBeenCalledWith(
            DATA_FILE,
            JSON.stringify(initialState, null, 2)
        );
    });

    test('creates config directory when it does not exist', () => {
        mockExistsSync.mockImplementation((path) => {
            if (path.includes('config')) return false; // config dir doesn't exist
            if (path.includes('data.json')) return false; // data file doesn't exist
            return false;
        });

        getData();

        expect(mockMkdirSync).toHaveBeenCalledWith(
            expect.stringContaining('config'),
            { recursive: true, mode: 0o700 }
        );
    });

    test('handles JSON parse errors and recreates file', () => {
        mockExistsSync.mockImplementation((path) => {
            if (path.includes('config')) return true;
            if (path.includes('data.json')) return true;
            return false;
        });
        mockReadFileSync.mockReturnValue('invalid-json{');

        const result = getData();

        expect(result).toEqual(initialState);
        expect(mockWriteFileSync).toHaveBeenCalledWith(
            DATA_FILE,
            JSON.stringify(initialState, null, 2)
        );
    });

    test('handles file read errors and recreates file', () => {
        mockExistsSync.mockImplementation((path) => {
            if (path.includes('config')) return true;
            if (path.includes('data.json')) return true;
            return false;
        });
        mockReadFileSync.mockImplementation(() => {
            throw new Error('Permission denied');
        });

        const result = getData();

        expect(result).toEqual(initialState);
        expect(mockWriteFileSync).toHaveBeenCalledWith(
            DATA_FILE,
            JSON.stringify(initialState, null, 2)
        );
    });
});

describe('saveData', () => {
    test('saves data to file successfully', () => {
        mockExistsSync.mockReturnValue(true); // config dir exists

        saveData(mockData);

        expect(mockWriteFileSync).toHaveBeenCalledWith(
            DATA_FILE,
            JSON.stringify(mockData, null, 2),
            { mode: 0o600 }
        );
    });

    test('creates config directory if it does not exist', () => {
        mockExistsSync.mockReturnValue(false); // config dir doesn't exist

        saveData(mockData);

        expect(mockMkdirSync).toHaveBeenCalledWith(
            expect.stringContaining('config'),
            { recursive: true, mode: 0o700 }
        );
        expect(mockWriteFileSync).toHaveBeenCalledWith(
            DATA_FILE,
            JSON.stringify(mockData, null, 2),
            { mode: 0o600 }
        );
    });

    test('handles file write error', () => {
        mockExistsSync.mockReturnValue(true);
        mockWriteFileSync.mockImplementation(() => {
            throw new Error('Disk full');
        });

        expect(() => saveData(mockData)).toThrow('Failed to save configuration');
    });

    test('formats JSON with proper indentation', () => {
        mockExistsSync.mockReturnValue(true);

        const simpleData = { test: 'value' };
        saveData(simpleData);

        expect(mockWriteFileSync).toHaveBeenCalledWith(
            DATA_FILE,
            '{\n  "test": "value"\n}',
            { mode: 0o600 }
        );
    });

    test('saves data with secure file permissions', () => {
        mockExistsSync.mockReturnValue(true);

        saveData(mockData);

        expect(mockWriteFileSync).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            { mode: 0o600 }
        );
    });
});

describe('initialState and DATA_FILE', () => {
    test('initialState contains expected structure', () => {
        expect(initialState).toHaveProperty('user');
        expect(initialState).toHaveProperty('users');
        expect(initialState).toHaveProperty('storageConfig');
        expect(initialState).toHaveProperty('network');
        expect(initialState).toHaveProperty('notifications');
        expect(initialState).toHaveProperty('backups');
        expect(initialState).toHaveProperty('scheduledTasks');
        expect(initialState).toHaveProperty('ups');
        
        expect(initialState.network).toHaveProperty('interfaces');
        expect(initialState.network).toHaveProperty('ddns');
        expect(initialState.notifications).toHaveProperty('email');
        expect(initialState.notifications).toHaveProperty('telegram');
        expect(initialState.notifications).toHaveProperty('history');
        expect(initialState.ups).toHaveProperty('config');
        expect(initialState.ups).toHaveProperty('history');
    });

    test('DATA_FILE points to correct path', () => {
        expect(DATA_FILE).toContain('config');
        expect(DATA_FILE).toContain('data.json');
    });

    test('initialState has sensible defaults', () => {
        expect(initialState.user).toBeNull();
        expect(initialState.users).toEqual([]);
        expect(initialState.storageConfig).toEqual([]);
        expect(initialState.backups).toEqual([]);
        expect(initialState.scheduledTasks).toEqual([]);
        
        expect(initialState.ups.config.lowBatteryThreshold).toBe(30);
        expect(initialState.ups.config.criticalThreshold).toBe(10);
        expect(initialState.ups.config.notifyOnPower).toBe(true);
        expect(initialState.ups.config.shutdownOnCritical).toBe(false);
    });
});