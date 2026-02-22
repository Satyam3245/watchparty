require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});
console.log(process.env.DATABASE_URL)
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id VARCHAR(100) PRIMARY KEY,
        video_id TEXT DEFAULT 'ikmY-nMFDQA',
        current_time_sec FLOAT DEFAULT 0,
        is_playing BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS participants (
        socket_id VARCHAR(100) PRIMARY KEY,
        room_id VARCHAR(100) REFERENCES rooms(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        role VARCHAR(20) NOT NULL,
        joined_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log("Database tables initialized");
  } catch (err) {
    console.error("DB Init Error:", err);
  }
};

initDB();

module.exports = pool;