import { config } from "dotenv";
import { assertSafeTestDb } from "../_core/test-db-guard";
// Load .env.test if present; override shell/.env so a stray prod var can't win.
config({ path: ".env.test", override: true });
assertSafeTestDb(process.env);
