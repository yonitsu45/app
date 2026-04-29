const express = require('express');
const router = express.Router();
const db = require('../db');
const { isLoggedIn } = require('../middleware/isLogged');

// 🔥 Middleware: ดึง Dashboards สำหรับ Logged-in Users
const getDashboardsMiddleware = (req, res, next) => {
    if (req.session && req.session.user) {
        const userId = req.session.user.userID;
        const sql = `
            SELECT 
                d.dashboardID AS id, 
                d.dashboardName AS name,
                p.feederID,
                p.foodlvl,
                p.waterlvl,
                p.wsConnected,
                p.isActive
            FROM dashboards d
            JOIN petfeeders p ON d.feederID = p.feederID
            WHERE d.userID = ? 
            ORDER BY d.dashboardName ASC
        `;
        
        db.query(sql, [userId], (err, dashboardList) => {
            if (err) {
                console.error("❌ Error fetching dashboard list:", err);
                res.locals.dashboards = [];
            } else {
                res.locals.dashboards = dashboardList || [];
                console.log(`✅ Found ${dashboardList.length} dashboards for User ${userId}`);
            }
            
            res.locals.user = req.session.user;
            next();
        });
    } else {
        res.locals.dashboards = [];
        res.locals.user = null;
        next();
    }
};

// 🔥 ใช้ Middleware สำหรับ routes ที่ต้อง dashboards
router.get('/', getDashboardsMiddleware, (req, res) => {
    res.render('index');
});

router.get('/index', getDashboardsMiddleware, (req, res) => {
    res.render('index');
});

router.get('/login', (req, res) => {
    res.render('login');
});

router.get('/register', (req, res) => {
    res.render('register');
});

router.get('/profile', isLoggedIn, (req, res) => {
    res.render('profile');
});

router.get('/dashboard', isLoggedIn, (req, res) => {
    res.render('dashboard');
});

router.get('/admindashboard', (req, res) => {
    res.render('admindashboard');
});

router.get('/info', (req, res) => {
    res.render('info');
});

module.exports = router;