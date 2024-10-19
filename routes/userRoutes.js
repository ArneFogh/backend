const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.post('/', userController.createUser);
router.patch('/:auth0Id', userController.updateUser);
router.get('/:auth0Id', userController.getUser);
router.delete('/:auth0Id', userController.deleteUser);

module.exports = router;