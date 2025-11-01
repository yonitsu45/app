const db = require('../db'); 

const getDashboards = (req, res, next) => {
    if (!req.session.user) {
        res.locals.dashboards = [];
        return next();
    }

    const userId = req.session.user.userID;
    const sql = `
        SELECT dashboardID AS id, dashboardName AS name 
        FROM dashboards 
        WHERE userID = ? 
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