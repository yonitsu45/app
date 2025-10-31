const express = require('express');
const router = express.Router();
const db = require('../db');
const { isLoggedIn } = require('../middleware/isLogged');
const { getDashboards } = require('../middleware/getDashboards');

router.get('/dashboard/:id', isLoggedIn, getDashboards, (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.userID;
  
  db.query('SELECT * FROM dashboards WHERE dashboardID = ? AND userID = ?', [id, userId], (err, results) => {
    // ...
    const dashboard = results[0];
    res.render('dashboard', {
      user: req.session.user,
      dashboard: dashboard
    });
  });
});

router.post('/dashboard/add', isLoggedIn, (req, res) => {
  const { name } = req.body;
  const userId = req.session.user.userID;

  if (!name) {
    return res.render('index', { message: 'กรุณาตั้งชื่อ Dashboard', error: true });
  }

  db.query(
    'INSERT INTO dashboards (userID, name) VALUES (?, ?)',
    [userId, name],
    (err, result) => {
      if (err) {
        console.error(err);
       return res.render('index', { message: 'เกิดข้อผิดพลาดในการบันทึก', error: true });
      }
      const newDashboardId = result.insertId;
      res.redirect(`/dashboard/${newDashboardId}`);
    }
  );
});

module.exports = router;
