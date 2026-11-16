module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/mail*.spec.ts"],
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  testTimeout: 10000,
};
