# Integration Tests

This directory contains integration tests for the HomePiNAS Dashboard API.

## Test Files

- **auth.test.js** - Authentication flow tests (login, logout, session management)
- **storage.test.js** - Storage pool and disk management tests
- **users.test.js** - User management and role-based access control tests

## Running Tests

```bash
npm test tests/integration/
```

## Known Limitations

### Session Database (better-sqlite3)

The production application uses `better-sqlite3` for persistent session storage. In test environments where the native binding is not available, sessions may not work correctly, causing authentication tests to fail.

**Workaround**: The tests use `backend/test-app.js` which attempts to handle this gracefully, but full session support requires a properly compiled better-sqlite3 module.

### System Dependencies

Some endpoints require system-level access:
- Storage operations need `lsblk`, `df`, and disk access
- Samba operations require `smbpasswd` and sudo
- Docker operations need Docker daemon access

Tests may return 500 errors for these endpoints in restricted environments. This is expected behavior.

## Test Setup

The integration tests:
1. Create temporary test users with hashed passwords
2. Perform HTTP requests against the Express app
3. Validate response codes, headers, and body structure
4. Clean up test data after completion

Tests use `supertest` to make real HTTP requests without starting actual servers.

## CI/CD

For continuous integration, ensure:
- Node.js 20+ is installed
- better-sqlite3 native bindings are compiled for the target platform
- System tools (sudo, docker, etc.) are available if testing those features

##Future Improvements

- Mock system calls for storage/network tests
- Add database seeding for consistent test data
- Implement request recording/playback for external dependencies
