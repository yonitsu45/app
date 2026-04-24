const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');
const { isLoggedIn } = require('../middleware/isLogged');
const { getDashboards } = require('../middleware/getDashboards');

function sendAlert(res, icon, title, text, redirectUrl = 'back') {
    res.send(`
        <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
        <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Prompt', sans-serif; background-color: #f4f7f6; }
            .swal2-popup { border-radius: 15px !important; }
        </style>
        <script>
            document.addEventListener("DOMContentLoaded", function() {
                Swal.fire({
                    icon: '${icon}',
                    title: '${title}',
                    text: '${text}',
                    confirmButtonColor: '#0d6efd',
                    confirmButtonText: 'ตกลง',
                    allowOutsideClick: false
                }).then(() => {
                    ${redirectUrl === 'back' ? 'window.history.back();' : `window.location.href='${redirectUrl}';`}
                });
            });
        </script>
    `);
}

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

        const feederStatus = feederResults[0] ? {
            wsConnected: feederResults[0].wsConnected,  // เชื่อมต่อจริง?
            isActive: feederResults[0].isActive         // แจ้งเตือนเปิด?
        } : { wsConnected: 0, isActive: 1 };

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
            return sendAlert(res, 'error', 'ไม่พบเครื่อง', 'ไม่พบ Token นี้ในระบบ กรุณาตรวจสอบอีกครั้ง', '/index');
        }

        const device = devices[0];

        //check ownership
        if (device.userID !== null) {
            return sendAlert(res, 'warning', 'เครื่องมีเจ้าของแล้ว', 'เครื่องนี้ถูกลงทะเบียนโดยผู้ใช้อื่นแล้ว', '/index');
        }

        //update 
        await db.promise().query('UPDATE petfeeders SET userID = ?, feederName = ? WHERE feederID = ?', 
            [userId, name, device.feederID]);

        //add new dashboard
        await db.promise().query('INSERT INTO dashboards (userID, feederID, dashboardName) VALUES (?, ?, ?)', 
            [userId, device.feederID, name]);

        return sendAlert(res, 'success', 'เพิ่มเครื่องสำเร็จ', 'เชื่อมต่อเครื่องให้อาหารของคุณเรียบร้อยแล้ว', '/index');

    } catch (err) {
        console.error(err);
        return sendAlert(res, 'error', 'เกิดข้อผิดพลาด', 'ไม่สามารถเพิ่มอุปกรณ์ได้ในขณะนี้', '/index');
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
            return sendAlert(res, 'error', 'เกิดข้อผิดพลาด', 'ไม่สามารถเพิ่มเวลาได้', '/dashboard/:id');
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
        return sendAlert(res, 'error', 'เกิดข้อผิดพลาด', '', '/dashboard/' + dashboardID);
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

        return sendAlert(res, 'success', 'สำเร็จ!', 'เปลี่ยนชื่อเครื่องเรียบร้อยแล้ว', '/dashboard/' + dashboardID);

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
            return sendAlert(res, 'error', 'เกิดข้อผิดพลาด', 'รหัสผ่านยืนยันไม่ถูกต้อง');
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

        return sendAlert(res, 'success', 'ลบสำเร็จ', 'ลบเครื่องออกจากบัญชีของคุณแล้ว', '/index');

    } catch (err) {
        console.error(err);
        res.send("<script>alert('เกิดข้อผิดพลาดในการลบ'); window.history.back();</script>");
    }
});

router.delete('/api/feeder/:id/logs', isLoggedIn, async (req, res) => {
    try {
        const feederID = req.params.id;
        
        // ลบข้อมูลในตาราง feedlogs เฉพาะของเครื่องนั้นๆ
        await db.promise().query(
            'DELETE FROM feedlogs WHERE feederID = ?',
            [feederID]
        );
        
        // ตอบกลับไปหาหน้าบ้าน (Frontend) ว่าลบสำเร็จ
        res.json({ success: true, message: 'ล้างประวัติเรียบร้อยแล้ว' });

    } catch (err) {
        console.error("Clear Logs Error:", err);
        res.status(500).json({ success: false, message: "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์" });
    }
});

router.post('/feeder/notification', isLoggedIn, async (req, res) => {
    try {
        const { feederID, isActive } = req.body;
        
        // 🔥 เพิ่ม Validation
        if (!feederID || isActive === undefined) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required parameters' 
            });
        }

        // 🔥 เช็คว่า Feeder นี้เป็นของ User คนนี้ไหม
        const [dash] = await db.promise().query(
            'SELECT feederID FROM dashboards WHERE dashboardID IN (SELECT dashboardID FROM dashboards WHERE userID = ?) AND feederID = ?',
            [req.session.user.userID, feederID]
        );

        if (dash.length === 0) {
            return res.status(403).json({ 
                success: false, 
                message: 'Unauthorized: This feeder does not belong to you' 
            });
        }

        console.log(`🔔 เปลี่ยนสถานะแจ้งเตือน Feeder ${feederID} เป็น: ${isActive}`);

        // อัปเดต isActive
        await db.promise().query(
            'UPDATE petfeeders SET isActive = ? WHERE feederID = ?',
            [isActive, feederID]
        );

        res.json({ 
            success: true, 
            message: isActive === 1 ? '✅ เปิดการแจ้งเตือน' : '❌ ปิดการแจ้งเตือน',
            feederID: feederID,
            isActive: isActive
        });

    } catch (err) {
        console.error('Error updating notification:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Server error: ' + err.message 
        });
    }
});

module.exports = router;
