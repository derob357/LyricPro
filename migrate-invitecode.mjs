import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const connection = await mysql.createConnection({
  uri: DATABASE_URL,
  ssl: "Amazon RDS",
});

const sql = `
ALTER TABLE \`game_rooms\` ADD \`inviteCode\` varchar(6);
ALTER TABLE \`game_rooms\` ADD \`inviteExpiresAt\` timestamp;
ALTER TABLE \`game_rooms\` ADD CONSTRAINT \`game_rooms_inviteCode_unique\` UNIQUE(\`inviteCode\`);
`;

try {
  for (const statement of sql.split(";").filter(s => s.trim())) {
    console.log("Executing:", statement.trim());
    await connection.execute(statement);
  }
  console.log("✅ Migration completed successfully");
} catch (error) {
  console.error("❌ Migration failed:", error.message);
  process.exit(1);
} finally {
  await connection.end();
}
