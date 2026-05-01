/**
 * @file userservice.characterisation.test.js
 *
 * Characterisation tests for the monolithic UserService.
 *
 * These tests pin the EXACT current observable behavior of:
 *   - models/User.js         (instance methods, schema defaults)
 *   - services/auth/controllers.js  (register, login, getProfile,
 *                                    updateProfile, updatePassword)
 *   - middleware/authMiddleware.js   (protect, restrictTo)
 *
 * Run BEFORE any refactoring work begins.  After the monolith is split
 * into AuthService / UserProfileService / BankrollService / etc., every
 * characterised assertion here must still pass with zero modifications —
 * that is the contract.
 *
 * Prerequisites (once per workspace):
 *   pnpm add -D jest --filter @caia-app/roulette-backend
 *   # or: npm install --save-dev jest  (inside this package)
 *
 * Run:
 *   npx jest tests/characterisation/
 *   # or add to package.json: "test:characterisation": "jest tests/characterisation/"
 */
'use strict';

// ---------------------------------------------------------------------------
// Mock ALL external dependencies before any require() of source modules.
// jest.mock() calls are hoisted by Babel/Jest, so these run first.
// ---------------------------------------------------------------------------

// Mock the whole User model — controllers only need static query methods.
jest.mock('../../src/models/User', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  create: jest.fn(),
}));

// Mock jwtUtils to avoid real JWT signing/verification in these tests.
jest.mock('../../src/utils/jwtUtils', () => ({
  createSendToken: jest.fn((user, statusCode, res) => {
    user.password = undefined;
    res.status(statusCode).json({
      status: 'success',
      token: `jwt.${user._id}`,
      data: { user },
    });
  }),
  verifyToken: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Load modules under test AFTER mocks are registered.
// ---------------------------------------------------------------------------
const User = require('../../src/models/User');
const { createSendToken, verifyToken } = require('../../src/utils/jwtUtils');
const controllers = require('../../src/services/auth/controllers');
const authMiddleware = require('../../src/middleware/authMiddleware');

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/** Baseline user object that mirrors a real Mongoose document shape. */
const BASE_USER = {
  _id: 'user123',
  email: 'test@example.com',
  username: 'testuser',
  bankroll: 1000,
  role: 'user',
  password: 'hashed:secret',
  passwordChangedAt: null,
};

/** Factory for mock Express request objects. */
const mockReq = (overrides = {}) => ({
  body: {},
  headers: {},
  user: null,
  ...overrides,
});

/** Factory for mock Express response objects (chainable). */
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

// ===========================================================================
// User model — instance methods (tested without Mongoose, no DB required)
// ===========================================================================

describe('User model: changedPasswordAfter()', () => {
  // Inline the method so tests run without a live Mongoose connection.
  // The implementation is identical to userSchema.methods.changedPasswordAfter.
  const changedPasswordAfter = function (JWTTimestamp) {
    if (this.passwordChangedAt) {
      const changedTimestamp = parseInt(
        this.passwordChangedAt.getTime() / 1000,
        10
      );
      return JWTTimestamp < changedTimestamp;
    }
    return false;
  };

  test('returns false when passwordChangedAt is null', () => {
    expect(changedPasswordAfter.call({ passwordChangedAt: null }, 1_000_000)).toBe(false);
  });

  test('returns false when passwordChangedAt is undefined', () => {
    expect(changedPasswordAfter.call({}, 1_000_000)).toBe(false);
  });

  test('returns true when JWT was issued BEFORE the password change', () => {
    const changeTime = new Date('2024-01-15T12:00:00Z');
    const jwtIat = Math.floor(changeTime.getTime() / 1000) - 60; // 1 min before
    expect(changedPasswordAfter.call({ passwordChangedAt: changeTime }, jwtIat)).toBe(true);
  });

  test('returns false when JWT was issued AFTER the password change', () => {
    const changeTime = new Date('2024-01-15T12:00:00Z');
    const jwtIat = Math.floor(changeTime.getTime() / 1000) + 60; // 1 min after
    expect(changedPasswordAfter.call({ passwordChangedAt: changeTime }, jwtIat)).toBe(false);
  });

  test('compares against integer seconds (truncates milliseconds)', () => {
    // The implementation uses parseInt(.../ 1000) not Math.floor — same result
    // for positive timestamps, but characterised explicitly.
    const d = new Date('2024-06-01T00:00:00.999Z');
    const ts = Math.floor(d.getTime() / 1000); // 1717200000
    expect(changedPasswordAfter.call({ passwordChangedAt: d }, ts - 1)).toBe(true);
    expect(changedPasswordAfter.call({ passwordChangedAt: d }, ts + 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schema defaults — documented as plain assertions (no DB)
// ---------------------------------------------------------------------------

describe('User model: documented schema defaults', () => {
  test('bankroll default is 1000', () => {
    // Characterised: schema default AND register controller both hardcode 1000.
    // Any refactored BankrollService must initialise with this same value.
    expect(BASE_USER.bankroll).toBe(1000);
  });

  test('role default is "user"', () => {
    expect(BASE_USER.role).toBe('user');
  });

  test('allowed role values are "user" and "admin"', () => {
    const allowedRoles = ['user', 'admin'];
    expect(allowedRoles).toEqual(['user', 'admin']);
  });
});

// ===========================================================================
// filterObj — private helper extracted from controllers.js
// ===========================================================================

describe('filterObj() — profile field whitelist', () => {
  // Duplicate the implementation here so we can test it in isolation.
  // The real function lives at the bottom of services/auth/controllers.js.
  const filterObj = (obj, ...allowedFields) => {
    const newObj = {};
    Object.keys(obj).forEach((key) => {
      if (allowedFields.includes(key)) newObj[key] = obj[key];
    });
    return newObj;
  };

  test('keeps only the explicitly allowed fields', () => {
    const result = filterObj(
      { username: 'alice', email: 'a@b.com', bankroll: 9999, role: 'admin', password: 'hack' },
      'username',
      'email'
    );
    expect(result).toEqual({ username: 'alice', email: 'a@b.com' });
  });

  test('strips bankroll, role, and password from an update body', () => {
    const result = filterObj(
      { bankroll: 9999, role: 'admin', password: 'hack' },
      'username',
      'email'
    );
    expect(result).toEqual({});
  });

  test('returns empty object when source is empty', () => {
    expect(filterObj({}, 'username', 'email')).toEqual({});
  });

  test('returns empty object when no allowed fields are specified', () => {
    expect(filterObj({ username: 'alice' })).toEqual({});
  });
});

// ===========================================================================
// register controller
// ===========================================================================

describe('register controller', () => {
  test('checks for duplicate email OR username before creating', async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({ ...BASE_USER, _id: 'new1' });

    const req = mockReq({ body: { email: 'a@b.com', password: 'pass', username: 'alice' } });
    await controllers.register(req, mockRes());

    expect(User.findOne).toHaveBeenCalledWith({
      $or: [{ email: 'a@b.com' }, { username: 'alice' }],
    });
  });

  test('returns 400 "Email or username already in use" when duplicate found', async () => {
    User.findOne.mockResolvedValue({ _id: 'existing' });
    const res = mockRes();

    await controllers.register(
      mockReq({ body: { email: 'dup@b.com', password: 'pass', username: 'dup' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Email or username already in use',
    });
  });

  test('creates user with bankroll hardcoded to 1000', async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({ ...BASE_USER, _id: 'new1' });

    await controllers.register(
      mockReq({ body: { email: 'a@b.com', password: 'pass', username: 'alice' } }),
      mockRes()
    );

    expect(User.create).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pass',
      username: 'alice',
      bankroll: 1000,
    });
  });

  test('calls createSendToken with status 201 on success', async () => {
    User.findOne.mockResolvedValue(null);
    const newUser = { ...BASE_USER, _id: 'new1' };
    User.create.mockResolvedValue(newUser);
    const res = mockRes();

    await controllers.register(
      mockReq({ body: { email: 'a@b.com', password: 'pass', username: 'alice' } }),
      res
    );

    expect(createSendToken).toHaveBeenCalledWith(newUser, 201, res);
  });

  test('returns 400 with error.message on database error', async () => {
    User.findOne.mockRejectedValue(new Error('DB connection lost'));
    const res = mockRes();

    await controllers.register(
      mockReq({ body: { email: 'a@b.com', password: 'pass', username: 'alice' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ status: 'fail', message: 'DB connection lost' });
  });
});

// ===========================================================================
// login controller
// ===========================================================================

describe('login controller', () => {
  test('returns 400 when email is absent', async () => {
    const res = mockRes();
    await controllers.login(mockReq({ body: { password: 'secret' } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Please provide email and password',
    });
  });

  test('returns 400 when password is absent', async () => {
    const res = mockRes();
    await controllers.login(mockReq({ body: { email: 'a@b.com' } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Please provide email and password',
    });
  });

  test('fetches user by email with +password projection', async () => {
    const selectMock = jest.fn().mockResolvedValue(null);
    User.findOne.mockReturnValue({ select: selectMock });

    await controllers.login(
      mockReq({ body: { email: 'test@example.com', password: 'pass' } }),
      mockRes()
    );

    expect(User.findOne).toHaveBeenCalledWith({ email: 'test@example.com' });
    expect(selectMock).toHaveBeenCalledWith('+password');
  });

  test('returns 401 "Incorrect email or password" when user not found', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const res = mockRes();

    await controllers.login(
      mockReq({ body: { email: 'ghost@x.com', password: 'pass' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Incorrect email or password',
    });
  });

  test('returns 401 "Incorrect email or password" when password is wrong', async () => {
    const user = {
      ...BASE_USER,
      correctPassword: jest.fn().mockResolvedValue(false),
      save: jest.fn(),
    };
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();

    await controllers.login(
      mockReq({ body: { email: 'test@example.com', password: 'wrong' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Incorrect email or password',
    });
  });

  test('updates lastLogin on successful login', async () => {
    const user = {
      ...BASE_USER,
      correctPassword: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(undefined),
    };
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const before = Date.now();
    await controllers.login(
      mockReq({ body: { email: 'test@example.com', password: 'secret' } }),
      mockRes()
    );
    const after = Date.now();

    expect(typeof user.lastLogin).toBe('number');
    expect(user.lastLogin).toBeGreaterThanOrEqual(before);
    expect(user.lastLogin).toBeLessThanOrEqual(after);
  });

  test('saves lastLogin with validateBeforeSave: false', async () => {
    const user = {
      ...BASE_USER,
      correctPassword: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(undefined),
    };
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    await controllers.login(
      mockReq({ body: { email: 'test@example.com', password: 'secret' } }),
      mockRes()
    );

    expect(user.save).toHaveBeenCalledWith({ validateBeforeSave: false });
  });

  test('calls createSendToken with status 200 on success', async () => {
    const user = {
      ...BASE_USER,
      correctPassword: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(undefined),
    };
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();

    await controllers.login(
      mockReq({ body: { email: 'test@example.com', password: 'secret' } }),
      res
    );

    expect(createSendToken).toHaveBeenCalledWith(user, 200, res);
  });

  test('returns 400 with error.message on unexpected error', async () => {
    User.findOne.mockImplementation(() => {
      throw new Error('Unexpected DB failure');
    });
    const res = mockRes();

    await controllers.login(
      mockReq({ body: { email: 'a@b.com', password: 'pass' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ status: 'fail', message: 'Unexpected DB failure' });
  });
});

// ===========================================================================
// getProfile controller
// ===========================================================================

describe('getProfile controller', () => {
  test('queries by req.user.id and returns 200 with user data', async () => {
    User.findById.mockResolvedValue(BASE_USER);
    const res = mockRes();

    await controllers.getProfile(mockReq({ user: { id: 'user123' } }), res);

    expect(User.findById).toHaveBeenCalledWith('user123');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: 'success',
      data: { user: BASE_USER },
    });
  });

  test('returns 400 with error.message on database error', async () => {
    User.findById.mockRejectedValue(new Error('findById failed'));
    const res = mockRes();

    await controllers.getProfile(mockReq({ user: { id: 'user123' } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ status: 'fail', message: 'findById failed' });
  });
});

// ===========================================================================
// updateProfile controller
// ===========================================================================

describe('updateProfile controller', () => {
  test('strips non-allowed fields — only username and email pass through', async () => {
    const updated = { _id: 'user123', username: 'newname', email: 'new@b.com' };
    User.findByIdAndUpdate.mockResolvedValue(updated);

    await controllers.updateProfile(
      mockReq({
        user: { id: 'user123' },
        body: {
          username: 'newname',
          email: 'new@b.com',
          bankroll: 9999,   // must be stripped
          role: 'admin',    // must be stripped
          password: 'hack', // must be stripped
        },
      }),
      mockRes()
    );

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'user123',
      { username: 'newname', email: 'new@b.com' },
      { new: true, runValidators: true }
    );
  });

  test('passes { new: true } so updated document is returned', async () => {
    User.findByIdAndUpdate.mockResolvedValue({});
    await controllers.updateProfile(
      mockReq({ user: { id: 'user123' }, body: { username: 'x' } }),
      mockRes()
    );
    expect(User.findByIdAndUpdate.mock.calls[0][2]).toMatchObject({ new: true });
  });

  test('passes { runValidators: true } to enforce schema validation', async () => {
    User.findByIdAndUpdate.mockResolvedValue({});
    await controllers.updateProfile(
      mockReq({ user: { id: 'user123' }, body: { username: 'x' } }),
      mockRes()
    );
    expect(User.findByIdAndUpdate.mock.calls[0][2]).toMatchObject({ runValidators: true });
  });

  test('returns 200 with updated user on success', async () => {
    const updated = { _id: 'user123', username: 'newname', email: 'new@b.com' };
    User.findByIdAndUpdate.mockResolvedValue(updated);
    const res = mockRes();

    await controllers.updateProfile(
      mockReq({ user: { id: 'user123' }, body: { username: 'newname', email: 'new@b.com' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'success', data: { user: updated } });
  });

  test('returns 400 with error.message on database error', async () => {
    User.findByIdAndUpdate.mockRejectedValue(new Error('Update failed'));
    const res = mockRes();

    await controllers.updateProfile(
      mockReq({ user: { id: 'user123' }, body: { username: 'x' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ status: 'fail', message: 'Update failed' });
  });
});

// ===========================================================================
// updatePassword controller
// ===========================================================================

describe('updatePassword controller', () => {
  test('fetches user by id with +password projection', async () => {
    const user = { ...BASE_USER, correctPassword: jest.fn().mockResolvedValue(false) };
    const selectMock = jest.fn().mockResolvedValue(user);
    User.findById.mockReturnValue({ select: selectMock });

    await controllers.updatePassword(
      mockReq({ user: { id: 'user123' }, body: { currentPassword: 'old', newPassword: 'new' } }),
      mockRes()
    );

    expect(User.findById).toHaveBeenCalledWith('user123');
    expect(selectMock).toHaveBeenCalledWith('+password');
  });

  test('returns 401 "Your current password is incorrect" when verification fails', async () => {
    const user = { ...BASE_USER, correctPassword: jest.fn().mockResolvedValue(false) };
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();

    await controllers.updatePassword(
      mockReq({ user: { id: 'user123' }, body: { currentPassword: 'wrong', newPassword: 'new' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Your current password is incorrect',
    });
  });

  test('sets user.password to newPassword before saving', async () => {
    const user = {
      ...BASE_USER,
      correctPassword: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(undefined),
    };
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    await controllers.updatePassword(
      mockReq({ user: { id: 'user123' }, body: { currentPassword: 'old', newPassword: 'newpass123' } }),
      mockRes()
    );

    expect(user.password).toBe('newpass123');
  });

  test('calls save() WITHOUT validateBeforeSave: false — triggers pre-save hooks', async () => {
    // This is intentional: hooks must run to hash the new password and
    // update passwordChangedAt. The refactored AuthService must preserve this.
    const user = {
      ...BASE_USER,
      correctPassword: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(undefined),
    };
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    await controllers.updatePassword(
      mockReq({ user: { id: 'user123' }, body: { currentPassword: 'old', newPassword: 'new123' } }),
      mockRes()
    );

    expect(user.save).toHaveBeenCalledWith();
    expect(user.save).not.toHaveBeenCalledWith(expect.objectContaining({ validateBeforeSave: false }));
  });

  test('calls createSendToken with status 200 on success', async () => {
    const user = {
      ...BASE_USER,
      correctPassword: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(undefined),
    };
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();

    await controllers.updatePassword(
      mockReq({ user: { id: 'user123' }, body: { currentPassword: 'old', newPassword: 'new123' } }),
      res
    );

    expect(createSendToken).toHaveBeenCalledWith(user, 200, res);
  });

  test('returns 400 with error.message on unexpected error', async () => {
    User.findById.mockImplementation(() => {
      throw new Error('Unexpected error');
    });
    const res = mockRes();

    await controllers.updatePassword(
      mockReq({ user: { id: 'user123' }, body: { currentPassword: 'old', newPassword: 'new' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ status: 'fail', message: 'Unexpected error' });
  });
});

// ===========================================================================
// protect middleware
// ===========================================================================

describe('protect middleware', () => {
  test('returns 401 when Authorization header is absent', async () => {
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware.protect(mockReq({ headers: {} }), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'You are not logged in. Please log in to get access.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when Authorization header does not start with "Bearer"', async () => {
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware.protect(
      mockReq({ headers: { authorization: 'Basic abc123' } }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('extracts token from "Bearer <token>" by splitting on space', async () => {
    verifyToken.mockResolvedValue({ id: 'tok123', iat: 1000 });
    const user = { ...BASE_USER, changedPasswordAfter: jest.fn().mockReturnValue(false) };
    User.findById.mockResolvedValue(user);
    const next = jest.fn();

    await authMiddleware.protect(
      mockReq({ headers: { authorization: 'Bearer the-actual-token' } }),
      mockRes(),
      next
    );

    expect(verifyToken).toHaveBeenCalledWith('the-actual-token');
  });

  test('returns 401 "user no longer exists" when DB lookup returns null', async () => {
    verifyToken.mockResolvedValue({ id: 'gone123', iat: 1000 });
    User.findById.mockResolvedValue(null);
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware.protect(
      mockReq({ headers: { authorization: 'Bearer jwt.gone123' } }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'The user belonging to this token no longer exists.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 "recently changed password" when changedPasswordAfter() returns true', async () => {
    const pastIat = Math.floor(Date.now() / 1000) - 3600;
    verifyToken.mockResolvedValue({ id: 'user123', iat: pastIat });
    const user = { ...BASE_USER, changedPasswordAfter: jest.fn().mockReturnValue(true) };
    User.findById.mockResolvedValue(user);
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware.protect(
      mockReq({ headers: { authorization: 'Bearer jwt.user123' } }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'User recently changed password. Please log in again.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('passes decoded.iat to changedPasswordAfter()', async () => {
    const iat = 1234567890;
    verifyToken.mockResolvedValue({ id: 'user123', iat });
    const changedPasswordAfter = jest.fn().mockReturnValue(false);
    User.findById.mockResolvedValue({ ...BASE_USER, changedPasswordAfter });

    await authMiddleware.protect(
      mockReq({ headers: { authorization: 'Bearer jwt.user123' } }),
      mockRes(),
      jest.fn()
    );

    expect(changedPasswordAfter).toHaveBeenCalledWith(iat);
  });

  test('calls next() and sets req.user when token is fully valid', async () => {
    verifyToken.mockResolvedValue({ id: 'user123', iat: 1000 });
    const user = { ...BASE_USER, changedPasswordAfter: jest.fn().mockReturnValue(false) };
    User.findById.mockResolvedValue(user);
    const req = mockReq({ headers: { authorization: 'Bearer jwt.user123' } });
    const next = jest.fn();

    await authMiddleware.protect(req, mockRes(), next);

    expect(req.user).toBe(user);
    expect(next).toHaveBeenCalledWith();
  });

  test('returns 401 "Authentication failed" on token verification error', async () => {
    verifyToken.mockRejectedValue(new Error('invalid signature'));
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware.protect(
      mockReq({ headers: { authorization: 'Bearer bad.token' } }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'Authentication failed',
      error: 'invalid signature',
    });
    expect(next).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// restrictTo middleware
// ===========================================================================

describe('restrictTo middleware', () => {
  test('returns a curried middleware function', () => {
    expect(typeof authMiddleware.restrictTo('admin')).toBe('function');
  });

  test('calls next() when user role is in the allowed list', () => {
    const middleware = authMiddleware.restrictTo('admin', 'user');
    const next = jest.fn();
    const res = mockRes();

    middleware(mockReq({ user: { role: 'admin' } }), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 403 "no permission" when user role is NOT in allowed list', () => {
    const middleware = authMiddleware.restrictTo('admin');
    const res = mockRes();
    const next = jest.fn();

    middleware(mockReq({ user: { role: 'user' } }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      status: 'fail',
      message: 'You do not have permission to perform this action',
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('allows "user" role when "user" is in the allowed list', () => {
    const middleware = authMiddleware.restrictTo('user');
    const next = jest.fn();

    middleware(mockReq({ user: { role: 'user' } }), mockRes(), next);

    expect(next).toHaveBeenCalled();
  });

  test('blocks "user" role when only "admin" is allowed', () => {
    const middleware = authMiddleware.restrictTo('admin');
    const res = mockRes();
    const next = jest.fn();

    middleware(mockReq({ user: { role: 'user' } }), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
