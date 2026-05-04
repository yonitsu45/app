const express = require('express');
const router = express.Router();
const db = require('../db');
const { isLoggedIn } = require('../middleware/isLogged');

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
        return sendAlert(res, 'success', 'เพิ่ม Token สำเร็จ', 'เพิ่ม Token เข้าสู่ระบบสำเร็จ', '/admindashboard');

    } catch (err) {
        console.error("Insert Token Error:", err);
        return sendAlert(res, 'error', 'เพิ่ม Token ไม่สำเร็จ', 'เกิดข้อผิดพลาด', '/admindashboard');
    }
});

module.exports = router;