const db = require('../db'); // ถอยกลับไปหา db.js

module.exports = async (req, res, next) => {
    // 1. ถ้ายังไม่ล็อกอิน ข้ามไปเลย
    if (!req.session.user) {
        res.locals.alerts = []; // ส่งอาเรย์ว่างไป กัน EJS พัง
        return next();
    }

    try {
        const userID = req.session.user.userID;

        const sql = `
            SELECT p.*, d.dashboardID 
            FROM petfeeders p
            LEFT JOIN dashboards d ON p.feederID = d.feederID
            WHERE p.userID = ? 
            AND (p.foodlvl < 20 OR p.waterlvl < 20)
            AND p.isActive = 1
        `;
        
        const [rows] = await db.promise().query(sql, [userID]);

        // 3. ส่งข้อมูลไปให้ EJS ทุกหน้าใช้ได้เลย (ผ่านตัวแปร res.locals)
        res.locals.alerts = rows; 
        next();

    } catch (err) {
        console.error("Alert Check Error:", err);
        res.locals.alerts = [];
        next();
    }
};