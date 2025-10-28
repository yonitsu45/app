const express = require('express');
const router = express.Router();

router.get('/', (req, res) => res.render('index'));

router.get('/index', (req, res) => {
  res.render('index', {
    user: req.session.user || null,
    message: req.session.successMessage || null
  });
  delete req.session.successMessage;
});

router.get('/login', (req, res) => res.render('login'));
router.get('/register', (req, res) => res.render('register', { message: '' }));
router.get('/profile', (req, res) => res.render('profile'));
router.get('/dashboardcam', (req, res) => res.render('dashboardcam'));
router.get('/dashboard', (req, res) => res.render('dashboard'));
router.get('/testboard', (req, res) => res.render('testboard'));

module.exports = router;