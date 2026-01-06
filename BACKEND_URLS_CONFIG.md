# Backend URLs Configuration

This document explains how the backend URLs are configured for different services.

## Service URLs

- **Vercel Backend**: `https://skill-bridge-backend-delta.vercel.app`
  - Used for: OTP emails, authentication services
  
- **Render Backend**: `https://skill-bridge-backend-1erz.onrender.com`
  - Used for: File uploads, image processing

## Configuration

The URLs are configured in `src/config/env.js`:

```javascript
VERCEL_BACKEND_URL=https://skill-bridge-backend-delta.vercel.app
RENDER_BACKEND_URL=https://skill-bridge-backend-1erz.onrender.com
```

## Service Mapping

### Vercel Backend (OTP & Auth)
- `/api/auth/send-otp` - Send OTP for login
- `/api/auth/login-otp` - Login with OTP
- `/api/auth/forgot-password` - Request password reset
- `/api/auth/verify-reset-otp` - Verify reset OTP
- `/api/auth/reset-password` - Reset password
- `/api/auth/register` - User registration
- `/api/auth/login` - User login

### Render Backend (File Upload)
- `/api/auth/upload-profile-image` - Upload profile image
- `/api/auth/delete-profile-image` - Delete profile image
- Any other file upload endpoints

## Environment Variables

Add these to your environment variables:

**For Vercel:**
```
VERCEL_BACKEND_URL=https://skill-bridge-backend-delta.vercel.app
```

**For Render:**
```
RENDER_BACKEND_URL=https://skill-bridge-backend-1erz.onrender.com
```

## Usage in Code

```javascript
const { getBackendURL, getUploadURL, getAuthURL } = require('./common/utils/backend-urls');

// Get OTP/Auth URL (Vercel)
const authURL = getAuthURL('/auth/send-otp');
// Returns: https://skill-bridge-backend-delta.vercel.app/api/auth/send-otp

// Get Upload URL (Render)
const uploadURL = getUploadURL('/auth/upload-profile-image');
// Returns: https://skill-bridge-backend-1erz.onrender.com/api/auth/upload-profile-image
```

## Frontend Integration

When calling the backend from your Flutter app:

```dart
// For OTP/Auth services
final authBaseUrl = 'https://skill-bridge-backend-delta.vercel.app/api';

// For file upload services
final uploadBaseUrl = 'https://skill-bridge-backend-1erz.onrender.com/api';
```

## Benefits

1. **Load Distribution**: Split traffic between two backends
2. **Service Optimization**: Use Vercel for fast auth responses, Render for file processing
3. **Redundancy**: If one service is down, the other can handle critical operations
4. **Cost Optimization**: Use free tiers of both platforms effectively

## Notes

- Both backends have the same codebase
- Both backends connect to the same MongoDB database
- OTP emails will reference the Vercel URL
- File uploads will use the Render URL
- The root endpoint (`/`) shows which URL is used for which service

