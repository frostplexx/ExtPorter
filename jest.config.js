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
    // Ignore node_modules and dist directories
    testPathIgnorePatterns: ['/node_modules/', '/dist/', '/output/'],
    // Transform ES modules from node_modules (like fakeium)
    transformIgnorePatterns: [
        'node_modules/(?!fakeium)'
    ],
    // Prevent hanging processes
    forceExit: true,
    detectOpenHandles: true,
};
