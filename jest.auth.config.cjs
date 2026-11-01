module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/auth*.spec.ts"],
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  testTimeout: 20000,
};
