const nodemailer = require('nodemailer');

// ตั้งค่าคนส่ง (ใช้ Gmail ของเรา)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'ecpsmartpetfeeder@gmail.com',
        pass: 'odmz qqqg amci zbzl'
    }
});

// ฟังก์ชันส่งอีเมลแจ้งเตือน (อาหาร/น้ำ หมด)
exports.sendAlertEmail = async (userEmail, subject, text) => {
    try {
        await transporter.sendMail({
            from: '"ECP - Smart Pet Feeder" <YOUR_EMAIL@gmail.com>',
            to: userEmail,
            subject: subject,
            html: `
                <h2 style="color: red;">แจ้งเตือน: ${subject}</h2>
                <p>${text}</p>
                <p>กรุณาตรวจสอบเครื่องให้อาหารสัตว์ของท่าน</p>
            `
        });
        console.log("Alert email sent to:", userEmail);
    } catch (err) {
        console.error("Email Error:", err);
    }
};

// ฟังก์ชันส่งลิงก์รีเซ็ตรหัสผ่าน
exports.sendResetPasswordEmail = async (userEmail, token) => {
    const resetLink = `https://ecp-smartpetfeeder.site/reset-password/${token}`;

    try {
        await transporter.sendMail({
            from: '"ECP - Smart Pet Feeder Support" <YOUR_EMAIL@gmail.com>',
            to: userEmail,
            subject: 'กู้คืนรหัสผ่าน (Reset Password)',
            html: `
                <h3>คุณแจ้งลืมรหัสผ่านใช่ไหม?</h3>
                <p>คลิกที่ลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์มีอายุ 1 ชั่วโมง):</p>
                <a href="${resetLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">ตั้งรหัสผ่านใหม่</a>
                <p>หากคุณไม่ได้ทำรายการนี้ โปรดเพิกเฉยต่ออีเมลนี้</p>
            `
        });
        console.log("Reset email sent to:", userEmail);
    } catch (err) {
        console.error("Email Error:", err);
    }
};