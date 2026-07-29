console.error(
  "MIGRATION-MANIFEST.json is sealed migration-history evidence and must not be regenerated. " +
  "Use npm run generate:active-source-manifest for current source hashes.",
);
process.exit(2);
