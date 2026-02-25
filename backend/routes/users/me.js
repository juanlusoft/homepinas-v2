/**
 * HomePiNAS v2 - Current User Operations
 * Get info and change password for authenticated user
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAuth } = require('../../middleware/auth');
const { logSecurityEvent } = require('../../utils/security');
const { validatePassword } = require('../../utils/sanitize');
const {
    BCRYPT_ROUNDS,
    getUsers,
    sanitizeUser,
    findUser,
    saveUsers,
    updateSambaPassword
} = require('./helpers');

/**
 * GET /me - Get current authenticated user's info
 */
router.get('/me', requireAuth, (req, res) => {
  try {
    const user = findUser(req.user.username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(sanitizeUser(user));
  } catch (err) {
    console.error('Get current user error:', err.message);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * PUT /me/password - Change own password
 */
router.put('/me/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json({ error: 'Invalid password. Must be 6-128 characters' });
    }

    const users = getUsers();
    const userIndex = users.findIndex(
      u => u.username.toLowerCase() === req.user.username.toLowerCase()
    );

    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, users[userIndex].password);
    if (!valid) {
      logSecurityEvent('PASSWORD_CHANGE_FAILED', req.user.username, {
        ip: req.ip,
        reason: 'incorrect current password',
      });
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash and save new password
    users[userIndex].password = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    saveUsers(users);

    // Update Samba password
    await updateSambaPassword(req.user.username, newPassword);

    logSecurityEvent('PASSWORD_CHANGED', { user: req.user.username }, req.ip);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Password change error:', err.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
