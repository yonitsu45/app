const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const flash = require('connect-flash');
const cron = require('node-cron');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const setupWebsocket = require('./routes/websocket');
const pageRoutes = require('./routes/pages');   
const addTokenRouter = require('./routes/addToken');
const alertCheck = require('./middleware/alertCheck');
const mailer = require('./middleware/mailer');

const app = express();
const server = http.createServer(app);
setupWebsocket(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'views')));

app.use(session({
  secret: 'secret123',
  resave: false,
  saveUninitialized: false
}));
app.use(flash());

const db = require('./db'); // ต้องมีบรรทัดนี้

app.use((req, res, next) => {
  if (req.session && req.session.user) {
    const userId = req.session.user.userID; 
    const sql = `
      SELECT dashboardID AS id, dashboardName AS name 
      FROM dashboards 
      WHERE userID = ? 
      ORDER BY dashboardName ASC
    `;
    
    db.query(sql, [userId], (err, dashboardList) => {
      if (err) {
        console.error("Error fetching dashboard list for navbar:", err);
        res.locals.dashboards = [];
      } else {
        res.locals.dashboards = dashboardList || []; // ส่งรายการ Dashboard
      }
      
      res.locals.user = req.session.user; // ส่งข้อมูล User
      next(); // ไปยัง Route ถัดไป
    });

  } else {
    // ถ้าไม่ได้ Login
    res.locals.user = null;
    res.locals.dashboards = [];
    next();
  }
});

app.use(alertCheck);
app.use(authRoutes);
app.use(dashboardRoutes);
app.use(pageRoutes);
app.use(addTokenRouter);

cron.schedule('*/10 * * * *', async () => {
    console.log('⏰ Running Task: ตรวจสอบระดับอาหาร/น้ำ...');

    try {
        // ดึงเครื่องที่ อาหาร/น้ำ ต่ำกว่า 200 (และยังไม่แจ้งเตือนใน 4 ชม. ที่ผ่านมา)
        const sql = `
            SELECT p.*, u.email 
            FROM petfeeders p
            JOIN users u ON p.userID = u.userID
            WHERE (p.foodlvl < 20 OR p.waterlvl < 20)
            AND (p.last_alert_time IS NULL OR p.last_alert_time < NOW() - INTERVAL 4 HOUR)
            AND p.isActive = 1
        `;

        const [feeders] = await db.promise().query(sql);

        if (feeders.length === 0) {
            console.log('✅ ทุกเครื่องปกติดี หรือยังไม่ถึงเวลาแจ้งเตือนซ้ำ (Cooldown)');
            return;
        }

        // วนลูปส่งเมล
        for (const feeder of feeders) {
            let msg = `อุปกรณ์ <b>${feeder.feederName}</b> แจ้งเตือน:<br>`;
            if (feeder.foodlvl < 20) msg += `- ⚠️ อาหารเหลือต่ำ (${feeder.foodlvl}%)<br>`;
            if (feeder.waterlvl < 20) msg += `- 💧 น้ำเหลือต่ำ (${feeder.waterlvl}%)<br>`;

            // สั่งให้ mailer.js ทำงาน
            await mailer.sendAlertEmail(feeder.email, '⚠️ แจ้งเตือน: อาหาร/น้ำ ใกล้หมด', msg);
            console.log(`📧 ส่งเมลหา ${feeder.email} สำเร็จ!`);

            // อัปเดตเวลาล่าสุด (เพื่อเริ่มนับ Cooldown ใหม่)
            await db.promise().query(
                "UPDATE petfeeders SET last_alert_time = NOW() WHERE feederID = ?", 
                [feeder.feederID]
            );
        }

    } catch (err) {
        console.error('❌ Cron Job Error:', err);
    }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`SERVER READY`);
});