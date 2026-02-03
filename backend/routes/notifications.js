/**
 * HomePiNAS v2 - Notification System Routes
 * 
 * Email (nodemailer) and Telegram bot notification management.
 * Supports configuration, testing, sending, and history viewing.
 */

const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const { sanitizeString } = require('../utils/sanitize');
const { getData, saveData } = require('../utils/data');

// All notification routes require authentication
router.use(requireAuth);

/**
 * Mask a sensitive string, showing only the last 4 characters.
 * Returns '••••XXXX' or '(not set)' if empty.
 */
function maskSensitive(value) {
  if (!value || typeof value !== 'string') return '(not set)';
  if (value.length <= 4) return '••••';
  return '••••' + value.slice(-4);
}

/**
 * GET /config
 * Retrieve notification configuration with sensitive fields masked.
 */
router.get('/config', async (req, res) => {
  try {
    const data = getData();
    const notifications = data.notifications || {};
    const email = notifications.email || {};
    const telegram = notifications.telegram || {};

    res.json({
      success: true,
      config: {
        email: {
          host: email.host || '',
          port: email.port || 587,
          secure: email.secure || false,
          user: email.user || '',
          password: maskSensitive(email.password),
          from: email.from || '',
          to: email.to || '',
          configured: !!(email.host && email.user && email.password)
        },
        telegram: {
          botToken: maskSensitive(telegram.botToken),
          chatId: telegram.chatId || '',
          enabled: telegram.enabled || false,
          configured: !!(telegram.botToken && telegram.chatId)
        }
      }
    });
  } catch (error) {
    console.error('Error getting notification config:', error);
    res.status(500).json({ success: false, error: 'Failed to get notification config' });
  }
});

/**
 * POST /config/email
 * Save email SMTP configuration.
 * Expects: { host, port, secure, user, password, from, to }
 */
router.post('/config/email', async (req, res) => {
  try {
    const { host, port, secure, user, password, from, to } = req.body;

    // Validate all required fields
    if (!host || typeof host !== 'string' || !host.trim()) {
      return res.status(400).json({ success: false, error: 'SMTP host is required' });
    }
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return res.status(400).json({ success: false, error: 'Port must be between 1 and 65535' });
    }
    if (typeof secure !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Secure must be a boolean' });
    }
    if (!user || typeof user !== 'string' || !user.trim()) {
      return res.status(400).json({ success: false, error: 'SMTP user is required' });
    }
    if (!password || typeof password !== 'string' || !password.trim()) {
      return res.status(400).json({ success: false, error: 'SMTP password is required' });
    }
    if (!from || typeof from !== 'string' || !from.trim()) {
      return res.status(400).json({ success: false, error: 'From address is required' });
    }
    if (!to || typeof to !== 'string' || !to.trim()) {
      return res.status(400).json({ success: false, error: 'To address is required' });
    }

    // Sanitize inputs
    const emailConfig = {
      host: sanitizeString(host.trim()),
      port: portNum,
      secure: secure,
      user: sanitizeString(user.trim()),
      password: password.trim(), // Don't sanitize password (may contain special chars)
      from: sanitizeString(from.trim()),
      to: sanitizeString(to.trim())
    };

    // Save to data store
    const data = getData();
    if (!data.notifications) data.notifications = {};
    data.notifications.email = emailConfig;
    saveData(data);

    logSecurityEvent('notifications', 'email_config_updated', {
      user: req.user.username,
      host: emailConfig.host,
      port: emailConfig.port
    });

    res.json({ success: true, message: 'Email configuration saved' });
  } catch (error) {
    console.error('Error saving email config:', error);
    res.status(500).json({ success: false, error: 'Failed to save email config' });
  }
});

/**
 * POST /config/telegram
 * Save Telegram bot configuration.
 * Expects: { botToken, chatId, enabled }
 */
router.post('/config/telegram', async (req, res) => {
  try {
    const { botToken, chatId, enabled } = req.body;

    if (!botToken || typeof botToken !== 'string' || !botToken.trim()) {
      return res.status(400).json({ success: false, error: 'Bot token is required' });
    }
    if (!chatId || (typeof chatId !== 'string' && typeof chatId !== 'number')) {
      return res.status(400).json({ success: false, error: 'Chat ID is required' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Enabled must be a boolean' });
    }

    const telegramConfig = {
      botToken: botToken.trim(),
      chatId: String(chatId).trim(),
      enabled: enabled
    };

    const data = getData();
    if (!data.notifications) data.notifications = {};
    data.notifications.telegram = telegramConfig;
    saveData(data);

    logSecurityEvent('notifications', 'telegram_config_updated', {
      user: req.user.username,
      enabled: telegramConfig.enabled
    });

    res.json({ success: true, message: 'Telegram configuration saved' });
  } catch (error) {
    console.error('Error saving Telegram config:', error);
    res.status(500).json({ success: false, error: 'Failed to save Telegram config' });
  }
});

/**
 * POST /test/email
 * Send a test email using the stored SMTP configuration.
 */
router.post('/test/email', async (req, res) => {
  try {
    const data = getData();
    const emailConfig = data.notifications?.email;

    if (!emailConfig || !emailConfig.host || !emailConfig.user || !emailConfig.password) {
      return res.status(400).json({ success: false, error: 'Email not configured. Please save email settings first.' });
    }

    // Create nodemailer transporter with stored config
    const transporter = nodemailer.createTransport({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      auth: {
        user: emailConfig.user,
        pass: emailConfig.password
      }
    });

    // Send test email
    const info = await transporter.sendMail({
      from: emailConfig.from,
      to: emailConfig.to,
      subject: 'HomePiNAS Test Notification',
      text: 'This is a test notification from HomePiNAS. If you received this email, your notification settings are working correctly!',
      html: '<h2>HomePiNAS Test Notification</h2><p>This is a test notification from HomePiNAS. If you received this email, your notification settings are working correctly!</p>'
    });

    logSecurityEvent('notifications', 'test_email_sent', {
      user: req.user.username,
      messageId: info.messageId
    });

    res.json({ success: true, message: 'Test email sent successfully', messageId: info.messageId });
  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({ success: false, error: `Failed to send test email: ${error.message}` });
  }
});

/**
 * POST /test/telegram
 * Send a test message via Telegram bot API.
 */
router.post('/test/telegram', async (req, res) => {
  try {
    const data = getData();
    const telegramConfig = data.notifications?.telegram;

    if (!telegramConfig || !telegramConfig.botToken || !telegramConfig.chatId) {
      return res.status(400).json({ success: false, error: 'Telegram not configured. Please save Telegram settings first.' });
    }

    const url = `https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramConfig.chatId,
        text: '✅ *HomePiNAS Test Notification*\n\nThis is a test message. Your Telegram notifications are working correctly!',
        parse_mode: 'Markdown'
      })
    });

    const result = await response.json();

    if (!result.ok) {
      return res.status(400).json({ success: false, error: `Telegram API error: ${result.description}` });
    }

    logSecurityEvent('notifications', 'test_telegram_sent', {
      user: req.user.username,
      chatId: telegramConfig.chatId
    });

    res.json({ success: true, message: 'Test Telegram message sent successfully' });
  } catch (error) {
    console.error('Error sending test Telegram message:', error);
    res.status(500).json({ success: false, error: `Failed to send test Telegram message: ${error.message}` });
  }
});

/**
 * POST /send
 * Internal endpoint to send notifications via configured channels.
 * Used by other features to trigger notifications.
 * Expects: { title, message, channels: ['email', 'telegram'] }
 */
router.post('/send', async (req, res) => {
  try {
    const { title, message, channels } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }
    if (!Array.isArray(channels) || channels.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one channel is required' });
    }

    const data = getData();
    const results = { email: null, telegram: null };
    const errors = [];

    // Send via email if requested
    if (channels.includes('email')) {
      const emailConfig = data.notifications?.email;
      if (emailConfig && emailConfig.host && emailConfig.user && emailConfig.password) {
        try {
          const transporter = nodemailer.createTransport({
            host: emailConfig.host,
            port: emailConfig.port,
            secure: emailConfig.secure,
            auth: { user: emailConfig.user, pass: emailConfig.password }
          });

          await transporter.sendMail({
            from: emailConfig.from,
            to: emailConfig.to,
            subject: `HomePiNAS: ${sanitizeString(title)}`,
            text: message,
            html: `<h2>${sanitizeString(title)}</h2><p>${sanitizeString(message)}</p>`
          });
          results.email = 'sent';
        } catch (err) {
          errors.push(`Email: ${err.message}`);
          results.email = 'failed';
        }
      } else {
        errors.push('Email: not configured');
        results.email = 'not_configured';
      }
    }

    // Send via Telegram if requested
    if (channels.includes('telegram')) {
      const telegramConfig = data.notifications?.telegram;
      if (telegramConfig && telegramConfig.botToken && telegramConfig.chatId && telegramConfig.enabled) {
        try {
          const url = `https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramConfig.chatId,
              text: `📢 *${title}*\n\n${message}`,
              parse_mode: 'Markdown'
            })
          });
          const result = await response.json();
          if (!result.ok) {
            errors.push(`Telegram: ${result.description}`);
            results.telegram = 'failed';
          } else {
            results.telegram = 'sent';
          }
        } catch (err) {
          errors.push(`Telegram: ${err.message}`);
          results.telegram = 'failed';
        }
      } else {
        errors.push('Telegram: not configured or disabled');
        results.telegram = 'not_configured';
      }
    }

    // Record notification in history
    if (!data.notifications) data.notifications = {};
    if (!data.notifications.history) data.notifications.history = [];
    data.notifications.history.unshift({
      id: Date.now(),
      title: sanitizeString(title),
      message: sanitizeString(message),
      channels: channels,
      results: results,
      timestamp: new Date().toISOString()
    });
    // Keep only last 200 notifications in history
    if (data.notifications.history.length > 200) {
      data.notifications.history = data.notifications.history.slice(0, 200);
    }
    saveData(data);

    const hasErrors = errors.length > 0;
    res.json({
      success: !hasErrors || Object.values(results).some(r => r === 'sent'),
      results: results,
      errors: hasErrors ? errors : undefined,
      message: hasErrors ? 'Some notifications failed' : 'All notifications sent'
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  }
});

/**
 * GET /history
 * Get the last 50 notification history entries.
 */
router.get('/history', async (req, res) => {
  try {
    const data = getData();
    const history = data.notifications?.history || [];
    // Return the last 50 entries (already sorted newest first)
    const recent = history.slice(0, 50);

    res.json({ success: true, history: recent, total: history.length });
  } catch (error) {
    console.error('Error getting notification history:', error);
    res.status(500).json({ success: false, error: 'Failed to get notification history' });
  }
});

module.exports = router;
