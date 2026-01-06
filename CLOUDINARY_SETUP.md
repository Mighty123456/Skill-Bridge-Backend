# Cloudinary Setup Guide

This guide will help you set up Cloudinary for image storage in the SkillBridge backend.

## Step 1: Create a Cloudinary Account

1. Go to [https://cloudinary.com](https://cloudinary.com)
2. Sign up for a free account (free tier includes 25GB storage and 25GB bandwidth)
3. Verify your email address

## Step 2: Get Your Credentials

1. After logging in, go to your **Dashboard**
2. You'll find your credentials displayed:
   - **Cloud Name** (e.g., `dxyz123abc`)
   - **API Key** (e.g., `123456789012345`)
   - **API Secret** (e.g., `abcdefghijklmnopqrstuvwxyz123456`)

## Step 3: Add Credentials to .env File

Add these three lines to your `.env` file:

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name-here
CLOUDINARY_API_KEY=your-api-key-here
CLOUDINARY_API_SECRET=your-api-secret-here
```

**Important:** Never commit your `.env` file to version control!

## Step 4: Test the Integration

1. Start your server: `npm run dev`
2. You should see: `Cloudinary configured successfully` in the logs
3. If you see a warning, check that your credentials are correct

## How It Works

### Image Upload Flow

1. **Client** sends image file via `POST /api/auth/upload-profile-image`
2. **Multer** receives and stores file in memory (max 5MB)
3. **Cloudinary Service** uploads image to Cloudinary with:
   - Automatic optimization (quality, format)
   - Resizing to 400x400px
   - Face detection for profile images
   - Organized folder structure: `skillbridge/profiles/{userId}/`
4. **Database** stores the Cloudinary URL
5. **Response** returns the image URL to client

### Image Organization

Images are organized in Cloudinary folders:
- Profile images: `skillbridge/profiles/{userId}/`
- General images: `skillbridge/` (default)

### Features

- ✅ **Automatic Optimization**: Images are automatically optimized for web
- ✅ **Smart Cropping**: Profile images use face detection
- ✅ **Format Conversion**: Automatically converts to best format (WebP, etc.)
- ✅ **Secure URLs**: Uses HTTPS for all image URLs
- ✅ **Automatic Cleanup**: Old images are deleted when new ones are uploaded

## API Endpoints

### Upload Profile Image
```bash
POST /api/auth/upload-profile-image
Authorization: Bearer <token>
Content-Type: multipart/form-data

Form Data:
  image: <file>
```

**Response:**
```json
{
  "success": true,
  "message": "Profile image uploaded successfully",
  "data": {
    "profileImage": "https://res.cloudinary.com/...",
    "message": "Profile image uploaded successfully"
  }
}
```

### Delete Profile Image
```bash
DELETE /api/auth/delete-profile-image
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Profile image deleted successfully"
}
```

## File Size Limits

- Maximum file size: **5MB**
- Supported formats: All image formats (JPEG, PNG, GIF, WebP, etc.)
- Recommended: JPEG or PNG for best compatibility

## Troubleshooting

### "Cloudinary credentials not configured"
- Check that all three environment variables are set in `.env`
- Restart your server after adding credentials

### "Failed to upload image to Cloudinary"
- Verify your API credentials are correct
- Check your Cloudinary account status (free tier limits)
- Ensure you have internet connectivity

### "File size too large"
- Maximum file size is 5MB
- Compress images before uploading
- Use image optimization tools

### Images not displaying
- Check that the Cloudinary URL is accessible
- Verify CORS settings in Cloudinary dashboard (if needed)
- Ensure the image URL is using HTTPS

## Security Best Practices

1. **Never expose API Secret**: Only use it server-side
2. **Use signed URLs** for private images (if needed)
3. **Set up upload presets** in Cloudinary dashboard for additional security
4. **Enable auto-format and optimization** (already configured)
5. **Monitor usage** in Cloudinary dashboard to avoid exceeding free tier

## Free Tier Limits

- **Storage**: 25GB
- **Bandwidth**: 25GB/month
- **Transformations**: Unlimited
- **Uploads**: Unlimited

For production, consider upgrading to a paid plan if you expect high traffic.

## Additional Resources

- [Cloudinary Documentation](https://cloudinary.com/documentation)
- [Node.js SDK Guide](https://cloudinary.com/documentation/node_integration)
- [Image Transformations](https://cloudinary.com/documentation/image_transformations)

