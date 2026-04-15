const isCI = process.env.GITHUB_ACTIONS === 'true';

// Test files that require a live MongoDB connection. These are skipped in CI
// because GitHub Actions cannot reliably connect to the service container from
// within the Jest worker processes (auth / networking issues).
const DB_TEST_PATTERNS = [
    '/tests/unit/features/db_manager.test.ts',
    '/tests/unit/features/db_manager.queue.test.ts',
    '/tests/unit/features/migration-resume.test.ts',
    '/tests/unit/features/server.test.ts',
];

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/migrator', '<rootDir>/tests'],
    testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                useESM: false,
            },
        ],
        '^.+\\.js$': [
            'ts-jest',
            {
                useESM: true,
            },
        ],
    },
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transformIgnorePatterns: ['node_modules/(?!(chalk)/)'],
    collectCoverageFrom: [
        'migrator/**/*.ts',
        '!migrator/**/*.d.ts',
        '!migrator/index.ts',
        '!migrator/scripts/**',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
    testTimeout: 30000,
    // Ignore node_modules and dist directories; also skip DB-dependent tests in CI
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/output/',
        ...(isCI ? DB_TEST_PATTERNS : []),
    ],
    // Transform ES modules from node_modules (like fakeium)
    transformIgnorePatterns: ['node_modules/(?!fakeium)'],
    // Prevent hanging processes
    forceExit: true,
    detectOpenHandles: true,
};
