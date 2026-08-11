module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts'],
  coverageDirectory: 'coverage',
  moduleNameMapper: {
    '^@centaur/shared$': '<rootDir>/../shared/src/index.ts',
  },
};
