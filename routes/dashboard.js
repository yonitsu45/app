const express = require('express');
const router = express.Router();
const db = require('../db');
const { isLoggedIn } = require('../middleware/isLogged');
const { getDashboards } = require('../middleware/getDashboards');

router.get('/dashboard/:id', isLoggedIn, getDashboards, (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.userID;
  
  db.query('SELECT * FROM dashboards WHERE dashboardID = ? AND userID = ?', [id, userId], (err, results) => {
    // ...
    const dashboard = results[0];
    res.render('dashboard', {
      user: req.session.user,
      dashboard: dashboard
    });
  });
});

// router.post('/dashboard/add', isLoggedIn, (req, res) => {
//   const { name } = req.body;
//   const userId = req.session.user.userID;

//   if (!name) {
//     return res.render('index', { message: 'กรุณาตั้งชื่อ Dashboard', error: true });
//   }

//   db.query(
//     'INSERT INTO dashboards (userID, dashboardName) VALUES (?, ?)',
//     [userId, name],
//     (err, result) => {
//       if (err) {
//         console.error(err);
//        return res.render('index', { message: 'เกิดข้อผิดพลาดในการบันทึก', error: true });
//       }
//       const newDashboardId = result.insertId;
//       res.redirect(`/dashboard/${newDashboardId}`);
//     }
//   );
// });

router.post('/dashboard/add', isLoggedIn, async (req, res) => {
    const { name, token } = req.body; // รับค่า name และ token มาจากฟอร์ม
    const userId = req.session.user.userID;

    try {
        // 1. ค้นหาเครื่องที่มี Token ตรงกัน
        const [devices] = await db.promise().query('SELECT * FROM petfeeders WHERE feederToken = ?', [token]);
        
        // ถ้าไม่เจอเครื่องนี้ในระบบเลย
        if (devices.length === 0) {
            req.flash('error', 'ไม่พบรหัส Token นี้ในระบบ กรุณาตรวจสอบอีกครั้ง');
            return res.redirect('/index'); // หรือกลับไปหน้าเดิม
        }

        const device = devices[0];

        // 2. เช็คว่าเครื่องนี้มีเจ้าของหรือยัง?
        if (device.userID !== null) {
            // ถ้ามีคนเป็นเจ้าของแล้ว (และไม่ใช่เรา)
            req.flash('error', 'อุปกรณ์นี้ถูกลงทะเบียนไปแล้ว');
            return res.redirect('/index');
        }

        // 3. เริ่มทำการ "ผูกบัญชี" (Update 2 ตาราง)
        
        // 3.1 อัปเดตตาราง petfeeders: ระบุว่า User คนนี้เป็นเจ้าของเครื่องนี้แล้ว
        await db.promise().query('UPDATE petfeeders SET userID = ?, feederName = ? WHERE feederID = ?', 
            [userId, name, device.feederID]);

        // 3.2 สร้าง Dashboard ใหม่ในตาราง dashboards
        await db.promise().query('INSERT INTO dashboards (userID, feederID, dashboardName) VALUES (?, ?, ?)', 
            [userId, device.feederID, name]);

        req.flash('success', 'เพิ่มอุปกรณ์เรียบร้อยแล้ว!');
        res.redirect('/index');

    } catch (err) {
        console.error(err);
        req.flash('error', 'เกิดข้อผิดพลาดในการบันทึก');
        res.redirect('/index');
    }
});

module.exports = router;
