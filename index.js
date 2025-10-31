const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const flash = require('connect-flash');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const setupWebsocket = require('./routes/websocket');
const pageRoutes = require('./routes/pages');   

const app = express();
const server = http.createServer(app);
setupWebsocket(server);

app.use(express.urlencoded({ extended: false }));
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

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(pageRoutes);

server.listen(4000, () => {
  console.log(`WebSocket + Web server ready at http://localhost:4000`);
});