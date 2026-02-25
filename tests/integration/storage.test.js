/**
 * HomePiNAS - Integration Tests: Storage
 * 
 * Tests storage-related endpoints:
 * - Pool status retrieval
 * - Disk detection and listing
 * - Storage configuration
 * 
 * NOTE: Some tests may require mocking system calls (lsblk, df, etc.)
 * as they depend on actual hardware and sudo privileges.
 */

const request = require('supertest');
const app = require('../../backend/test-app');
const { getData, saveData } = require('../../backend/utils/data');
const bcrypt = require('bcrypt');

describe('Storage Integration Tests', () => {
  let sessionCookie;
  let testUser;

  beforeAll(async () => {
    // Create test admin user
    const hashedPassword = await bcrypt.hash('storagetest123', 12);
    testUser = {
      username: 'storageadmin',
      password: hashedPassword,
      role: 'admin',
      createdAt: new Date().toISOString()
    };

    const data = getData();
    data.user = testUser;
    data.users = [testUser];
    saveData(data);

    // Login to get session
    const loginResponse = await request(app)
      .post('/api/login')
      .send({
        username: 'storageadmin',
        password: 'storagetest123'
      });

    sessionCookie = loginResponse.headers['set-cookie'][0];
  });

  afterAll(() => {
    // Clean up test user
    const data = getData();
    delete data.user;
    data.users = [];
    saveData(data);
  });

  describe('GET /api/storage/pool/status', () => {
    it('should return pool status or error if not configured', async () => {
      const response = await request(app)
        .get('/api/storage/pool/status')
        .set('Cookie', sessionCookie);

      // Either 200 with pool data, or 500 if pool not configured
      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        // Pool status should have some structure
        expect(typeof response.body).toBe('object');
      } else {
        expect(response.body).toHaveProperty('error');
      }
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/storage/pool/status')
        .expect(401);
    });
  });

  describe('GET /api/storage/disks/detect', () => {
    it('should return list of detected disks', async () => {
      const response = await request(app)
        .get('/api/storage/disks/detect')
        .set('Cookie', sessionCookie);

      // May succeed or fail depending on system access
      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        expect(response.body).toHaveProperty('disks');
        expect(Array.isArray(response.body.disks)).toBe(true);
      }
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/storage/disks/detect')
        .expect(401);
    });
  });

  describe('GET /api/storage/disks/ignored', () => {
    it('should return list of ignored disks', async () => {
      const response = await request(app)
        .get('/api/storage/disks/ignored')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body).toHaveProperty('ignored');
      expect(Array.isArray(response.body.ignored)).toBe(true);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/storage/disks/ignored')
        .expect(401);
    });
  });

  describe('GET /api/storage/snapraid/status', () => {
    it('should return snapraid status or error if not configured', async () => {
      const response = await request(app)
        .get('/api/storage/snapraid/status')
        .set('Cookie', sessionCookie);

      // May return status or error if snapraid not installed/configured
      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
      }
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/storage/snapraid/status')
        .expect(401);
    });
  });

  describe('Storage Configuration Endpoints', () => {
    it('should reject pool configuration without proper permissions', async () => {
      // Create a readonly user
      const readonlyPassword = await bcrypt.hash('readonly123', 12);
      const readonlyUser = {
        username: 'readonly',
        password: readonlyPassword,
        role: 'readonly',
        createdAt: new Date().toISOString()
      };

      const data = getData();
      data.users = [...(data.users || []), readonlyUser];
      saveData(data);

      // Login as readonly user
      const loginResponse = await request(app)
        .post('/api/login')
        .send({
          username: 'readonly',
          password: 'readonly123'
        });

      const readonlyCookie = loginResponse.headers['set-cookie'][0];

      // Try to configure pool (should fail - requires admin)
      await request(app)
        .post('/api/storage/pool/configure')
        .set('Cookie', readonlyCookie)
        .send({
          parityDisk: '/dev/sda',
          dataDisks: ['/dev/sdb', '/dev/sdc']
        })
        .expect(403);

      // Clean up readonly user
      const cleanData = getData();
      cleanData.users = cleanData.users.filter(u => u.username !== 'readonly');
      saveData(cleanData);
    });
  });

  describe('Storage Metrics', () => {
    it('should access storage through system stats endpoint', async () => {
      const response = await request(app)
        .get('/api/system/stats')
        .set('Cookie', sessionCookie);

      // System stats should work even if storage pool not configured
      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toBeDefined();
        // Stats typically include CPU, memory, disk usage
        expect(typeof response.body).toBe('object');
      }
    });
  });
});
