# UserService Refactor: Boundary Analysis

## Current State (Monolithic)

The user domain is currently spread across two tightly-coupled files with mixed responsibilities:

### `models/User.js` (94 lines) — mixed concerns
| Field/Method | Actual Concern |
|---|---|
| `email`, `password` | Credentials / Auth |
| `username` | User Profile |
| `bankroll` | Financial Domain |
| `role` | Authorization / RBAC |
| `lastLogin`, `active` | Session/Lifecycle tracking |
| `passwordChangedAt`, `passwordResetToken` | Credential security |
| `correctPassword()` | Auth behavior |
| `changedPasswordAfter()` | Auth behavior |
| pre-save password hash | Auth behavior |
| pre-find active filter | Lifecycle behavior |

### `services/auth/controllers.js` (265 lines) — mixed concerns
| Function | Actual Concern |
|---|---|
| `register` | Auth + Profile creation + Financial setup |
| `login` | Auth only |
| `getProfile` | Profile read |
| `updateProfile` | Profile write |
| `updatePassword` | Credential management |
| `filterObj` | Generic utility (inline, non-domain) |

### `middleware/authMiddleware.js` (72 lines) — mixed concerns
| Function | Actual Concern |
|---|---|
| `protect` | JWT verification + user existence + credential staleness |
| `restrictTo` | RBAC / Authorization |

---

## Identified Service Boundaries

### Boundary 1: AuthService
**Path:** `src/services/auth/`
**Responsibility:** Credential verification and token lifecycle only.

Owns:
- `register(email, password, username)` → delegates profile + bankroll creation to other services
- `login(email, password)` → issues JWT
- `updatePassword(userId, currentPassword, newPassword)` → credential update + re-issue token
- `verifyToken(token)` → JWT validation (already in `utils/jwtUtils.js`)

Does NOT own: profile data, bankroll, roles.

---

### Boundary 2: UserProfileService
**Path:** `src/services/user/profile.js`
**Responsibility:** Public identity data only (username, email, display info).

Owns:
- `getProfile(userId)`
- `updateProfile(userId, { username, email })`

Does NOT own: credentials, financial data, access control.

---

### Boundary 3: BankrollService
**Path:** `src/services/bankroll/`
**Responsibility:** All financial state for a user.

Owns:
- `getBalance(userId)`
- `credit(userId, amount, reason)`
- `debit(userId, amount, reason)`

Does NOT own: user identity, auth, roles.

Note: `bankroll: 1000` default currently hardcoded in `auth/controllers.js:register` — move initialization here.

---

### Boundary 4: AuthorizationMiddleware (rename + split)
**Path:** `src/middleware/authMiddleware.js` → split into:
- `src/middleware/authenticate.js` — JWT verify + user existence check (Boundary 1 concern)
- `src/middleware/authorize.js` — `restrictTo(...roles)` (RBAC concern, depends on `user.role`)

---

### Boundary 5: User Model Decomposition
Current single `User` model should split into:

| New model | Fields | File |
|---|---|---|
| `UserCredential` | `email`, `password`, `passwordChangedAt`, `passwordResetToken`, `passwordResetExpires` | `models/UserCredential.js` |
| `UserProfile` | `username`, `createdAt`, `lastLogin` | `models/UserProfile.js` |
| `UserFinancial` | `bankroll` | `models/UserFinancial.js` |
| `UserAccess` | `role`, `active` | `models/UserAccess.js` |

Or if MongoDB document-per-user is preferred, one `User` document with sub-documents grouped by concern (keeps atomic operations): `{ credentials: {...}, profile: {...}, financial: {...}, access: {...} }`.

---

## Dependency Graph (Post-Refactor)

```
authenticate.js  →  AuthService  →  UserCredential model
authorize.js     →  UserAccess model
AuthService      →  UserProfileService (delegate on register)
AuthService      →  BankrollService (delegate on register)
BankrollService  →  UserFinancial model
UserProfileService → UserProfile model
```

---

## Files to Create / Modify

| Action | File |
|---|---|
| CREATE | `src/services/user/profile.js` |
| CREATE | `src/services/bankroll/index.js` |
| CREATE | `src/middleware/authorize.js` |
| MODIFY | `src/services/auth/controllers.js` — remove profile/bankroll logic, delegate |
| MODIFY | `src/middleware/authMiddleware.js` — keep only JWT verification, rename to `authenticate.js` |
| MODIFY | `src/models/User.js` — decompose or restructure into grouped sub-documents |
