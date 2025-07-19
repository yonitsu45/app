const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();

function isLoggedIn(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// Register
router.post('/register', async (req, res) => {
  const { username, email, password, passwordCon } = req.body;

   if (!username || !email || !password || !passwordCon) {
    return res.render('register', {
      message: 'กรุณากรอกให้ครบทุกช่อง',
      error: true
    });
  }

  //username requirement
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (!usernameRegex.test(username)) {
    return res.render('register', {
      message: 'ชื่อผู้ใช้ห้ามมีตัวอักษรพิเศษ',
      error: true
    });
  }

  // password requirement
  if (password.length < 6 || password.length > 20) {
    return res.render('register', {
      message: 'รหัสผ่านต้องขั้นต่ำ 6 ตัว',
      error: true
    });
  }

  //confirm password
  if (password !== passwordCon) {
    return res.render('register', {
      message: 'รหัสผ่านไม่ตรงกัน',
      error: true
    });
  }

  const hashedPassword = await bcrypt.hash(password, 8);

  db.query('INSERT INTO users SET ?', { username, email, password: hashedPassword, urole: "user" }, (err) => {
    if (err) {
      console.log(err);
      return res.render('register', { message: 'Error creating user' });
    }

    return res.render('register', {
        message: 'สมัครสมาชิกสำเร็จ',
        error: false
    });
  });
});

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', {
      message: 'กรุณากรอกอีเมลและรหัสผ่าน',
      error: true
    });
  }

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) throw err;

    if (!results.length || !(await bcrypt.compare(password, results[0].password))) {
      return res.render('login', { message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',error: true });
    }

    req.session.user = results[0];
    return res.render('login', {
      message: 'ล็อกอินสำเร็จ',
      error: false
    });
  });
});

//Profile
router.get('/profile', isLoggedIn, (req, res) => {
  res.render('profile', {
    user: req.session.user
  });
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.render('login', {
    message: 'ออกจากระบบสำเร็จ',
    error: true
  });
});

router.get('/dashboard', isLoggedIn, (req, res) => {
  res.render('dashboard', {
    user: req.session.user
  });
});

module.exports = router;