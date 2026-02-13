const mysql = require('mysql2');
require('dotenv').config();

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '', // เช็คดีๆ ว่าบน Server มีรหัสไหม
  database: process.env.DB_NAME || 'smartpet',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// เช็คว่าต่อติดไหม (แบบ Pool ต้องใช้ getConnection)
db.getConnection((err, connection) => {
  if (err) {
      console.error('❌ Database Connection Failed:', err.code);
      console.error(err);
  } else {
      console.log('✅ Connected to MySQL via Pool');
      connection.release(); // คืน Connection กลับเข้าบ่อ
  }
});

module.exports = db;