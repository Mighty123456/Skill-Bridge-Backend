# Render Deployment Guide

This guide will help you deploy the SkillBridge backend to Render.

## Prerequisites

1. A Render account (sign up at [render.com](https://render.com))
2. MongoDB database (MongoDB Atlas recommended)
3. GitHub repository with your code

## Deployment Steps

### 1. Prepare Your Repository

Make sure your code is pushed to GitHub:
- Repository: `https://github.com/Mighty123456/Skill-Bridge-Backend`
- Branch: `main` (or your preferred branch)

### 2. Create a New Web Service on Render

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Select the repository: `Skill-Bridge-Backend`

### 3. Configure the Service

**Basic Settings:**
- **Name**: `skillbridge-backend` (or your preferred name)
- **Region**: Choose closest to your users
- **Branch**: `main`
- **Root Directory**: Leave empty (or set to `skillbridge_backend` if your repo has multiple folders)
- **Runtime**: `Node`
- **Build Command**: `npm install` (or `yarn install` if using yarn)
- **Start Command**: `npm start` (this will run `node src/server.js`)

**Environment Variables:**

Add these in the Render dashboard:

**Required:**
```
NODE_ENV=production
PORT=10000
MONGODB_URI=your-mongodb-connection-string
JWT_SECRET=your-secret-jwt-key
```

**Optional (but recommended):**
```
CLOUDINARY_CLOUD_NAME=your-cloudinary-cloud-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
FRONTEND_URL=https://your-frontend-url.com
```

### 4. Deploy

1. Click "Create Web Service"
2. Render will automatically:
   - Clone your repository
   - Install dependencies
   - Start your application

### 5. Verify Deployment

After deployment, you'll get a URL like:
`https://skillbridge-backend.onrender.com`

Test your API:
- Root: `https://your-service.onrender.com/`
- Health: `https://your-service.onrender.com/api/health`
- Auth: `https://your-service.onrender.com/api/auth/register`

## Important Notes

### Port Configuration

- Render automatically sets `PORT` environment variable
- The app uses `process.env.PORT` (defaults to 3000 if not set)
- Render typically uses port `10000` internally

### Database Connection

- Use MongoDB Atlas (cloud database)
- In MongoDB Atlas, add `0.0.0.0/0` to Network Access (allow all IPs)
- Or add Render's IP addresses if you prefer

### Free Tier Limitations

- Services spin down after 15 minutes of inactivity
- First request after spin-down may take 30-60 seconds (cold start)
- Consider upgrading to paid plan for always-on service

### Environment Variables

- Never commit `.env` files
- All secrets should be in Render dashboard
- Use different values for production vs development

## Troubleshooting

### "Cannot find module '/opt/render/project/src/app.js'"

**Solution:**
- Make sure `package.json` has `"start": "node src/server.js"`
- Check that `src/server.js` exists
- Verify root directory is set correctly in Render

### "Module not found" errors

**Solution:**
- Check that all dependencies are in `package.json`
- Verify `npm install` completes successfully
- Check build logs in Render dashboard

### Database Connection Issues

**Solution:**
- Verify `MONGODB_URI` is set correctly
- Check MongoDB Atlas network access
- Ensure connection string format is correct

### Port Already in Use

**Solution:**
- Render sets PORT automatically, don't hardcode it
- Use `process.env.PORT` in your code (already done)

### Service Keeps Restarting

**Solution:**
- Check application logs in Render dashboard
- Verify all environment variables are set
- Check for unhandled errors in code

## File Structure

Your repository should have:
```
skillbridge_backend/
├── src/
│   ├── server.js      # Entry point
│   ├── app.js         # Express app
│   └── ...
├── package.json       # Dependencies and scripts
├── render.yaml        # Render configuration (optional)
└── README.md
```

## Auto-Deploy

Render automatically deploys when you push to your connected branch:
1. Push code to GitHub
2. Render detects the change
3. Builds and deploys automatically
4. You'll get a notification when done

## Monitoring

- Check logs in Render dashboard
- Set up alerts for service failures
- Monitor response times
- Use Render's metrics dashboard

## Custom Domain

1. Go to your service settings
2. Click "Custom Domains"
3. Add your domain
4. Update DNS records as instructed

## Next Steps

1. Set up environment variables
2. Configure MongoDB Atlas
3. Test all API endpoints
4. Set up monitoring and alerts
5. Configure custom domain (optional)

