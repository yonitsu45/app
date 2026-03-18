const mysql = require('mysql2');
require('dotenv').config();

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smartpet',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

db.getConnection((err, connection) => {
  if (err) {
      console.error('❌ Database Connection Failed:', err.code);
      console.error(err);
  } else {
      console.log('✅ Connected to MySQL via Pool');
      connection.release();
  }
});

module.exports = db;

