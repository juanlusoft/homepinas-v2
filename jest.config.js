/**
 * HomePiNAS - Jest Configuration
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/backend'],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'backend/**/*.js',
    '!backend/__tests__/**',
    '!backend/index.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 10000
};
