const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();
const crypto = require('crypto');
const mailer = require('../middleware/mailer');
const { isLoggedIn } = require('../middleware/isLogged');
const { error } = require('console');

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
      return res.render('register', { 
        message: 'Error creating user',
        error: true });
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
    // admin checking
    if (req.session.user.urole !== 'admin') {
        return res.redirect('/index');
    }

    try {
        // pull
        const [users] = await db.promise().query('SELECT * FROM users ORDER BY urole ASC');

        //join table
        const sqlFeeders = `
            SELECT p.*, u.email as ownerEmail 
            FROM petfeeders p 
            LEFT JOIN users u ON p.userID = u.userID 
            ORDER BY p.feederID ASC
        `;
        const [feeders] = await db.promise().query(sqlFeeders);

        // 3. ส่งข้อมูลไปหน้า EJS
        res.render('admindashboard', {
            user: req.session.user, 
            allUsers: users,
            allFeeders: feeders
        });

    } catch (err) {
        console.error(err);
        res.redirect('/index');
    }
});

router.post('/user/update', async (req, res) => {
    // 1. เช็ค Login
    if (!req.session.user) {
        return res.redirect('/login');
    }

    // 2. รับค่าจากฟอร์ม (รวมถึง email)
    const { targetID, username, email, newPassword, confirmPassword } = req.body;
    const currentUser = req.session.user;

    // 🔥🔥🔥 3. ส่วนที่หายไป: คำนวณว่ากำลังแก้ ID ไหน? 🔥🔥🔥
    let idToUpdate; // ประกาศตัวแปรมารรอไว้ก่อน
    
    if (currentUser.urole === 'admin' && targetID) {
        // ถ้าเป็น Admin และมี targetID ส่งมา -> แก้ให้คนอื่น
        idToUpdate = targetID;
    } else {
        // ถ้าเป็น User ธรรมดา หรือ Admin แก้ของตัวเอง -> ใช้ ID ตัวเอง
        idToUpdate = currentUser.userID; 
    }

    // อัปเดต username และ email
    let sql = "UPDATE users SET username = ?, email = ?";
    let params = [username, email];

    // 5. เช็คเรื่องเปลี่ยนรหัสผ่าน
    if (newPassword || confirmPassword) {
        if (newPassword !== confirmPassword) {
            return res.send("<script>alert('รหัสผ่านไม่ตรงกัน'); window.history.back();</script>");
        }
        if (newPassword.length < 6) {
             return res.send("<script>alert('รหัสผ่านต้องมีอย่างน้อย 6 ตัว'); window.history.back();</script>");
        }
        // Hash รหัสผ่าน
        const hashedPassword = await bcrypt.hash(newPassword, 8);
        
        sql += ", password = ?";
        params.push(hashedPassword);
    }

    // 6. ใส่เงื่อนไข WHERE (ใช้ idToUpdate ที่คำนวณไว้ข้อ 3)
    sql += " WHERE userID = ?";
    params.push(idToUpdate);

    // 7. ยิงลง Database
    db.query(sql, params, (err, result) => {
        if (err) {
            console.error(err);
            return res.send("<script>alert('เกิดข้อผิดพลาด: Email อาจจะซ้ำหรือระบบมีปัญหา'); window.history.back();</script>");
        }

        // 8. อัปเดต Session (ถ้าแก้ของตัวเอง)
        if (idToUpdate == currentUser.userID) {
            req.session.user.username = username;
            req.session.user.email = email; // อัปเดต email ใน session ด้วย
        }

        // 9. ส่งกลับหน้าเดิม
        if (currentUser.urole === 'admin' && idToUpdate != currentUser.userID) {
            res.redirect('/admindashboard');
        } else {
            res.redirect('/profile');
        }
    });
});

router.post('/feeder/update', async (req, res) => {
    //admin checking
    if (!req.session.user || req.session.user.urole !== 'admin') {
        return res.redirect('/login');
    }

    const { feederID, feederName, ownerID } = req.body;

    //null owner
    let newOwner = ownerID ? ownerID : null;

    try {
        //owner changing check
        const [rows] = await db.promise().query(
            "SELECT userID FROM petfeeders WHERE feederID = ?", 
            [feederID]
        );
        
        const currentOwner = rows[0] ? rows[0].userID : null;
        
        //reset config check
        if (newOwner != currentOwner) {
            await db.promise().query("DELETE FROM feedconfig WHERE feederID = ?", [feederID]);
            console.log(`Reset schedule for feeder ${feederID} due to ownership change.`);
        }

        //update
        if (newOwner === null) {
            //no owner
            await db.promise().query(
                "UPDATE petfeeders SET feederName = ?, userID = NULL, isActive = 0 WHERE feederID = ?", 
                [feederName, feederID]
            );
            //delete dashboard with no owner
            await db.promise().query("DELETE FROM dashboards WHERE feederID = ?", [feederID]);

        } else {
            //owner changing
            await db.promise().query(
                "UPDATE petfeeders SET feederName = ?, userID = ? WHERE feederID = ?", 
                [feederName, newOwner, feederID]
            );

            //update owndership
            await db.promise().query(
                "UPDATE dashboards SET userID = ?, dashboardName = ? WHERE feederID = ?", 
                [newOwner, feederName, feederID]
            );
        }
        
        res.redirect('/admindashboard');

    } catch (err) {
        console.error(err);
        res.send("<script>alert('Error updating feeder: " + err.message + "'); window.history.back();</script>");
    }
});

router.get('/api/feeder/status/:id', async (req, res) => {
    try {
        const feederID = req.params.id;
        
        // ดึงค่าล่าสุดจาก Database
        const [rows] = await db.promise().query(
            "SELECT foodlvl AS foodLevel, waterlvl AS waterLevel, isActive FROM petfeeders WHERE feederID = ?", 
            [feederID]
        );

        if (rows.length > 0) {
            // ส่งค่ากลับไปเป็น JSON
            res.json(rows[0]); 
        } else {
            res.status(404).json({ error: "Not found" });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server Error" });
    }
});

//////////
router.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { message: null }); // ต้องสร้างไฟล์ forgot-password.ejs ด้วยนะ
});

// 2. รับอีเมลแล้วส่งลิงก์ (POST)
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        // เช็คว่ามีอีเมลนี้ไหม
        const [users] = await db.promise().query("SELECT * FROM users WHERE email = ?", [email]);
        if (users.length === 0) {
            return res.render('forgot-password', { message: 'ไม่พบอีเมลนี้ในระบบ' });
        }

        // สร้าง Token มั่วๆ ขึ้นมา
        const token = crypto.randomBytes(32).toString('hex');
        // ตั้งเวลาหมดอายุ 1 ชั่วโมง
        const expireTime = new Date(Date.now() + 3600000); // 1 hour

        // บันทึก Token ลง DB
        await db.promise().query(
            "UPDATE users SET reset_token = ?, reset_expires = ? WHERE email = ?", 
            [token, expireTime, email]
        );

        // ส่งเมล
        await mailer.sendResetPasswordEmail(email, token);

        res.render('forgot-password', { message: 'ส่งลิงก์กู้คืนรหัสผ่านไปทางอีเมลแล้ว กรุณาเช็ค Inbox หรือ Junk Mail', error: false});

    } catch (err) {
        console.error(err);
        res.send("Error sending email");
    }
});

router.get('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    
    // เช็คว่า Token ถูกต้องและยังไม่หมดอายุ
    const [users] = await db.promise().query(
        "SELECT * FROM users WHERE reset_token = ? AND reset_expires > NOW()", 
        [token]
    );

    if (users.length === 0) {
        return res.send("ลิงก์นี้หมดอายุหรือใช้งานไม่ได้แล้ว <a href='/forgot-password'>ขอใหม่อีกครั้ง</a>");
    }

    res.render('reset-password', { token: token, message: null }); // ต้องสร้างไฟล์ reset-password.ejs
});

router.post('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    const { password, passwordCon } = req.body;

    if (password !== passwordCon) {
        return res.render('reset-password', { token, message: 'รหัสผ่านไม่ตรงกัน' });
    }

    // Hash Password ใหม่ (อย่าลืม require bcrypt)
    const hashedPassword = await bcrypt.hash(password, 8);

    // อัปเดตรหัสและลบ Token ทิ้ง
    await db.promise().query(
        "UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE reset_token = ?", 
        [hashedPassword, token]
    );

    res.redirect('/login');
});

module.exports = router;