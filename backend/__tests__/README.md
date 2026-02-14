# HomePiNAS Tests

Unit tests for HomePiNAS backend using Jest.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (re-run on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run specific test file
npm test -- --testPathPatterns="auth"
```

## Test Structure

```
backend/__tests__/
├── utils/
│   ├── sanitize.test.js    # Input validation/sanitization (88 tests)
│   └── security.test.js    # Security logging, safeExec, safeRemove (15 tests)
├── middleware/
│   ├── auth.test.js        # Authentication middleware (6 tests)
│   ├── csrf.test.js        # CSRF token protection (27 tests)
│   └── rbac.test.js        # Role-based access control (20 tests)
├── routes/
│   ├── auth.test.js        # Auth API endpoints (20 tests)
│   ├── files.test.js       # File Station API (33 tests)
│   ├── storage.test.js     # Storage/disk management (23 tests)
│   └── users.test.js       # User management API (17 tests)
└── README.md
```

## Coverage Summary

Current coverage (as of 2026-02-14):

| Category | File | Tests |
|----------|------|-------|
| Utils | sanitize.js | 88 |
| Utils | security.js | 15 |
| Middleware | auth.js | 6 |
| Middleware | csrf.js | 27 |
| Middleware | rbac.js | 20 |
| Routes | auth.js | 20 |
| Routes | files.js | 33 |
| Routes | storage.js | 23 |
| Routes | users.js | 17 |
| **Total** | | **249** |

## CI Integration

Tests run automatically via GitHub Actions on:
- Every push to `develop` and `main`
- Pull requests to these branches

See `.github/workflows/test.yml` for configuration.

## Adding New Tests

1. Create test file in appropriate directory
2. Name file with `.test.js` suffix
3. Use Jest's `describe`/`test` structure
4. Mock external dependencies with `jest.mock()`

### Example Route Test

```javascript
const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
    requireAuth: (req, res, next) => {
        req.user = { username: 'testuser' };
        next();
    }
}));

const myRouter = require('../../routes/myRoute');
const app = express();
app.use(express.json());
app.use('/api/my', myRouter);

describe('GET /api/my/endpoint', () => {
    test('returns data', async () => {
        const res = await request(app).get('/api/my/endpoint');
        expect(res.status).toBe(200);
    });
});
```

## Mocking Guidelines

- **External commands**: Mock `child_process.execFile` / `execSync`
- **File system**: Mock `fs` module
- **Data store**: Mock `../utils/data` → `getData()`, `saveData()`
- **Session**: Mock `../utils/session` → `validateSession()`, `createSession()`
- **Auth middleware**: Mock to inject `req.user`

## Notes

- Tests use `--forceExit` to handle CSRF cleanup interval
- Coverage reports generated in `coverage/` directory
- Mock functions are cleared between tests with `jest.clearAllMocks()`
- Use `supertest` for HTTP request testing in route tests
