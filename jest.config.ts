// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'react-native',
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': 'babel-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@react-native-openai-realtime/(.*)$': '<rootDir>/src/$1',
    '^react-native$': 'react-native',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-native-community|@react-navigation)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx,js,jsx}',
    '!src/**/index.{ts,tsx,js,jsx}',
    '!src/**/types.{ts,tsx}',
    '!src/**/constants.{ts}',
    '!src/**/*.d.ts',
  ],
  coverageReporters: ['text', 'lcov', 'json', 'html'],
  verbose: true,
};

export default config;
