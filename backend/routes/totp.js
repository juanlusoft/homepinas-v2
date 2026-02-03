/**
 * HomePiNAS v2 - Two-Factor Authentication (TOTP) Routes
 * 
 * TOTP-based 2FA using the otpauth library.
 * Supports setup, verification, validation, and disabling of 2FA.
 */

const express = require('express');
const router = express.Router();
const { TOTP, Secret } = require('otpauth');
const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const { sanitizeForLog } = require('../utils/sanitize');
const { getData, saveData } = require('../utils/data');

// TOTP configuration constants
const TOTP_ISSUER = 'HomePiNAS';
const TOTP_ALGORITHM = 'SHA1';
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;

// All TOTP routes require authentication
router.use(requireAuth);

/**
 * Find user in both legacy and modern format
 */
function findUserInData(data, username) {
  // Modern multi-user format
  if (data.users && Array.isArray(data.users)) {
    const found = data.users.find(u => u.username === username);
    if (found) return { user: found, isLegacy: false };
  }
  // Legacy single-user format
  if (data.user && data.user.username === username) {
    return { user: data.user, isLegacy: true };
  }
  return null;
}

/**
 * Create a TOTP instance with the given secret.
 * @param {string} secretBase32 - Base32-encoded secret
 * @param {string} username - Account label for the TOTP URI
 * @returns {TOTP} TOTP instance
 */
function createTOTP(secretBase32, username) {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label: username,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(secretBase32)
  });
}

/**
 * GET /status
 * Check if 2FA is enabled for the current user.
 */
router.get('/status', async (req, res) => {
  try {
    const data = getData();
    const result = findUserInData(data, req.user.username);
    if (!result) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const user = result.user;

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      enabled: user.totpEnabled === true
    });
  } catch (error) {
    console.error('Error checking TOTP status:', error);
    res.status(500).json({ success: false, error: 'Failed to check 2FA status' });
  }
});

/**
 * POST /setup
 * Generate a new TOTP secret for 2FA setup.
 * Returns the secret (base32) and otpauth:// URI for QR code generation.
 */
router.post('/setup', async (req, res) => {
  try {
    const data = getData();
    const result = findUserInData(data, req.user.username);
    if (!result) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const user = result.user;

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Check if 2FA is already enabled
    if (user.totpEnabled) {
      return res.status(400).json({ success: false, error: '2FA is already enabled. Disable it first to set up again.' });
    }

    // Generate a new random secret
    const secret = new Secret({ size: 20 });
    const secretBase32 = secret.base32;

    // Create TOTP instance to generate the URI
    const totp = new TOTP({
      issuer: TOTP_ISSUER,
      label: req.user.username,
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
      secret: secret
    });

    const uri = totp.toString();

    logSecurityEvent('TOTP_SETUP', {
      user: req.user.username
    }, req.ip);

    // Return secret and URI (frontend generates QR from URI)
    res.json({
      success: true,
      secret: secretBase32,
      uri: uri,
      qr: uri // Frontend will use this to render a QR code
    });
  } catch (error) {
    console.error('Error setting up TOTP:', error);
    res.status(500).json({ success: false, error: 'Failed to set up 2FA' });
  }
});

/**
 * POST /verify
 * Verify a TOTP code during initial setup to confirm it works.
 * If valid, stores the secret and enables 2FA for the user.
 * Expects: { token, secret }
 */
router.post('/verify', async (req, res) => {
  try {
    const { token, secret } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: 'TOTP token is required' });
    }
    if (!secret || typeof secret !== 'string') {
      return res.status(400).json({ success: false, error: 'TOTP secret is required' });
    }

    // Sanitize token - should be exactly 6 digits
    const cleanToken = token.trim();
    if (!/^\d{6}$/.test(cleanToken)) {
      return res.status(400).json({ success: false, error: 'Token must be exactly 6 digits' });
    }

    // Validate the token against the provided secret
    const totp = createTOTP(secret, req.user.username);
    const delta = totp.validate({ token: cleanToken, window: 1 });

    if (delta === null) {
      logSecurityEvent('TOTP_VERIFY_FAILED', {
        user: req.user.username
      }, req.ip);
      return res.status(400).json({ success: false, error: 'Invalid TOTP code. Please try again.' });
    }

    // Token is valid - store secret and enable 2FA
    const data = getData();
    const found = findUserInData(data, req.user.username);
    if (!found) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    found.user.totpSecret = secret;
    found.user.totpEnabled = true;
    saveData(data);

    logSecurityEvent('TOTP_ENABLED', {
      user: req.user.username
    }, req.ip);

    res.json({ success: true, message: '2FA has been enabled successfully' });
  } catch (error) {
    console.error('Error verifying TOTP:', error);
    res.status(500).json({ success: false, error: 'Failed to verify TOTP code' });
  }
});

/**
 * POST /validate
 * Validate a TOTP code during login.
 * Expects: { token }
 */
router.post('/validate', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: 'TOTP token is required' });
    }

    // Sanitize token - should be exactly 6 digits
    const cleanToken = token.trim();
    if (!/^\d{6}$/.test(cleanToken)) {
      return res.status(400).json({ success: false, error: 'Token must be exactly 6 digits' });
    }

    // Get user's stored TOTP secret
    const data = getData();
    const result = findUserInData(data, req.user.username);
    if (!result) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const user = result.user;

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (!user.totpEnabled || !user.totpSecret) {
      return res.status(400).json({ success: false, error: '2FA is not enabled for this account' });
    }

    // Validate the token against stored secret
    const totp = createTOTP(user.totpSecret, req.user.username);
    const delta = totp.validate({ token: cleanToken, window: 1 });

    if (delta === null) {
      logSecurityEvent('TOTP_VALIDATE_FAILED', {
        user: req.user.username
      }, req.ip);
      return res.status(401).json({ success: false, error: 'Invalid TOTP code' });
    }

    logSecurityEvent('TOTP_VALIDATE_SUCCESS', {
      user: req.user.username
    }, req.ip);

    res.json({ success: true, message: 'TOTP code is valid' });
  } catch (error) {
    console.error('Error validating TOTP:', error);
    res.status(500).json({ success: false, error: 'Failed to validate TOTP code' });
  }
});

/**
 * DELETE /disable
 * Disable 2FA for the current user.
 * Requires password confirmation for security.
 * Expects: { password }
 */
router.delete('/disable', async (req, res) => {
  try {
    const { password } = req.body;

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Password confirmation is required to disable 2FA' });
    }

    const data = getData();
    const found = findUserInData(data, req.user.username);

    if (!found) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = found.user;

    if (!user.totpEnabled) {
      return res.status(400).json({ success: false, error: '2FA is not currently enabled' });
    }

    // Verify password using bcrypt (assuming password is hashed in user data)
    const bcrypt = require('bcrypt');
    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      logSecurityEvent('TOTP_DISABLE_FAILED', {
        user: req.user.username
      }, req.ip);
      return res.status(401).json({ success: false, error: 'Incorrect password' });
    }

    // Remove TOTP data and disable 2FA
    delete user.totpSecret;
    user.totpEnabled = false;
    saveData(data);

    logSecurityEvent('TOTP_DISABLED', {
      user: req.user.username
    }, req.ip);

    res.json({ success: true, message: '2FA has been disabled' });
  } catch (error) {
    console.error('Error disabling TOTP:', error);
    res.status(500).json({ success: false, error: 'Failed to disable 2FA' });
  }
});

module.exports = router;
