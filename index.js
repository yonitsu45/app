const express = require('express');
const session = require('express-session');
const path = require('path');
const authRoutes = require('./routes/auth');
const http = require('http');
const flash = require('connect-flash');
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
app.use(authRoutes);
app.use(pageRoutes);

server.listen(4000, () => {
  console.log(`WebSocket + Web server ready at http://localhost:4000`);
});