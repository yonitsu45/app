const express = require('express');
const router = express.Router();
const db = require('../db');
const { isLoggedIn } = require('../middleware/isLogged');
const { getDashboards } = require('../middleware/getDashboards');

router.get('/dashboard/:id', isLoggedIn, getDashboards, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.userID;

  try {
        // 1. ดึงข้อมูล Dashboard
        // ⚠️ บรรทัดนี้แหละที่มันฟ้องว่าประกาศซ้ำ (ให้มีแค่บรรทัดนี้อันเดียวนะครับ)
        const [dashResults] = await db.promise().query(
            'SELECT * FROM dashboards WHERE dashboardID = ? AND userID = ?', 
            [id, userId]
        );

        // เช็คว่าเจอข้อมูลไหม
        if (dashResults.length === 0) {
            console.log("❌ Dashboard not found or unauthorized");
            return res.redirect('/index'); 
        }

        const dashboard = dashResults[0]; // เก็บข้อมูล Dashboard

        // 2. ดึงสถานะ Active จากตาราง petfeeders
        const [feederResults] = await db.promise().query(
            'SELECT isActive FROM petfeeders WHERE feederID = ?', 
            [dashboard.feederID]
        );
        // ถ้าหาไม่เจอ ให้ default เป็น 0 (ปิด)
        const feederStatus = feederResults[0] ? feederResults[0].isActive : 0;
        
        // 3. ดึง Config การตั้งค่าเวลา
        const [configResults] = await db.promise().query(
            'SELECT * FROM feedconfig WHERE feederID = ? ORDER BY feedTime ASC', 
            [dashboard.feederID]
        );

        // 4. ส่งข้อมูลไปหน้าเว็บ
        res.render('dashboard', {
            user: req.session.user,
            dashboard: dashboard,      // ส่ง object dashboard ไปตรงๆ
            configs: configResults,
            feederStatus: feederStatus
        });

    } catch (err) {
        console.error(err);
        res.redirect('/index');
    }
});

router.post('/dashboard/add', isLoggedIn, async (req, res) => {
    const { name, token } = req.body; // รับค่า name และ token มาจากฟอร์ม
    const userId = req.session.user.userID;

    try {
        // 1. ค้นหาเครื่องที่มี Token ตรงกัน
        const [devices] = await db.promise().query('SELECT * FROM petfeeders WHERE feederToken = ?', [token]);
        
        // ถ้าไม่เจอเครื่องนี้ในระบบเลย
        if (devices.length === 0) {
            return res.render('index', {
                message: 'ไม่พบ token',
                error: true
            }); // หรือกลับไปหน้าเดิม
        }

        const device = devices[0];

        // 2. เช็คว่าเครื่องนี้มีเจ้าของหรือยัง?
        if (device.userID !== null) {
            // ถ้ามีคนเป็นเจ้าของแล้ว (และไม่ใช่เรา)
            return res.render('index', {
                message: 'ไม่พบเครื่อง',
                error: true
            });
        }

        // 3. เริ่มทำการ "ผูกบัญชี" (Update 2 ตาราง)
        
        // 3.1 อัปเดตตาราง petfeeders: ระบุว่า User คนนี้เป็นเจ้าของเครื่องนี้แล้ว
        await db.promise().query('UPDATE petfeeders SET userID = ?, feederName = ? WHERE feederID = ?', 
            [userId, name, device.feederID]);

        // 3.2 สร้าง Dashboard ใหม่ในตาราง dashboards
        await db.promise().query('INSERT INTO dashboards (userID, feederID, dashboardName) VALUES (?, ?, ?)', 
            [userId, device.feederID, name]);

        req.flash('success', 'เพิ่มอุปกรณ์เรียบร้อยแล้ว!');
        res.render('index', {
            message: 'เพิ่มอุปกรณ์เรียบร้อยแล้ว!',
            error: false
        });

    } catch (err) {
        console.error(err);
        req.flash('error', 'เกิดข้อผิดพลาดในการบันทึก');
        res.redirect('/index');
    }
});

//รับค่า config แล้วส่งไป database
router.post('/dashboard/:id/config', isLoggedIn, async (req, res) => {
        const { dashboardID } = req.body;
    try {
        const feederID = req.params.id; 
        const { feedTime, duration } = req.body; 
        const timeForDB = feedTime + ":00";

        //save to db
        await db.promise().query(
            'INSERT INTO feedconfig (feederID, feedTime, feedDura) VALUES (?, ?, ?)',
            [feederID, timeForDB, duration ]
        );

        res.redirect('/dashboard/' + dashboardID);

    } catch (err) {
        console.error("Save Error:", err);
        res.status(500).send("Error: " + err.message);
    }
});

router.post('/config/delete/:id', isLoggedIn, async (req, res) => {
        const { dashboardID } = req.body
    try {
        const configID = req.params.id; // รับค่า conID ที่ส่งมาจาก URL

        await db.promise().query('DELETE FROM feedconfig WHERE conID = ?', [configID]);

        res.redirect('/dashboard/' + dashboardID);

    } catch (err) {
        console.error("Delete Error:", err);
        res.status(500).send("ลบไม่สำเร็จ: " + err.message);
    }
});

router.post('/feeder/status', isLoggedIn, async (req, res) => {
    try {
        const { feederID, isActive } = req.body;
        
        console.log(`เปลี่ยนสถานะเครื่อง ${feederID} เป็น: ${isActive}`);

        // อัปเดตลงตาราง petfeeders
        await db.promise().query(
            'UPDATE petfeeders SET isActive = ? WHERE feederID = ?',
            [isActive, feederID]
        );

        res.json({ success: true, message: 'บันทึกสถานะเรียบร้อย' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
