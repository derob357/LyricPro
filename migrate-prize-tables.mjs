import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

// Parse connection string
const url = new URL(DATABASE_URL);
const config = {
  host: url.hostname,
  port: url.port || 3306,
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  ssl: {
    rejectUnauthorized: false,
  },
};

async function migrate() {
  let connection;
  try {
    connection = await mysql.createConnection(config);
    console.log('✓ Connected to database');

    // Read migration SQL
    const sqlPath = path.join(__dirname, 'drizzle', '0003_graceful_inhumans.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    // Split by statement breakpoint
    const statements = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(s => s);

    for (const statement of statements) {
      try {
        await connection.execute(statement);
        console.log('✓ Executed:', statement.split('\n')[0].substring(0, 60) + '...');
      } catch (err) {
        if (err.code === 'ER_TABLE_EXISTS_ERROR') {
          console.log('⚠ Table already exists, skipping');
        } else {
          throw err;
        }
      }
    }

    console.log('✓ Migration completed successfully');
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

migrate();
