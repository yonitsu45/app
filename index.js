const express = require('express');
const session = require('express-session');
const path = require('path');
const authRoutes = require('./routes/auth');
const http = require('http');
const WebSocket = require('ws');
const flash = require('connect-flash');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'views')));

let lastImageBuffer = null;

//websocket camera
wss.on('connection', ws => {
  console.log('✅ WebSocket Connected');

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      console.log('Received image binary data:', data.length, 'bytes');
      lastImageBuffer = data;

      // broadcast ให้ทุก client ที่เป็น browser
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: true });
        }
      });
    } else {
      console.log('Message:', data.toString());
    }
  });
});

app.use(session({
  secret: 'secret123',
  resave: false,
  saveUninitialized: false
}));
app.use(flash());
app.use(authRoutes);

app.get('/', (req, res) => res.render('index'))
app.get('/index', (req, res) => {
  res.render('index', {
    user: req.session.user || null,
    message: req.session.successMessage || null
  });
  delete req.session.successMessage;
});
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register', { message: '' }));
app.get('/profile', (req, res) => res.render('profile'));
app.get('/dashboard', (req, res) => res.render('dashboard'));

server.listen(4000, () => {
  console.log(`WebSocket + Web server ready at http://localhost:4000`);
});