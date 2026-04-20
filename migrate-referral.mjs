import mysql from 'mysql2/promise';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

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

const sql = `
CREATE TABLE IF NOT EXISTS referral_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL UNIQUE,
  referralCode VARCHAR(16) NOT NULL UNIQUE,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS referral_signups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  referrerId INT NOT NULL,
  referredUserId INT NOT NULL,
  referralCode VARCHAR(16) NOT NULL,
  signupDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  rewardClaimed TINYINT DEFAULT 0,
  rewardAmount FLOAT DEFAULT 0,
  rewardClaimedDate TIMESTAMP NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (referrerId) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (referredUserId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_referral (referrerId, referredUserId)
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  referrerId INT NOT NULL,
  totalReferrals INT DEFAULT 0,
  totalRewardsEarned FLOAT DEFAULT 0,
  totalRewardsClaimed FLOAT DEFAULT 0,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (referrerId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_referrer (referrerId)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSON,
  \`read\` TINYINT DEFAULT 0,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_read (userId, \`read\`),
  INDEX idx_created_at (createdAt)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL UNIQUE,
  emailNotifications TINYINT DEFAULT 1,
  inAppNotifications TINYINT DEFAULT 1,
  pushNotifications TINYINT DEFAULT 1,
  referralNotifications TINYINT DEFAULT 1,
  gameResultNotifications TINYINT DEFAULT 1,
  leaderboardNotifications TINYINT DEFAULT 1,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
`;

async function migrate() {
  let connection;
  try {
    connection = await mysql.createConnection(config);
    console.log('✓ Connected to database');

    const statements = sql.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await connection.execute(statement);
          console.log('✓ Executed:', statement.substring(0, 50) + '...');
        } catch (err) {
          if (err.code === 'ER_TABLE_EXISTS_ERROR') {
            console.log('⚠ Table already exists, skipping');
          } else {
            throw err;
          }
        }
      }
    }
    console.log('✓ All migrations completed successfully');
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

migrate();
