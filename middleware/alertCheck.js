const db = require('../db');

module.exports = async (req, res, next) => {
    if (!req.session.user) {
        res.locals.alerts = [];
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

        res.locals.alerts = rows; 
        next();

    } catch (err) {
        console.error("Alert Check Error:", err);
        res.locals.alerts = [];
        next();
    }
};