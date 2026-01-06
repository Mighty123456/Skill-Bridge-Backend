# Vercel Deployment Guide

This guide will help you deploy the SkillBridge backend to Vercel.

## Prerequisites

1. A Vercel account (sign up at [vercel.com](https://vercel.com))
2. MongoDB database (MongoDB Atlas recommended)
3. Environment variables configured

## Deployment Steps

### 1. Install Vercel CLI (Optional)

```bash
npm install -g vercel
```

### 2. Configure Environment Variables

In your Vercel project dashboard, add these environment variables:

**Required:**
- `MONGODB_URI` - Your MongoDB connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `NODE_ENV` - Set to `production`

**Optional (but recommended):**
- `CLOUDINARY_CLOUD_NAME` - Cloudinary cloud name
- `CLOUDINARY_API_KEY` - Cloudinary API key
- `CLOUDINARY_API_SECRET` - Cloudinary API secret
- `EMAIL_HOST` - SMTP host (e.g., smtp.gmail.com)
- `EMAIL_PORT` - SMTP port (e.g., 587)
- `EMAIL_USER` - Email address for sending emails
- `EMAIL_PASS` - Email password or app password
- `FRONTEND_URL` - Your frontend URL for CORS

### 3. Deploy to Vercel

#### Option A: Using Vercel Dashboard

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your Git repository
4. Set the root directory to `skillbridge_backend`
5. Framework Preset: **Other**
6. Build Command: Leave empty (or `npm install`)
7. Output Directory: Leave empty
8. Install Command: `npm install`
9. Click "Deploy"

#### Option B: Using Vercel CLI

```bash
cd skillbridge_backend
vercel
```

Follow the prompts to deploy.

### 4. Verify Deployment

After deployment, test your API:

- Root endpoint: `https://your-project.vercel.app/`
- Health check: `https://your-project.vercel.app/api/health`
- Auth endpoint: `https://your-project.vercel.app/api/auth/register`

## Project Structure for Vercel

```
skillbridge_backend/
├── api/
│   └── index.js          # Serverless function entry point
├── src/                   # Your application code
├── vercel.json           # Vercel configuration
└── package.json          # Dependencies
```

## Important Notes

### Database Connection

- MongoDB connections are handled per-request in serverless functions
- The connection is cached between invocations
- Make sure your MongoDB Atlas allows connections from Vercel IPs (or use 0.0.0.0/0 for all IPs)

### Cold Starts

- First request after inactivity may be slower (cold start)
- Subsequent requests are faster (warm start)
- Consider using Vercel Pro for better performance

### File Uploads

- File uploads work with Multer and Cloudinary
- Maximum request size: 4.5MB (Vercel limit)
- Consider using Vercel Blob Storage for larger files

### Environment Variables

- Never commit `.env` files
- All secrets should be in Vercel dashboard
- Use different values for production vs development

## Troubleshooting

### "Route / not found"

- Make sure `vercel.json` is in the root directory
- Check that `api/index.js` exists and exports the app correctly
- Verify routes are properly configured

### Database Connection Issues

- Check MongoDB Atlas network access (allow all IPs or add Vercel IPs)
- Verify `MONGODB_URI` is set correctly in Vercel
- Check connection string format

### CORS Errors

- Update `FRONTEND_URL` in Vercel environment variables
- Or set CORS to allow your frontend domain

### Build Errors

- Check Node.js version (should be >= 18.0.0)
- Verify all dependencies are in `package.json`
- Check build logs in Vercel dashboard

## API Endpoints

After deployment, your API will be available at:

- **Base URL**: `https://your-project.vercel.app`
- **API Base**: `https://your-project.vercel.app/api`

### Example Requests

**Health Check:**
```bash
GET https://your-project.vercel.app/api/health
```

**Register User:**
```bash
POST https://your-project.vercel.app/api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123",
  "role": "user",
  "name": "John Doe",
  "phone": "+1234567890",
  "dateOfBirth": "1990-01-01"
}
```

## Monitoring

- Check Vercel dashboard for function logs
- Monitor function execution time
- Set up alerts for errors
- Use Vercel Analytics for performance insights

## Next Steps

1. Set up custom domain (optional)
2. Configure environment variables for production
3. Set up monitoring and alerts
4. Configure rate limiting if needed
5. Set up CI/CD for automatic deployments

