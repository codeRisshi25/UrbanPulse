# UrbanPulse Authentication System - Testing Guide

This guide will help you test the authentication system with user registration, JWT generation, and Zod validation.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setup](#setup)
3. [Testing with cURL](#testing-with-curl)
4. [Testing with Postman/Thunder Client](#testing-with-postmanthunder-client)
5. [Testing Scenarios](#testing-scenarios)
6. [Expected Responses](#expected-responses)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before testing, ensure you have:

- Node.js (v20+)
- PostgreSQL database running
- pnpm installed
- `.env` file configured (see `.env.example`)

---

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Generate Prisma Client

```bash
cd packages/common
pnpm prisma generate
```

### 3. Run Database Migrations

```bash
cd packages/common
pnpm prisma migrate dev
```

### 4. Build the Project

```bash
# From root directory
pnpm build
```

### 5. Start the API Gateway

```bash
cd apps/api-gateway
pnpm dev
```

The server should start on `http://localhost:3001`

---

## Testing with cURL

### 1. Health Check

```bash
curl http://localhost:3001/health
```

**Expected Response:**
```json
{
  "success": true,
  "message": "API Gateway is running",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### 2. Register a Driver

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Driver",
    "number": "+1234567890",
    "password": "securePassword123",
    "role": "driver"
  }'
```

**Expected Response (201):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "clx1234567890",
      "name": "John Driver",
      "number": "+1234567890",
      "role": "driver",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

**Save the token for subsequent requests!**

---

### 3. Register a Rider

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Rider",
    "number": "+9876543210",
    "password": "anotherPassword456",
    "role": "rider"
  }'
```

---

### 4. Login

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "number": "+1234567890",
    "password": "securePassword123"
  }'
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "clx1234567890",
      "name": "John Driver",
      "number": "+1234567890",
      "role": "driver",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

### 5. Get Current User Info (Protected Route)

```bash
curl -X GET http://localhost:3001/user/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE"
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "User info retrieved successfully",
  "data": {
    "userId": "clx1234567890",
    "number": "+1234567890",
    "role": "driver"
  }
}
```

---

### 6. Get User Profile (Protected Route)

```bash
curl -X GET http://localhost:3001/user/profile \
  -H "Authorization: Bearer YOUR_JWT_TOKEN_HERE"
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Profile retrieved successfully",
  "data": {
    "id": "clx1234567890",
    "name": "John Driver",
    "number": "+1234567890",
    "role": "driver",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

## Testing with Postman/Thunder Client

### Setup Environment Variables

Create a new environment with:
- `baseUrl`: `http://localhost:3001`
- `token`: (will be set after login/register)

### Collection Structure

#### 1. Health Check
- **Method:** GET
- **URL:** `{{baseUrl}}/health`
- **Headers:** None

#### 2. Register Driver
- **Method:** POST
- **URL:** `{{baseUrl}}/auth/register`
- **Headers:** 
  - `Content-Type: application/json`
- **Body (JSON):**
  ```json
  {
    "name": "John Driver",
    "number": "+1234567890",
    "password": "securePassword123",
    "role": "driver"
  }
  ```
- **Tests (Postman):**
  ```javascript
  if (pm.response.code === 201) {
    pm.environment.set("token", pm.response.json().data.token);
  }
  ```

#### 3. Register Rider
- **Method:** POST
- **URL:** `{{baseUrl}}/auth/register`
- **Headers:** 
  - `Content-Type: application/json`
- **Body (JSON):**
  ```json
  {
    "name": "Jane Rider",
    "number": "+9876543210",
    "password": "anotherPassword456",
    "role": "rider"
  }
  ```

#### 4. Login
- **Method:** POST
- **URL:** `{{baseUrl}}/auth/login`
- **Headers:** 
  - `Content-Type: application/json`
- **Body (JSON):**
  ```json
  {
    "number": "+1234567890",
    "password": "securePassword123"
  }
  ```
- **Tests (Postman):**
  ```javascript
  if (pm.response.code === 200) {
    pm.environment.set("token", pm.response.json().data.token);
  }
  ```

#### 5. Get Current User
- **Method:** GET
- **URL:** `{{baseUrl}}/user/me`
- **Headers:** 
  - `Authorization: Bearer {{token}}`

#### 6. Get User Profile
- **Method:** GET
- **URL:** `{{baseUrl}}/user/profile`
- **Headers:** 
  - `Authorization: Bearer {{token}}`

---

## Testing Scenarios

### Scenario 1: Successful User Registration

**Steps:**
1. Send POST request to `/auth/register` with valid data
2. Verify response status is 201
3. Verify response contains `token` and `user` data
4. Verify user role matches the requested role
5. Save the token for future requests

**Expected:** User is created in database with hashed password and role-specific record (Driver or Rider)

---

### Scenario 2: Validation Errors

#### Test Case 2.1: Invalid Phone Number

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "number": "123",
    "password": "securePassword123",
    "role": "driver"
  }'
```

**Expected Response (400):**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "body.number",
      "message": "A valid phone number is required"
    }
  ]
}
```

#### Test Case 2.2: Short Password

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "number": "+1234567890",
    "password": "123",
    "role": "driver"
  }'
```

**Expected Response (400):**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "body.password",
      "message": "Password must be at least 8 characters"
    }
  ]
}
```

#### Test Case 2.3: Invalid Role

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "number": "+1234567890",
    "password": "securePassword123",
    "role": "admin"
  }'
```

**Expected Response (400):**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "body.role",
      "message": "Role must be either 'driver' or 'rider'"
    }
  ]
}
```

#### Test Case 2.4: Missing Required Fields

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User"
  }'
```

**Expected Response (400):**
Multiple validation errors for missing fields

---

### Scenario 3: Duplicate Registration

**Steps:**
1. Register a user with phone number `+1234567890`
2. Try to register another user with the same phone number

**Expected Response (400):**
```json
{
  "success": false,
  "message": "User with this phone number already exists"
}
```

---

### Scenario 4: Login with Invalid Credentials

#### Test Case 4.1: Wrong Password

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "number": "+1234567890",
    "password": "wrongPassword"
  }'
```

**Expected Response (401):**
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

#### Test Case 4.2: Non-existent User

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "number": "+9999999999",
    "password": "anyPassword"
  }'
```

**Expected Response (401):**
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

---

### Scenario 5: Protected Routes without Token

**Steps:**
1. Send GET request to `/user/me` without Authorization header

```bash
curl -X GET http://localhost:3001/user/me
```

**Expected Response (401):**
```json
{
  "success": false,
  "message": "Authentication token is required"
}
```

---

### Scenario 6: Protected Routes with Invalid Token

**Steps:**
1. Send GET request to `/user/me` with invalid token

```bash
curl -X GET http://localhost:3001/user/me \
  -H "Authorization: Bearer invalid_token_here"
```

**Expected Response (401):**
```json
{
  "success": false,
  "message": "Invalid or expired token"
}
```

---

### Scenario 7: Complete User Flow

**Steps:**
1. Register a new driver
2. Verify driver record is created in database
3. Login with the driver credentials
4. Access protected route `/user/me` with token
5. Access protected route `/user/profile` with token
6. Verify all responses contain correct user data

---

## Expected Responses

### Success Responses

| Endpoint | Method | Status | Description |
|----------|--------|--------|-------------|
| `/health` | GET | 200 | Health check success |
| `/auth/register` | POST | 201 | User registered successfully |
| `/auth/login` | POST | 200 | Login successful |
| `/user/me` | GET | 200 | User info retrieved |
| `/user/profile` | GET | 200 | Profile retrieved |

### Error Responses

| Status | Description | Example |
|--------|-------------|---------|
| 400 | Validation Error | Invalid input data |
| 401 | Unauthorized | Missing or invalid token |
| 404 | Not Found | User not found |
| 500 | Server Error | Database connection error |

---

## Troubleshooting

### Issue: "Cannot connect to database"

**Solution:**
1. Check if PostgreSQL is running
2. Verify `DATABASE_URL` in `.env` file
3. Run `pnpm prisma migrate dev` to create tables

### Issue: "Prisma Client not found"

**Solution:**
```bash
cd packages/common
pnpm prisma generate
```

### Issue: "Port 3001 already in use"

**Solution:**
1. Change `PORT` in `.env` file
2. Or kill the process using port 3001:
   ```bash
   lsof -ti:3001 | xargs kill
   ```

### Issue: "JWT_SECRET not defined"

**Solution:**
Add `JWT_SECRET` to your `.env` file:
```env
JWT_SECRET=your-super-secret-key-here
```

### Issue: "Validation always fails"

**Solution:**
1. Check request `Content-Type` header is `application/json`
2. Verify request body format matches schema
3. Check server logs for detailed error messages

### Issue: "Token expired"

**Solution:**
1. Register/login again to get a new token
2. Adjust `JWT_EXPIRES_IN` in `.env` for longer expiry

---

## Database Verification

### Check Registered Users

```bash
cd packages/common
pnpm prisma studio
```

This opens Prisma Studio in your browser where you can:
- View all users
- Check if Driver/Rider records are created
- Verify password is hashed
- See all database relationships

### SQL Queries

Connect to PostgreSQL and run:

```sql
-- View all users
SELECT id, name, number, "createdAt" FROM "User";

-- View all drivers
SELECT d.id, d."userId", u.name, d."isActive" 
FROM "Driver" d 
JOIN "User" u ON d."userId" = u.id;

-- View all riders
SELECT r.id, r."userId", u.name 
FROM "Rider" r 
JOIN "User" u ON r."userId" = u.id;
```

---

## Security Testing

### Test Password Hashing

1. Register a user with password `testPassword123`
2. Check database - password should be hashed (not plain text)
3. Login with same password should succeed
4. Login with wrong password should fail

### Test JWT Token

1. Register/login to get a token
2. Decode token at [jwt.io](https://jwt.io)
3. Verify payload contains: `userId`, `number`, `role`
4. Check expiration time

### Test Authorization

1. Register as driver
2. Get driver's token
3. Try to access rider-only endpoints (when implemented)
4. Should get 403 Forbidden

---

## Performance Testing

### Load Testing with Apache Bench

```bash
# Test registration endpoint
ab -n 100 -c 10 -p register.json -T application/json \
  http://localhost:3001/auth/register

# Test login endpoint
ab -n 1000 -c 50 -p login.json -T application/json \
  http://localhost:3001/auth/login
```

**Create test JSON files:**

`register.json`:
```json
{
  "name": "Test User",
  "number": "+1234567890",
  "password": "securePassword123",
  "role": "driver"
}
```

`login.json`:
```json
{
  "number": "+1234567890",
  "password": "securePassword123"
}
```

---

## Next Steps

After confirming authentication works:

1. ✅ User registration with Zod validation
2. ✅ JWT token generation
3. ✅ Password hashing with bcrypt
4. ✅ Protected routes with authentication middleware
5. 🔲 Implement driver location tracking
6. 🔲 Implement ride request system
7. 🔲 Implement real-time updates with WebSocket
8. 🔲 Add rate limiting
9. 🔲 Add refresh token mechanism
10. 🔲 Implement password reset flow

---

## Support

If you encounter any issues:

1. Check server logs for detailed error messages
2. Review the API documentation in `API_DOCS.md`
3. Verify environment variables are set correctly
4. Ensure database migrations are up to date

**Happy Testing! 🚀**