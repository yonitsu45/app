const db = require('../db'); 

const getDashboards = (req, res, next) => {
    if (!req.session.user) {
        res.locals.dashboards = [];
        return next();
    }

    const userId = req.session.user.userID;
    const sql = `
        SELECT d.dashboardID as id, d.dashboardName as name, p.foodlvl , p.waterlvl
        FROM dashboards d 
        LEFT JOIN petfeeders p ON d.feederID = p.feederID 
        WHERE d.userID = ?
        ORDER BY dashboardID ASC
    `;

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.error('Error fetching dashboards for navbar:', err);
            res.locals.dashboards = []; 
        } else {
            res.locals.dashboards = results; 
        }
        
        next();
    });
};

module.exports = { getDashboards };