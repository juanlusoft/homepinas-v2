/**
 * HomePiNAS v2 - User Administration
 * Admin-only user management (CRUD)
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAuth } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { logSecurityEvent } = require('../../utils/security');
const { validateUsername, validatePassword } = require('../../utils/sanitize');
const {
    BCRYPT_ROUNDS,
    getUsers,
    sanitizeUser,
    findUser,
    saveUsers,
    createSambaUser,
    removeSambaUser,
    updateSambaPassword
} = require('./helpers');

/**
 * GET / - List all users (admin only)
 */
router.get('/', requireAuth, requireAdmin, (req, res) => {
  try {
    const users = getUsers();
    res.json({
      users: users.map(sanitizeUser),
      count: users.length,
    });
  } catch (err) {
    console.error('List users error:', err.message);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * POST / - Create a new user (admin only)
 */
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    if (!validateUsername(username)) {
      return res.status(400).json({ error: 'Invalid username. Must be 3-32 characters, alphanumeric with _ or -' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    if (!validatePassword(password)) {
      return res.status(400).json({ error: 'Invalid password. Must be 6-128 characters' });
    }

    const validRoles = ['admin', 'user', 'readonly'];
    const userRole = role || 'user';
    if (!validRoles.includes(userRole)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    if (findUser(username)) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const newUser = {
      username,
      password: hashedPassword,
      role: userRole,
      createdAt: new Date().toISOString(),
      lastLogin: null,
    };

    const users = getUsers();
    users.push(newUser);
    saveUsers(users);

    await createSambaUser(username, password);

    logSecurityEvent('USER_CREATED', req.user.username, {
      ip: req.ip,
      newUser: username,
      role: userRole,
    });

    res.status(201).json({
      message: 'User created successfully',
      user: sanitizeUser(newUser),
    });
  } catch (err) {
    console.error('Create user error:', err.message);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * PUT /:username - Update a user (admin only)
 */
router.put('/:username', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetUsername = req.params.username;
    const { role, password } = req.body;

    const users = getUsers();
    const userIndex = users.findIndex(
      u => u.username.toLowerCase() === targetUsername.toLowerCase()
    );

    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (role !== undefined) {
      const validRoles = ['admin', 'user', 'readonly'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      }
      users[userIndex].role = role;
    }

    if (password !== undefined) {
      if (!validatePassword(password)) {
        return res.status(400).json({ error: 'Invalid password. Must be 6-128 characters' });
      }
      users[userIndex].password = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await updateSambaPassword(users[userIndex].username, password);
    }

    saveUsers(users);

    logSecurityEvent('USER_UPDATED', req.user.username, {
      ip: req.ip,
      targetUser: targetUsername,
      updatedFields: [
        ...(role !== undefined ? ['role'] : []),
        ...(password !== undefined ? ['password'] : []),
      ],
    });

    res.json({
      message: 'User updated successfully',
      user: sanitizeUser(users[userIndex]),
    });
  } catch (err) {
    console.error('Update user error:', err.message);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * DELETE /:username - Delete a user (admin only)
 */
router.delete('/:username', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetUsername = req.params.username;

    if (targetUsername.toLowerCase() === req.user.username.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const users = getUsers();
    const userIndex = users.findIndex(
      u => u.username.toLowerCase() === targetUsername.toLowerCase()
    );

    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const deletedUser = users[userIndex];
    users.splice(userIndex, 1);
    saveUsers(users);

    await removeSambaUser(deletedUser.username);

    logSecurityEvent('USER_DELETED', req.user.username, {
      ip: req.ip,
      deletedUser: deletedUser.username,
      role: deletedUser.role,
    });

    res.json({ message: `User '${deletedUser.username}' deleted successfully` });
  } catch (err) {
    console.error('Delete user error:', err.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
