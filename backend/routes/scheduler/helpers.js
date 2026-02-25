/**
 * HomePiNAS v2 - Scheduler Helpers
 * Validation, crontab generation utilities
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getData } = require('../../utils/data');

/** Regex to validate standard 5-field cron expressions */
const CRON_REGEX = /^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/;

/** Dangerous command patterns that must be blocked for safety */
const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'mkfs',
  'dd if=',
  ':(){ :|:& };:',
  '> /dev/sda',
  'chmod -R 777 /',
  '$(', '`',       // command substitution
  '| ', ' |',      // pipes
  '; ',             // command chaining
  '&& ', '|| ',    // logical operators
  '> /dev/',        // writing to devices
  '/etc/shadow',    // sensitive files
  '/etc/passwd',
  'curl ', 'wget ', // downloads
  'python ', 'perl ', 'ruby ', // script interpreters
  'nc ', 'ncat ',   // netcat
  'base64',         // encoding tricks
  'eval ',          // eval
];

/**
 * Validate a cron expression string.
 */
function isValidCron(expr) {
  if (!expr || typeof expr !== 'string') return false;
  return CRON_REGEX.test(expr.trim());
}

/**
 * Check if a command contains dangerous patterns.
 */
function findDangerousPattern(command) {
  if (!command || typeof command !== 'string') return null;
  const lower = command.toLowerCase();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }
  return null;
}

/**
 * Generate a unique ID for tasks.
 */
function generateId() {
  return Date.now().toString(36);
}

/**
 * Write all enabled tasks to the system crontab.
 */
function writeCrontab() {
  return new Promise((resolve, reject) => {
    const data = getData();
    const tasks = data.scheduledTasks || [];

    // Build crontab content
    let content = '# HomePiNAS v2 - Managed Crontab\n';
    content += '# DO NOT EDIT MANUALLY - Changes will be overwritten by HomePiNAS\n';
    content += `# Last updated: ${new Date().toISOString()}\n\n`;

    tasks.forEach(task => {
      if (task.enabled) {
        // Active task: schedule command
        content += `# ${task.name} (ID: ${task.id})\n`;
        content += `${task.schedule} ${task.command}\n\n`;
      } else {
        // Disabled task: comment it out
        content += `# ${task.name} (ID: ${task.id}) [DISABLED]\n`;
        content += `# ${task.schedule} ${task.command}\n\n`;
      }
    });

    // Write to temp file
    const tmpFile = path.join('/mnt/storage/.tmp', `homepinas-crontab-${Date.now()}`);
    fs.writeFile(tmpFile, content, (writeErr) => {
      if (writeErr) {
        return reject(new Error(`Failed to write temp crontab: ${writeErr.message}`));
      }

      // Apply crontab from temp file
      execFile('crontab', [tmpFile], (execErr, stdout, stderr) => {
        // Clean up temp file regardless of result
        fs.unlink(tmpFile, () => {}); // Ignore cleanup errors

        if (execErr) {
          return reject(new Error(`Failed to apply crontab: ${execErr.message}`));
        }
        resolve();
      });
    });
  });
}

module.exports = {
    CRON_REGEX,
    DANGEROUS_PATTERNS,
    isValidCron,
    findDangerousPattern,
    generateId,
    writeCrontab
};
