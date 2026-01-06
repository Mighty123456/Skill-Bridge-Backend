# 📧 Email OTP Setup Guide

## Problem
OTP is being stored in MongoDB but emails are not being sent because the email service is not configured.

## Solution
Configure Gmail SMTP to send OTP emails.

---

## 🚀 Quick Setup (5 Minutes)

### Step 1: Enable 2-Factor Authentication on Gmail

1. Go to your Google Account: https://myaccount.google.com/
2. Click **Security** (left sidebar)
3. Under "Signing in to Google", click **2-Step Verification**
4. Follow the steps to enable 2FA (if not already enabled)

### Step 2: Generate App Password

1. After enabling 2FA, go back to **Security**
2. Under "Signing in to Google", click **App passwords**
   - Or directly visit: https://myaccount.google.com/apppasswords
3. You may need to sign in again
4. Select app: **Mail**
5. Select device: **Other (Custom name)**
6. Enter name: **SkillBridge Backend**
7. Click **Generate**
8. **Copy the 16-character password** (it will look like: `abcd efgh ijkl mnop`)
   - ⚠️ **IMPORTANT:** Save this password - you won't see it again!

### Step 3: Update Your `.env` File

Open `skillbridge_backend/.env` and add/update these lines:

```env
# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=abcdefghijklmnop
```

**Replace:**
- `your-email@gmail.com` → Your actual Gmail address
- `abcdefghijklmnop` → The 16-character app password (remove spaces)

### Step 4: Restart Your Backend Server

```bash
# If running locally:
cd skillbridge_backend
npm run dev

# If deployed on Vercel:
# Add environment variables in Vercel dashboard
# Then redeploy
```

---

## 🧪 Testing Email OTP

### Test 1: Local Development

1. **Start backend server:**
   ```bash
   cd skillbridge_backend
   npm run dev
   ```

2. **Register a new user** from your Flutter app

3. **Check console output** - You should see:
   ```
   ✅ OTP email sent to user@example.com
   ```
   Instead of:
   ```
   ⚠️ Email service not configured. OTP for user@example.com: 123456
   ```

4. **Check your email inbox** for the OTP email

### Test 2: Using Postman/Thunder Client

**Send Registration Request:**
```http
POST https://skill-bridge-backend-delta.vercel.app/api/auth/register
Content-Type: application/json

{
  "email": "test@example.com",
  "password": "password123",
  "role": "user",
  "name": "Test User",
  "phone": "1234567890",
  "dateOfBirth": "1990-01-01",
  "address": {
    "street": "123 Test St",
    "pincode": "12345",
    "coordinates": {
      "latitude": 0,
      "longitude": 0
    }
  }
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Registration successful. Please verify your email with the OTP sent to your email address.",
  "data": {
    "email": "test@example.com"
  }
}
```

**Check your email** - You should receive an OTP email.

---

## 🔍 Troubleshooting

### Issue 1: "Invalid credentials" error

**Cause:** Wrong email or app password

**Solution:**
1. Double-check email address in `.env`
2. Regenerate app password
3. Make sure you're using **app password**, not your regular Gmail password
4. Remove any spaces from the app password

### Issue 2: "Less secure app access" error

**Cause:** Using regular password instead of app password

**Solution:**
- You MUST use an **App Password**, not your regular Gmail password
- Regular passwords don't work with SMTP anymore

### Issue 3: Still seeing "Email service not configured"

**Cause:** Environment variables not loaded

**Solution:**
```bash
# Check if .env file exists
ls -la .env

# Restart server completely
# Stop server (Ctrl+C)
# Start again
npm run dev
```

### Issue 4: Emails going to Spam

**Solution:**
- Check your spam folder
- Mark SkillBridge emails as "Not Spam"
- For production, consider using a dedicated email service (SendGrid, AWS SES, etc.)

---

## 📋 Verification Checklist

- [ ] 2-Factor Authentication enabled on Gmail
- [ ] App Password generated
- [ ] `.env` file updated with `EMAIL_USER` and `EMAIL_PASS`
- [ ] No spaces in app password
- [ ] Backend server restarted
- [ ] Test registration performed
- [ ] Console shows "OTP email sent to..."
- [ ] Email received in inbox (or spam)

---

## 🌐 Deploying to Vercel

### Add Environment Variables to Vercel:

1. Go to your Vercel project dashboard
2. Click **Settings** → **Environment Variables**
3. Add these variables:
   ```
   EMAIL_HOST = smtp.gmail.com
   EMAIL_PORT = 587
   EMAIL_USER = your-email@gmail.com
   EMAIL_PASS = your-app-password
   ```
4. Click **Save**
5. **Redeploy** your project

---

## 🎯 Alternative Email Services (Optional)

If Gmail doesn't work or for production use, consider:

### 1. **SendGrid** (Recommended for Production)
- Free tier: 100 emails/day
- Better deliverability
- Setup: https://sendgrid.com/

### 2. **AWS SES**
- Very cheap
- High deliverability
- Requires AWS account

### 3. **Mailgun**
- Free tier: 5,000 emails/month
- Easy setup

### 4. **Brevo (formerly Sendinblue)**
- Free tier: 300 emails/day
- Good for testing

---

## 📝 Current Email Template

Your OTP email will look like this:

```
Subject: Your SkillBridge email verification code

SkillBridge Verification Code

Hello,

Your verification code for email verification is:

┌─────────────────┐
│     123456      │
└─────────────────┘

This code will expire in 10 minutes.

Use this code to verify your email at: https://skill-bridge-backend-delta.vercel.app

If you didn't request this code, please ignore this email.

Need help? Contact us at support@skillbridge.com

Best regards,
The SkillBridge Team
```

---

## 🔐 Security Best Practices

1. **Never commit `.env` file to Git** (already in `.gitignore`)
2. **Use different email accounts** for development and production
3. **Rotate app passwords** periodically
4. **Monitor email sending** for abuse
5. **Set up rate limiting** to prevent spam

---

## 📞 Need Help?

If you're still having issues:

1. Check backend console logs for detailed error messages
2. Verify MongoDB connection is working
3. Test with a simple email first
4. Check Gmail account activity for blocked sign-in attempts

---

## ✅ Success Indicators

You'll know it's working when:
1. Console shows: `"OTP email sent to user@example.com"`
2. Email arrives in inbox within 1-2 seconds
3. OTP in email matches OTP in MongoDB
4. Verification with OTP works successfully
