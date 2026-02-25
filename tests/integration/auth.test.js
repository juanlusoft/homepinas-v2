/**
 * HomePiNAS - Integration Tests: Authentication
 * 
 * Tests the complete authentication flow:
 * - Login with valid/invalid credentials
 * - Session management
 * - Protected routes access control
 */

const request = require('supertest');
const app = require('../../backend/test-app');
const { getData, saveData } = require('../../backend/utils/data');
const bcrypt = require('bcrypt');

describe('Authentication Integration Tests', () => {
  let testUser;
  let csrfToken;

  beforeAll(async () => {
    // Create a test user for authentication tests
    const hashedPassword = await bcrypt.hash('testpass123', 12);
    testUser = {
      username: 'testuser',
      password: hashedPassword,
      role: 'admin',
      createdAt: new Date().toISOString()
    };

    // Save test user to data store
    const data = getData();
    data.user = testUser;
    data.users = [testUser];
    saveData(data);
  });

  afterAll(() => {
    // Clean up test user
    const data = getData();
    delete data.user;
    data.users = [];
    saveData(data);
  });

  describe('POST /api/login', () => {
    it('should return 200 and set session cookie with valid credentials', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          username: 'testuser',
          password: 'testpass123'
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.username).toBe('testuser');
      expect(response.headers['set-cookie']).toBeDefined();
      
      // Extract session cookie for subsequent tests
      const cookies = response.headers['set-cookie'];
      expect(cookies.some(cookie => cookie.startsWith('sessionId='))).toBe(true);
    });

    it('should return 401 with invalid credentials', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          username: 'testuser',
          password: 'wrongpassword'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 401 with non-existent user', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          username: 'nonexistent',
          password: 'somepassword'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 with missing credentials', async () => {
      await request(app)
        .post('/api/login')
        .send({})
        .expect(400);
    });
  });

  describe('Protected Routes Access Control', () => {
    let sessionCookie;

    beforeAll(async () => {
      // Login to get a valid session
      const loginResponse = await request(app)
        .post('/api/login')
        .send({
          username: 'testuser',
          password: 'testpass123'
        });

      sessionCookie = loginResponse.headers['set-cookie'][0];
    });

    it('should return 401 when accessing protected route without session', async () => {
      await request(app)
        .get('/api/system/stats')
        .expect(401);
    });

    it('should return 200 when accessing protected route with valid session', async () => {
      const response = await request(app)
        .get('/api/system/stats')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should access storage status with valid session', async () => {
      const response = await request(app)
        .get('/api/storage/pool/status')
        .set('Cookie', sessionCookie);

      // May return 200 with data or 500 if storage not configured (both OK for integration test)
      expect([200, 500]).toContain(response.status);
    });
  });

  describe('POST /api/logout', () => {
    it('should destroy session and return 200', async () => {
      // Login first
      const loginResponse = await request(app)
        .post('/api/login')
        .send({
          username: 'testuser',
          password: 'testpass123'
        });

      const sessionCookie = loginResponse.headers['set-cookie'][0];

      // Logout
      await request(app)
        .post('/api/logout')
        .set('Cookie', sessionCookie)
        .expect(200);

      // Try to access protected route with old session - should fail
      await request(app)
        .get('/api/system/stats')
        .set('Cookie', sessionCookie)
        .expect(401);
    });
  });

  describe('Session Verification', () => {
    it('should verify valid session', async () => {
      // Login
      const loginResponse = await request(app)
        .post('/api/login')
        .send({
          username: 'testuser',
          password: 'testpass123'
        });

      const sessionCookie = loginResponse.headers['set-cookie'][0];

      // Verify session
      const response = await request(app)
        .post('/api/verify-session')
        .set('Cookie', sessionCookie)
        .expect(200);

      expect(response.body).toHaveProperty('valid', true);
      expect(response.body).toHaveProperty('user');
    });

    it('should reject invalid session', async () => {
      await request(app)
        .post('/api/verify-session')
        .expect(401);
    });
  });
});
