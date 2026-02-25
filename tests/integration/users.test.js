/**
 * HomePiNAS - Integration Tests: User Management
 * 
 * Tests user management endpoints:
 * - List users (admin only)
 * - Create new users
 * - Update user information
 * - Delete users
 * - Role-based access control
 */

const request = require('supertest');
const app = require('../../backend/test-app');
const { getData, saveData } = require('../../backend/utils/data');
const bcrypt = require('bcrypt');

describe('User Management Integration Tests', () => {
  let adminCookie;
  let regularUserCookie;
  let adminUser;
  let regularUser;

  beforeAll(async () => {
    // Create test admin user
    const adminPassword = await bcrypt.hash('admin123', 12);
    adminUser = {
      username: 'testadmin',
      password: adminPassword,
      role: 'admin',
      createdAt: new Date().toISOString()
    };

    // Create test regular user
    const userPassword = await bcrypt.hash('user123', 12);
    regularUser = {
      username: 'testregular',
      password: userPassword,
      role: 'user',
      createdAt: new Date().toISOString()
    };

    const data = getData();
    data.user = adminUser;
    data.users = [adminUser, regularUser];
    saveData(data);

    // Login as admin
    const adminLoginResponse = await request(app)
      .post('/api/login')
      .send({
        username: 'testadmin',
        password: 'admin123'
      });

    adminCookie = adminLoginResponse.headers['set-cookie'][0];

    // Login as regular user
    const userLoginResponse = await request(app)
      .post('/api/login')
      .send({
        username: 'testregular',
        password: 'user123'
      });

    regularUserCookie = userLoginResponse.headers['set-cookie'][0];
  });

  afterAll(() => {
    // Clean up test users
    const data = getData();
    delete data.user;
    data.users = [];
    saveData(data);
  });

  describe('GET /api/users', () => {
    it('should return list of users for admin', async () => {
      const response = await request(app)
        .get('/api/users')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(response.body).toHaveProperty('users');
      expect(Array.isArray(response.body.users)).toBe(true);
      expect(response.body.users.length).toBeGreaterThanOrEqual(2);

      // Verify passwords are not exposed
      response.body.users.forEach(user => {
        expect(user).not.toHaveProperty('password');
      });
    });

    it('should deny access for non-admin users', async () => {
      await request(app)
        .get('/api/users')
        .set('Cookie', regularUserCookie)
        .expect(403);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/users')
        .expect(401);
    });
  });

  describe('POST /api/users', () => {
    it('should create a new user as admin', async () => {
      const response = await request(app)
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({
          username: 'newuser',
          password: 'newpass123',
          role: 'user'
        })
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.username).toBe('newuser');
      expect(response.body.user).not.toHaveProperty('password');

      // Verify user was actually created
      const listResponse = await request(app)
        .get('/api/users')
        .set('Cookie', adminCookie)
        .expect(200);

      const createdUser = listResponse.body.users.find(u => u.username === 'newuser');
      expect(createdUser).toBeDefined();
      expect(createdUser.role).toBe('user');
    });

    it('should reject duplicate username', async () => {
      await request(app)
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({
          username: 'testadmin',
          password: 'somepass123',
          role: 'user'
        })
        .expect(409);
    });

    it('should validate password strength', async () => {
      await request(app)
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({
          username: 'weakpass',
          password: '123',
          role: 'user'
        })
        .expect(400);
    });

    it('should deny access for non-admin users', async () => {
      await request(app)
        .post('/api/users')
        .set('Cookie', regularUserCookie)
        .send({
          username: 'unauthorized',
          password: 'pass123',
          role: 'user'
        })
        .expect(403);
    });

    it('should require authentication', async () => {
      await request(app)
        .post('/api/users')
        .send({
          username: 'noauth',
          password: 'pass123',
          role: 'user'
        })
        .expect(401);
    });
  });

  describe('PUT /api/users/:username', () => {
    beforeAll(async () => {
      // Create a user to update
      await request(app)
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({
          username: 'updateme',
          password: 'initial123',
          role: 'user'
        });
    });

    it('should update user role as admin', async () => {
      const response = await request(app)
        .put('/api/users/updateme')
        .set('Cookie', adminCookie)
        .send({
          role: 'readonly'
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);

      // Verify the update
      const listResponse = await request(app)
        .get('/api/users')
        .set('Cookie', adminCookie);

      const updatedUser = listResponse.body.users.find(u => u.username === 'updateme');
      expect(updatedUser.role).toBe('readonly');
    });

    it('should update user password as admin', async () => {
      await request(app)
        .put('/api/users/updateme')
        .set('Cookie', adminCookie)
        .send({
          password: 'newpassword123'
        })
        .expect(200);

      // Verify new password works
      const loginResponse = await request(app)
        .post('/api/login')
        .send({
          username: 'updateme',
          password: 'newpassword123'
        })
        .expect(200);

      expect(loginResponse.body).toHaveProperty('success', true);
    });

    it('should deny access for non-admin users', async () => {
      await request(app)
        .put('/api/users/updateme')
        .set('Cookie', regularUserCookie)
        .send({
          role: 'admin'
        })
        .expect(403);
    });

    it('should return 404 for non-existent user', async () => {
      await request(app)
        .put('/api/users/nonexistent')
        .set('Cookie', adminCookie)
        .send({
          role: 'user'
        })
        .expect(404);
    });
  });

  describe('DELETE /api/users/:username', () => {
    beforeAll(async () => {
      // Create a user to delete
      await request(app)
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({
          username: 'deleteme',
          password: 'delete123',
          role: 'user'
        });
    });

    it('should delete user as admin', async () => {
      const response = await request(app)
        .delete('/api/users/deleteme')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);

      // Verify user was deleted
      const listResponse = await request(app)
        .get('/api/users')
        .set('Cookie', adminCookie);

      const deletedUser = listResponse.body.users.find(u => u.username === 'deleteme');
      expect(deletedUser).toBeUndefined();
    });

    it('should prevent deleting the last admin', async () => {
      // Get list of admins
      const listResponse = await request(app)
        .get('/api/users')
        .set('Cookie', adminCookie);

      const admins = listResponse.body.users.filter(u => u.role === 'admin');

      if (admins.length === 1) {
        // Try to delete the last admin
        await request(app)
          .delete(`/api/users/${admins[0].username}`)
          .set('Cookie', adminCookie)
          .expect(403);
      } else {
        // If multiple admins exist, this test is not applicable
        expect(admins.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should deny access for non-admin users', async () => {
      await request(app)
        .delete('/api/users/testadmin')
        .set('Cookie', regularUserCookie)
        .expect(403);
    });

    it('should return 404 for non-existent user', async () => {
      await request(app)
        .delete('/api/users/nonexistent')
        .set('Cookie', adminCookie)
        .expect(404);
    });
  });

  describe('GET /api/users/me', () => {
    it('should return current user profile', async () => {
      const response = await request(app)
        .get('/api/users/me')
        .set('Cookie', regularUserCookie)
        .expect(200);

      expect(response.body).toHaveProperty('username', 'testregular');
      expect(response.body).toHaveProperty('role', 'user');
      expect(response.body).not.toHaveProperty('password');
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/users/me')
        .expect(401);
    });
  });

  describe('PUT /api/users/me/password', () => {
    it('should allow user to change own password', async () => {
      await request(app)
        .put('/api/users/me/password')
        .set('Cookie', regularUserCookie)
        .send({
          currentPassword: 'user123',
          newPassword: 'newuserpass123'
        })
        .expect(200);

      // Verify new password works
      const loginResponse = await request(app)
        .post('/api/login')
        .send({
          username: 'testregular',
          password: 'newuserpass123'
        })
        .expect(200);

      expect(loginResponse.body).toHaveProperty('success', true);
    });

    it('should reject incorrect current password', async () => {
      await request(app)
        .put('/api/users/me/password')
        .set('Cookie', adminCookie)
        .send({
          currentPassword: 'wrongpassword',
          newPassword: 'newpass123'
        })
        .expect(401);
    });

    it('should validate new password strength', async () => {
      await request(app)
        .put('/api/users/me/password')
        .set('Cookie', adminCookie)
        .send({
          currentPassword: 'admin123',
          newPassword: '123'
        })
        .expect(400);
    });
  });
});
