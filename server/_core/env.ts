export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Open ID of the account that should be seeded as admin on first sign-in.
  // Set OWNER_OPEN_ID in the host env vars; leave empty to disable auto-admin.
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
};
