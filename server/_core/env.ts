export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  liveKitApiKey: process.env.LIVEKIT_API_KEY ?? "",
  liveKitApiSecret: process.env.LIVEKIT_API_SECRET ?? "",
  liveKitUrl: process.env.LIVEKIT_URL ?? "",
};
