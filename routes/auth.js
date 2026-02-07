const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();
const { isLoggedIn } = require('../middleware/isLogged');

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

router.get('/dashboardcam', isLoggedIn, (req, res) => {
  res.render('dashboardcam', {
    user: req.session.user,
    dashboard: {
            feederID: 1, // ใส่ ID ให้ตรงกับที่ ESP32 คุณเชื่อมต่อ (ดูใน Database)
            dashboardName: "Camera Test"
        }
  });
});

router.get('/testboard', isLoggedIn, (req, res) => {
  res.render('testboard', {
    user: req.session.user
  });
});

// routes/pages.js หรือไฟล์ router ที่คุณใช้
router.get('/admindashboard', isLoggedIn, async (req, res) => {
    //admin checking
    if (req.session.user.urole !== 'admin') {
        return res.redirect('/index');
    }

    try {
        //pull user
        const [users] = await db.promise().query('SELECT * FROM users ORDER BY urole ASC');
        //join table
        const sqlFeeders = `
            SELECT p.*, u.username as ownerName 
            FROM petfeeders p 
            LEFT JOIN users u ON p.userID = u.userID 
            ORDER BY p.feederID ASC
        `;
        const [feeders] = await db.promise().query(sqlFeeders);

        // 3. ส่งข้อมูลทั้ง 2 ก้อนไปที่หน้า admin.ejs
        res.render('admindashboard', {
            user: req.session.user, // สำหรับ Navbar
            allUsers: users,
            allFeeders: feeders
        });

    } catch (err) {
        console.error(err);
        res.redirect('/index');
    }
});

module.exports = router;