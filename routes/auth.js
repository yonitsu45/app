const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const router = express.Router();
const crypto = require('crypto');
const mailer = require('../middleware/mailer');
const { isLoggedIn } = require('../middleware/isLogged');

function sendAlert(res, icon, title, text, redirectUrl = 'back') {
    res.send(`
        <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
        <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>body { font-family: 'Prompt', sans-serif; background-color: #f4f7f6; } .swal2-popup { border-radius: 15px !important; }</style>
        <script>
            document.addEventListener("DOMContentLoaded", function() {
                Swal.fire({
                    icon: '${icon}', title: '${title}', text: '${text}',
                    confirmButtonColor: '#0d6efd', confirmButtonText: 'ตกลง',
                    allowOutsideClick: false
                }).then(() => {
                    ${redirectUrl === 'back' ? 'window.history.back();' : `window.location.href='${redirectUrl}';`}
                });
            });
        </script>
    `);
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
router.get('/profile', isLoggedIn, async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const userID = req.session.user.userID; 

    try {
        const [userResult] = await db.promise().query(
            "SELECT username, email, created_at, urole FROM users WHERE userID = ?", 
            [userID]
        );
        const userData = userResult[0];

        const [feederResult] = await db.promise().query(
            "SELECT COUNT(*) as count FROM petfeeders WHERE userID = ?", 
            [userID]
        );
        const totalFeeders = feederResult[0].count;

        const [foodResult] = await db.promise().query(
            `SELECT SUM(amount) as total 
             FROM feedlogs 
             WHERE feederID IN (SELECT feederID FROM petfeeders WHERE userID = ?) 
             AND MONTH(feedAt) = MONTH(CURRENT_DATE())`,
            [userID]
        );
        const totalFood = foodResult[0].total || 0;

        res.render('profile', {
            user: userData,
            totalFeeders: totalFeeders,
            totalFood: totalFood
        });

    } catch (error) {
        console.error("Error loading profile stats:", error);
        res.render('profile', { 
            user: req.session.user,
            totalFeeders: 0,
            totalFood: 0
        });
    }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.render('login', {
    message: 'ออกจากระบบสำเร็จ',
    error: true
  });
});

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

//user edit
router.post('/user/update', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const { targetID, username, email, newPassword, confirmPassword } = req.body;
    const currentUser = req.session.user;

    let idToUpdate;
    
    //admin checking
    if (currentUser.urole === 'admin' && targetID) {
        idToUpdate = targetID;
    } else {
        idToUpdate = currentUser.userID; 
    }

    //username and email update
    let sql = "UPDATE users SET username = ?, email = ?";
    let params = [username, email];

    //password change check
    if (newPassword || confirmPassword) {
        if (newPassword !== confirmPassword) {
            return sendAlert(res, 'error', 'ข้อมูลไม่ถูกต้อง', 'รหัสผ่านยืนยันไม่ตรงกัน');
        }
        if (newPassword.length < 6) {
            return sendAlert(res, 'warning', 'รหัสผ่านสั้นเกินไป', 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
        }
        // Hash รหัสผ่าน
        const hashedPassword = await bcrypt.hash(newPassword, 8);
        
        sql += ", password = ?";
        params.push(hashedPassword);
    }

    //checking id to update
    sql += " WHERE userID = ?";
    params.push(idToUpdate);

    //update to db
    db.query(sql, params, (err, result) => {
        if (err) {
            console.error(err);
            return sendAlert(res, 'error', 'เกิดข้อผิดพลาด', 'Email นี้อาจมีผู้ใช้งานแล้ว หรือระบบมีปัญหา');
        }

        //update session
        if (idToUpdate == currentUser.userID) {
            req.session.user.username = username;
            req.session.user.email = email; // อัปเดต email ใน session ด้วย
        }

        if (currentUser.urole === 'admin' && idToUpdate != currentUser.userID) {
            res.redirect('/admindashboard');
        } else {
            res.redirect('/profile');
        }
    });
});

//user delete
router.post('/user/delete', async (req, res) => {
    if (!req.session.user || req.session.user.urole !== 'admin') {
        return res.redirect('/login');
    }

    const { targetUserID, password } = req.body;
    const adminID = req.session.user.userID;

    try {
        //prevent admin self remove
        if (targetUserID == adminID) {
           return sendAlert(res, 'error', 'ไม่อนุญาต', 'ไม่สามารถลบบัญชีของตัวเองได้');
        }

        //password checking
        const [admins] = await db.promise().query('SELECT password FROM users WHERE userID = ?', [adminID]);
        const match = await bcrypt.compare(password, admins[0].password);
        
        if (!match) {
            return sendAlert(res, 'error', 'รหัสผ่านผิด', 'รหัสผ่าน Admin ไม่ถูกต้อง');
        }

        //feeder with no owner
        const [userFeeders] = await db.promise().query('SELECT feederID FROM petfeeders WHERE userID = ?', [targetUserID]);
        for (let i = 0; i < userFeeders.length; i++) {
            let fID = userFeeders[i].feederID;
            await db.promise().query("DELETE FROM feedconfig WHERE feederID = ?", [fID]);
            await db.promise().query(
                "UPDATE petfeeders SET userID = NULL, isActive = 0, feederName = 'Smart Pet Feeder' WHERE feederID = ?", 
                [fID]
            );
        }

        //remove dashboard
        await db.promise().query("DELETE FROM dashboards WHERE userID = ?", [targetUserID]);

        //remove user
        await db.promise().query("DELETE FROM users WHERE userID = ?", [targetUserID]);

        return sendAlert(res, 'success', 'ลบผู้ใช้สำเร็จ', 'ลบผู้ใช้งานและเคลียร์เครื่องเรียบร้อยแล้ว', '/admindashboard');

    } catch (err) {
        console.error("Delete User Error:", err);
        return sendAlert(res, 'error', 'เกิดข้อผิดพลาด', 'ไม่สามารถลบผู้ใช้ได้');
    }
});

//feeder edit
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
        
        return sendAlert(res, 'success', 'อัปเดตสำเร็จ', 'บันทึกการแก้ไขสำเร็จ', '/admindashboard');

    } catch (err) {
        console.error(err);
        return sendAlert(res, 'error', 'เกิดข้อผิดพลาด', 'ไม่สามารถอัปเดตข้อมูลเครื่องได้');
    }
});

//feeder deleting
router.post('/feeder/delete', async (req, res) => {
    if (!req.session.user || req.session.user.urole !== 'admin') {
        return res.redirect('/login');
    }

    const { feederID, password } = req.body;
    const adminID = req.session.user.userID;

    try {
        const [admins] = await db.promise().query('SELECT password FROM users WHERE userID = ?', [adminID]);
        const match = await bcrypt.compare(password, admins[0].password);
        
        if (!match) {
            return sendAlert(res, 'error', 'รหัสผ่านผิด', 'รหัสผ่าน Admin ไม่ถูกต้อง');
        }

        await db.promise().query("DELETE FROM feedconfig WHERE feederID = ?", [feederID]); 
        await db.promise().query("DELETE FROM feedlogs WHERE feederID = ?", [feederID]);   
        await db.promise().query("DELETE FROM dashboards WHERE feederID = ?", [feederID]); 
        await db.promise().query("DELETE FROM petfeeders WHERE feederID = ?", [feederID]);

        return sendAlert(res, 'success', 'ลบเครื่องสำเร็จ', 'ลบเครื่องให้อาหารออกจากระบบถาวรแล้ว', '/admindashboard');

    } catch (err) {
        console.error("Delete Feeder Error:", err);
        return sendAlert(res, 'error', 'เกิดข้อผิดพลาด', 'ไม่สามารถลบเครื่องให้อาหารได้');
    }
});

//feeder level api
router.get('/api/feeder/status/:id', async (req, res) => {
    try {
        const feederID = req.params.id;
        
        //pull from db
        const [rows] = await db.promise().query(
            "SELECT foodlvl AS foodLevel, waterlvl AS waterLevel, bowl_food, bowl_water, isActive FROM petfeeders WHERE feederID = ?",
            [feederID]
        );

        if (rows.length > 0) {
            //json
            res.json(rows[0]); 
        } else {
            res.status(404).json({ error: "Not found" });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server Error" });
    }
});

//forgot password
router.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { message: null });
});

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        //mail checking
        const [users] = await db.promise().query("SELECT * FROM users WHERE email = ?", [email]);
        if (users.length === 0) {
            return res.render('forgot-password', { message: 'ไม่พบอีเมลนี้ในระบบ' });
        }

        //create random token
        const token = crypto.randomBytes(32).toString('hex');
        //expire in 1 hr
        const expireTime = new Date(Date.now() + 3600000); //1hr

        //save token
        await db.promise().query(
            "UPDATE users SET reset_token = ?, reset_expires = ? WHERE email = ?", 
            [token, expireTime, email]
        );

        //mail sending
        await mailer.sendResetPasswordEmail(email, token);

        res.render('forgot-password', { message: 'ส่งลิงก์กู้คืนรหัสผ่านไปทางอีเมลแล้ว กรุณาเช็ค Inbox หรือ Junk Mail ✉️', error: false});

    } catch (err) {
        console.error(err);
        res.send("Error sending email");
    }
});

//reset passowrd
router.get('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    
    //token expire and valid checking
    const [users] = await db.promise().query(
        "SELECT * FROM users WHERE reset_token = ? AND reset_expires > NOW()", 
        [token]
    );

    if (users.length === 0) {
        return res.send("ลิงก์นี้หมดอายุหรือใช้งานไม่ได้แล้ว <a href='/forgot-password'>ขอใหม่อีกครั้ง</a>");
    }

    res.render('reset-password', { token: token, message: null }); // ต้องสร้างไฟล์ reset-password.ejs
});

//update new password
router.post('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    const { password, passwordCon } = req.body;

    if (password !== passwordCon) {
        return res.render('reset-password', { token, message: 'รหัสผ่านไม่ตรงกัน' });
    }

    //hash new pass
    const hashedPassword = await bcrypt.hash(password, 8);

    //update pass and remove token
    await db.promise().query(
        "UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE reset_token = ?", 
        [hashedPassword, token]
    );

    res.render('reset-password', { token: token, message: 'เปลี่ยนรหัสผ่านเรียบร้อย สามารถเข้าสู่ระบบได้ทันที ✅', error: false});
});

module.exports = router;