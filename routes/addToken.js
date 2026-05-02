const express = require('express');
const router = express.Router();
const db = require('../db');
const { isLoggedIn } = require('../middleware/isLogged');

router.post('/addToken', isLoggedIn, async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.send("<script>alert('กรุณากรอก Token'); window.history.back();</script>");
    }

    try {
        //check repeat token
        const [existing] = await db.promise().query(
            'SELECT feederToken FROM petfeeders WHERE feederToken = ?', 
            [token]
        );

        if (existing.length > 0) {
            return res.send("<script>alert('Token นี้มีอยู่ในระบบแล้ว! กรุณาใช้ Token อื่น'); window.history.back();</script>");
        }

        //insert
        await db.promise().query(
            'INSERT INTO petfeeders (feederToken, feederName, userID, isActive) VALUES (?, ?, NULL, 0)',
            [token, 'New Device']
        );

        console.log(`Added new token to system: ${token}`);

        //success
        return sendAlert(res, 'success', 'เพิ่ม Token สำเร็จ', 'เพิ่ม Token เข้าสู่ระบบสำเร็จ', '/index');

    } catch (err) {
        console.error("Insert Token Error:", err);
        return sendAlert(res, 'error', 'เพิ่ม Token ไม่สำเร็จ', 'เกิดข้อผิดพลาด', '/index');
    }
});

module.exports = router;