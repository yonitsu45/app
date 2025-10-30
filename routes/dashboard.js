const express = require('express');
const router = express.Router();
const db = require('../db');
const { isLoggedIn } = require('../middleware/isLogged');

router.get('/dashboard/:id', isLoggedIn, (req, res) => {
  const { id } = req.params;
  const userId = req.session.user.userID;

  db.query('SELECT * FROM dashboards WHERE dashboardID = ? AND userID = ?', [id, userId], (err, results) => {
    if (err) throw err;
    if (results.length === 0) {
      return res.status(404).send('ไม่พบ dashboard หรือคุณไม่มีสิทธิ์เข้าถึง');
    }

    const dashboard = results[0];
    res.render('dashboard-list', {
      user: req.session.user,
      dashboards: results || []
    });
  });
});

router.post('/dashboard/add', isLoggedIn, (req, res) => {
  const { name } = req.body;
  const userId = req.session.user.id;

  if (!name) return res.json({ success: false, message: 'กรุณาตั้งชื่อ Dashboard' });

  db.query(
    'INSERT INTO dashboards (user_id, name) VALUES (?, ?)',
    [userId, name],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.json({ success: false, message: 'เกิดข้อผิดพลาดในการบันทึก' });
      }
      res.json({ success: true });
    }
  );
});

module.exports = router;
