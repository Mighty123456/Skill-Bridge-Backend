# 🚀 Quick Start: Enable Email OTP (5 Minutes)

## Step 1: Get Gmail App Password

1. Visit: https://myaccount.google.com/apppasswords
2. Sign in to your Gmail account
3. If prompted, enable **2-Factor Authentication** first
4. Select: **Mail** → **Other (Custom name)** → Type "SkillBridge"
5. Click **Generate**
6. **Copy the 16-character password** (e.g., `abcd efgh ijkl mnop`)

## Step 2: Update .env File

Open `skillbridge_backend/.env` and add:

```env
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=abcdefghijklmnop
```

**Important:** 
- Replace `your-email@gmail.com` with your actual Gmail
- Replace `abcdefghijklmnop` with your app password (remove spaces)
- Don't use your regular Gmail password!

## Step 3: Test Email Service

```bash
cd skillbridge_backend
node test-email.js
```

You should see:
```
✅ SMTP connection successful!
✅ Test email sent successfully!
🎉 Email service is working correctly!
```

Check your email inbox for the test OTP email.

## Step 4: Restart Backend & Test

```bash
npm run dev
```

Now register a new user from your Flutter app and check your email for the OTP!

---

## ✅ Success Checklist

- [ ] Gmail App Password generated
- [ ] `.env` file updated with EMAIL_USER and EMAIL_PASS
- [ ] Test script shows ✅ success
- [ ] Test email received in inbox
- [ ] Backend server restarted
- [ ] Registration sends OTP email

---

## 🆘 Quick Troubleshooting

**No test email received?**
- Check spam folder
- Verify app password is correct (no spaces)
- Make sure 2FA is enabled on Gmail

**"Invalid login" error?**
- You must use App Password, not regular password
- Regenerate app password if needed

**Still not working?**
- See detailed guide: `EMAIL_OTP_SETUP.md`
- Check backend console for error messages

---

## 📞 Test Commands

```bash
# Test email configuration
node test-email.js

# Test with specific recipient
node test-email.js recipient@example.com

# Start backend server
npm run dev

# Check environment variables
cat .env | grep EMAIL
```

---

**That's it! Your OTP emails should now work! 🎉**
