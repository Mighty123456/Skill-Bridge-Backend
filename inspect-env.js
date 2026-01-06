const config = require('./src/config/env');
console.log('EMAIL_USER:', `'${config.EMAIL_USER}'`, 'Length:', config.EMAIL_USER.length);
console.log('EMAIL_PASS:', `'${config.EMAIL_PASS}'`, 'Length:', config.EMAIL_PASS.length);

for (let i = 0; i < config.EMAIL_USER.length; i++) {
    console.log(`Char ${i}: ${config.EMAIL_USER.charCodeAt(i)} ('${config.EMAIL_USER[i]}')`);
}
for (let i = 0; i < config.EMAIL_PASS.length; i++) {
    console.log(`Char ${i}: ${config.EMAIL_PASS.charCodeAt(i)} ('${config.EMAIL_PASS[i]}')`);
}
