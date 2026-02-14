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
└── README.md
```

## Coverage

Current coverage (as of 2026-02-14):
- **156 tests** across 5 test suites
- Utils: sanitize.js, security.js
- Middleware: auth.js, csrf.js, rbac.js

### Adding New Tests

1. Create test file in appropriate directory (`__tests__/utils/` or `__tests__/middleware/`)
2. Name file with `.test.js` suffix
3. Use Jest's `describe`/`test` structure
4. Mock external dependencies with `jest.mock()`

### Example Test

```javascript
const { myFunction } = require('../../utils/myModule');

describe('myFunction', () => {
    test('does something correctly', () => {
        expect(myFunction('input')).toBe('expected');
    });

    test('handles errors', () => {
        expect(() => myFunction(null)).toThrow();
    });
});
```

## Mocking Guidelines

- **External commands**: Mock `child_process.execFile`
- **File system**: Mock `fs.promises`
- **Data store**: Mock `../utils/data` → `getData()`
- **Session**: Mock `../utils/session` → `validateSession()`

## CI Integration

Tests run automatically on:
- Every push to `develop` and `main`
- Pull requests

Add to GitHub Actions workflow:
```yaml
- name: Run tests
  run: npm test
```

## Notes

- Tests use `--forceExit` to handle CSRF cleanup interval
- Coverage reports generated in `coverage/` directory
- Mock functions are cleared between tests with `jest.clearAllMocks()`
