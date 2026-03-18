const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const { isLoggedIn } = require('../middleware/isLogged');
const { getDashboards } = require('../middleware/getDashboards');

router.get('/dashboard/:id', isLoggedIn, getDashboards, async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.userID;

  try {
        //pull Dashboard
        const [dashResults] = await db.promise().query(
            'SELECT * FROM dashboards WHERE dashboardID = ? AND userID = ?', 
            [id, userId]
        );

        if (dashResults.length === 0) {
            console.log("❌ Dashboard not found or unauthorized");
            return res.redirect('/index'); 
        }

        const dashboard = dashResults[0]; // เก็บข้อมูล Dashboard

        const [feederResults] = await db.promise().query(
            'SELECT isActive FROM petfeeders WHERE feederID = ?', 
            [dashboard.feederID]
        );

        const feederStatus = feederResults[0] ? feederResults[0].isActive : 0;
        
        //pull config
        const [configResults] = await db.promise().query(
            'SELECT * FROM feedconfig WHERE feederID = ? ORDER BY feedTime ASC', 
            [dashboard.feederID]
        );

        const [logResults] = await db.promise().query(
            'SELECT * FROM feedlogs WHERE feederID = ? ORDER BY feedAt DESC LIMIT 5',
            [dashboard.feederID]
        );

        res.render('dashboard', {
            user: req.session.user,
            dashboard: dashboard,
            configs: configResults,
            feederStatus: feederStatus,
            logs: logResults
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
        //pull feeder
        const [devices] = await db.promise().query('SELECT * FROM petfeeders WHERE feederToken = ?', [token]);
        
        //not found
        if (devices.length === 0) {
            return res.render('index', {
                message: 'ไม่พบ token',
                error: true
            });
        }

        const device = devices[0];

        //check ownership
        if (device.userID !== null) {
            return res.render('index', {
                message: 'ไม่พบเครื่อง',
                error: true
            });
        }

        //update 
        await db.promise().query('UPDATE petfeeders SET userID = ?, feederName = ? WHERE feederID = ?', 
            [userId, name, device.feederID]);

        //add new dashboard
        await db.promise().query('INSERT INTO dashboards (userID, feederID, dashboardName) VALUES (?, ?, ?)', 
            [userId, device.feederID, name]);

        req.flash('success', 'เพิ่มอุปกรณ์เรียบร้อยแล้ว!');
        res.render('index', {
            message: 'เพิ่มอุปกรณ์เรียบร้อยแล้ว!',
            error: false,
            autoRedirect: true
        });

    } catch (err) {
        console.error(err);
        req.flash('error', 'เกิดข้อผิดพลาดในการบันทึก');
        res.redirect('/index');
    }
});

//รับค่า config แล้วส่งไป database
router.post('/dashboard/:id/config', isLoggedIn, async (req, res) => {
    const { dashboardID, feedTime, duration } = req.body; 
    const feederID = req.params.id; 

    try {
        const timeForDB = feedTime + ":00";

        // schedule check 
        const [dupRows] = await db.promise().query(
            'SELECT * FROM feedconfig WHERE feederID = ? AND feedTime = ?', 
            [feederID, timeForDB]
        );

        if (dupRows.length > 0) {
            return res.send(`<script>alert('❌ เวลานี้มีอยู่แล้ว!'); window.location.href = '/dashboard/${dashboardID}';</script>`);
        }
        // schedule slot
        const [existingSlots] = await db.promise().query(
            'SELECT slot FROM feedconfig WHERE feederID = ? ORDER BY slot ASC',
            [feederID]
        );
        
        const usedSlots = existingSlots.map(row => row.slot);
        
        let targetSlot = null;
        if (!usedSlots.includes(1)) targetSlot = 1;
        else if (!usedSlots.includes(2)) targetSlot = 2;
        else if (!usedSlots.includes(3)) targetSlot = 3;

        // ถ้าเต็มหมดแล้ว (ไม่มีช่องว่าง)
        if (targetSlot === null) {
             return res.send(`<script>alert('❌ เต็มแล้ว! (สูงสุด 3 รอบ)'); window.location.href = '/dashboard/${dashboardID}';</script>`);
        }

        await db.promise().query(
            'INSERT INTO feedconfig (feederID, feedTime, feedAmount, slot) VALUES (?, ?, ?, ?)',
            [feederID, timeForDB, duration, targetSlot]
        );

        res.redirect('/dashboard/' + dashboardID);

    } catch (err) {
        console.error("Save Error:", err);
        res.send(`<script>alert('Error: ${err.message}'); window.history.back();</script>`);
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

router.get('/api/feeder/:id/logs', isLoggedIn, async (req, res) => {
    try {
        const feederID = req.params.id;
        // ดึง 10 รายการล่าสุด
        const [logResults] = await db.promise().query(
            'SELECT * FROM feedlogs WHERE feederID = ? ORDER BY feedAt DESC LIMIT 5',
            [feederID]
        );
        res.json(logResults);
    } catch (err) {
        console.error("Fetch Logs Error:", err);
        res.status(500).json({ error: "Server Error" });
    }
});

router.post('/dashboard/:id/edit', isLoggedIn, async (req, res) => {
    const dashboardID = req.params.id;
    const userId = req.session.user.userID;
    const { newName } = req.body;

    try {
        // 1. อัปเดตชื่อในตาราง dashboards เลย
        await db.promise().query(
            'UPDATE dashboards SET dashboardName = ? WHERE dashboardID = ? AND userID = ?',
            [newName, dashboardID, userId]
        );

        const [dash] = await db.promise().query('SELECT feederID FROM dashboards WHERE dashboardID = ?', [dashboardID]);
        if (dash.length > 0) {
            await db.promise().query('UPDATE petfeeders SET feederName = ? WHERE feederID = ?', [newName, dash[0].feederID]);
        }

        res.send(`<script>alert('✅ เปลี่ยนชื่อเครื่องสำเร็จ!'); window.location.href='/dashboard/${dashboardID}';</script>`);

    } catch (err) {
        console.error(err);
        res.send("<script>alert('เกิดข้อผิดพลาด'); window.history.back();</script>");
    }
});


router.post('/dashboard/:id/delete-feeder', isLoggedIn, async (req, res) => {
    const dashboardID = req.params.id;
    const userId = req.session.user.userID;
    const { password } = req.body;

    try {
        const [users] = await db.promise().query('SELECT password FROM users WHERE userID = ?', [userId]);
        const match = await bcrypt.compare(password, users[0].password);
        
        if (!match) {
            return res.send("<script>alert('❌ รหัสผ่านไม่ถูกต้อง'); window.history.back();</script>");
        }

        const [dash] = await db.promise().query('SELECT feederID FROM dashboards WHERE dashboardID = ? AND userID = ?', [dashboardID, userId]);
        if (dash.length === 0) return res.redirect('/index');
        const feederID = dash[0].feederID;

        await db.promise().query('DELETE FROM feedconfig WHERE feederID = ?', [feederID]);

        await db.promise().query(
            'UPDATE petfeeders SET userID = NULL, isActive = 0, feederName = ? WHERE feederID = ?', 
            ['New Device', feederID] 
        );

        await db.promise().query('DELETE FROM dashboards WHERE dashboardID = ?', [dashboardID]);

        res.send(`<script>alert('🗑️ ลบเครื่องให้อาหารออกจากบัญชีแล้ว'); window.location.href='/index';</script>`);

    } catch (err) {
        console.error(err);
        res.send("<script>alert('เกิดข้อผิดพลาดในการลบ'); window.history.back();</script>");
    }
});

module.exports = router;
