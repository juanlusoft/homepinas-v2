/**
 * Backup Scheduler - Cron-like scheduling for automatic backups
 */

const cron = require('node-cron');

class Scheduler {
  constructor(backupFn) {
    this.backupFn = backupFn;
    this.task = null;
    this.running = false;
  }

  start(cronExpr) {
    this.stop();

    if (!cronExpr || !cron.validate(cronExpr)) {
      console.error('Invalid cron expression:', cronExpr);
      return;
    }

    this.task = cron.schedule(cronExpr, async () => {
      if (this.running) {
        console.log('Scheduler: backup already running, skipping');
        return;
      }

      this.running = true;
      console.log('Scheduler: starting scheduled backup at', new Date().toISOString());
      
      try {
        await this.backupFn();
      } catch (err) {
        console.error('Scheduler: backup failed:', err.message);
      } finally {
        this.running = false;
      }
    });

    console.log('Scheduler: started with schedule', cronExpr);
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  restart(cronExpr) {
    this.stop();
    this.start(cronExpr);
  }

  isRunning() {
    return this.running;
  }
}

module.exports = { Scheduler };
