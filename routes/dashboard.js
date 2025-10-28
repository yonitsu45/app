const express = require('express');
const router = express.Router();
const db = require('../db');
const { isLoggedIn } = require('../middleware/auth');

router.get('/dashboard/:id', isLoggedIn, (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.userID;

  db.query('SELECT * FROM dashboards WHERE dashboardID = ? AND userID = ?', [id, userId], (err, results) => {
    if (err) throw err;
    if (results.length === 0) {
      return res.status(404).send('ไม่พบ dashboard หรือคุณไม่มีสิทธิ์เข้าถึง');
    }

    const dashboard = results[0];
    res.render('dashboard', {
      user: req.session.user,
      dashboard
    });
  });
});

module.exports = router;
