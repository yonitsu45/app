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
            [token, 'New Device'] // บรรทัดนี้ตั้งชื่อเริ่มต้นไว้ ถ้า DB ยอมให้ชื่อเป็น NULL ก็ลบ 'New Device' ออกได้ครับ
        );

        console.log(`Added new token to system: ${token}`);

        //success
        return res.send("<script>alert('เพิ่ม Token เข้าระบบสำเร็จ!'); window.location.href='/admindashboard';</script>");

    } catch (err) {
        console.error("Insert Token Error:", err);
        return res.send("<script>alert('เกิดข้อผิดพลาดในการบันทึก'); window.history.back();</script>");
    }
});

module.exports = router;