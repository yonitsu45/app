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

const db = require('./db'); // เพิ่มบรรทัดนี้ด้วย

app.use(async (req, res, next) => {
  if (req.session && req.session.user) {
    const userId = req.session.user.id;
    db.query('SELECT * FROM dashboards WHERE user_id = ?', [userId], (err, results) => {
      if (err) {
        console.error(err);
        res.locals.dashboards = [];
        return next();
      }
      res.locals.user = req.session.user;
      res.locals.dashboards = results || [];
      next();
    });
  } else {
    res.locals.user = null;
    res.locals.dashboards = [];
    next();
  }
});

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(pageRoutes);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.dashboards = []; // ✅ ป้องกัน undefined
  next();
});

server.listen(4000, () => {
  console.log(`WebSocket + Web server ready at http://localhost:4000`);
});