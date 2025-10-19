# UrbanPulse API Gateway Documentation

## Overview

This is the API Gateway for the UrbanPulse ride-sharing platform. It provides authentication, user management, and routing for driver and rider services.

## Base URL

```
http://localhost:3001
```

## Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## API Endpoints

### Health Check

#### GET /health

Check if the API is running.

**Response:**
```json
{
  "success": true,
  "message": "API Gateway is running",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## Authentication Endpoints

### Register User

#### POST /auth/register

Register a new user as either a driver or rider.

**Request Body:**
```json
{
  "name": "John Doe",
  "number": "+1234567890",
  "password": "securePassword123",
  "role": "driver"
}
```

**Validation Rules:**
- `name`: 2-100 characters
- `number`: Valid phone number (10-15 digits, optional + prefix)
- `password`: Minimum 8 characters
- `role`: Either "driver" or "rider"

**Success Response (201):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "clx1234567890",
      "name": "John Doe",
      "number": "+1234567890",
      "role": "driver",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "message": "User with this phone number already exists"
}
```

**Validation Error (400):**
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

---

### Login User

#### POST /auth/login

Login an existing user.

**Request Body:**
```json
{
  "number": "+1234567890",
  "password": "securePassword123"
}
```

**Validation Rules:**
- `number`: Valid phone number format
- `password`: Required

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "clx1234567890",
      "name": "John Doe",
      "number": "+1234567890",
      "role": "driver",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

---

## User Endpoints (Protected)

All user endpoints require authentication. Include the JWT token in the Authorization header.

### Get Current User Info

#### GET /user/me

Get basic information about the currently authenticated user.

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Success Response (200):**
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

**Error Response (401):**
```json
{
  "success": false,
  "message": "Authentication token is required"
}
```

---

### Get User Profile

#### GET /user/profile

Get detailed profile information about the currently authenticated user.

**Headers:**
```
Authorization: Bearer <your-jwt-token>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile retrieved successfully",
  "data": {
    "id": "clx1234567890",
    "name": "John Doe",
    "number": "+1234567890",
    "role": "driver",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "User not found"
}
```

---

## Error Responses

### Standard Error Format

All error responses follow this format:

```json
{
  "success": false,
  "message": "Error message description"
}
```

### HTTP Status Codes

- `200` - Success
- `201` - Created (successful registration)
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (authentication required or failed)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

---

## Environment Variables

Required environment variables:

```bash
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/urbanpulse"

# JWT Configuration
JWT_SECRET="your-secret-key"
JWT_EXPIRES_IN="7d"

# Server
PORT=3001
NODE_ENV="development"

# CORS
CORS_ORIGIN="*"
```

---

## Request/Response Examples

### cURL Examples

**Register a new driver:**
```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "number": "+1234567890",
    "password": "securePassword123",
    "role": "driver"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "number": "+1234567890",
    "password": "securePassword123"
  }'
```

**Get user profile (authenticated):**
```bash
curl -X GET http://localhost:3001/user/profile \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Architecture

### Middleware Stack

1. **Helmet** - Security headers
2. **CORS** - Cross-origin resource sharing
3. **Compression** - Response compression
4. **Body Parser** - JSON/URL-encoded parsing
5. **Request Logger** - Pino logger
6. **Routes** - Application routes
7. **Error Handler** - Global error handling

### Authentication Flow

1. User registers/logs in with credentials
2. Server validates input using Zod schemas
3. Password is hashed using bcrypt (registration) or compared (login)
4. JWT token is generated with user payload
5. Token is returned to client
6. Client includes token in Authorization header for protected routes
7. Server validates token and extracts user info

### Database Schema

**User Model:**
- Base user information (name, number, password)
- Related to either Driver or Rider

**Driver Model:**
- Extended driver-specific fields
- One-to-one with User

**Rider Model:**
- Extended rider-specific fields
- One-to-one with User

---

## Development

### Running the API

```bash
# Install dependencies
pnpm install

# Generate Prisma client
cd packages/common && pnpm prisma generate

# Run in development mode
pnpm dev

# Build for production
pnpm build

# Run production build
pnpm start
```

### Testing with Postman/Thunder Client

Import the following collection structure:

1. **Auth**
   - POST Register
   - POST Login

2. **User**
   - GET Me
   - GET Profile

Set up environment variables:
- `baseUrl`: http://localhost:3001
- `token`: (set after login/register)

---

## Security Considerations

1. **Password Hashing**: Passwords are hashed using bcrypt with 10 salt rounds
2. **JWT Tokens**: Tokens expire after 7 days (configurable)
3. **Input Validation**: All inputs are validated using Zod schemas
4. **Security Headers**: Helmet middleware adds security headers
5. **CORS**: Configurable CORS origins
6. **Rate Limiting**: (To be implemented)

---

## Future Enhancements

- [ ] Rate limiting middleware
- [ ] Refresh token mechanism
- [ ] Email verification
- [ ] Password reset functionality
- [ ] OAuth integration
- [ ] WebSocket support for real-time updates
- [ ] API versioning
- [ ] Swagger/OpenAPI documentation

---

## Support

For issues or questions, please contact the development team or create an issue in the repository.