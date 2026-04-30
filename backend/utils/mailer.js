const nodemailer = require('nodemailer');
require('dotenv').config();

const { getSetting } = require('./auth-config');
const crypto = require('crypto');

/**
 * Creates and returns a nodemailer transport instance based on database settings.
 * If SMTP is not configured, returns null.
 */
function getTransporter() {
    const SMTP_HOST = getSetting('smtp_host', '');
    const SMTP_PORT = getSetting('smtp_port', '587');
    const SMTP_USER = getSetting('smtp_user', '');
    let SMTP_PASS = getSetting('smtp_pass', '');

    if (!SMTP_HOST || !SMTP_PORT) {
        console.warn('SMTP configuration is missing. Emails will not be sent.');
        return null;
    }

    // Decrypt the password
    if (SMTP_PASS) {
        if (SMTP_PASS.includes(':')) {
            const ENCRYPTION_KEY = process.env.CLOUDPI_ENCRYPTION_KEY;
            if (ENCRYPTION_KEY && ENCRYPTION_KEY.length === 64) {
                try {
                    const textParts = SMTP_PASS.split(':');
                    const iv = Buffer.from(textParts.shift(), 'hex');
                    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
                    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
                    let decrypted = decipher.update(encryptedText);
                    decrypted = Buffer.concat([decrypted, decipher.final()]);
                    SMTP_PASS = decrypted.toString();
                } catch (e) {
                    console.error('Failed to decrypt SMTP password');
                }
            }
        } else {
            // Fallback for base64
            SMTP_PASS = Buffer.from(SMTP_PASS, 'base64').toString('ascii');
        }
    }

    return nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT, 10),
        secure: parseInt(SMTP_PORT, 10) === 465, // true for 465, false for other ports
        auth: SMTP_USER ? {
            user: SMTP_USER,
            pass: SMTP_PASS,
        } : undefined,
    });
}

/**
 * Sends an email using the configured SMTP transport.
 * 
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} text - Plain text email body
 * @param {string} html - HTML email body (optional)
 * @returns {Promise<boolean>} - True if sent successfully, false otherwise
 */
async function sendEmail(to, subject, text, html) {
    const transporter = getTransporter();

    if (!transporter) {
        console.error(`Cannot send email to ${to}: SMTP not configured`);
        return false;
    }

    const fromName = getSetting('smtp_from_name', 'CloudPi');
    const fromEmail = getSetting('smtp_from_email', getSetting('smtp_user', ''));

    try {
        const info = await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to,
            subject,
            text,
            html: html || text,
        });

        console.log(`Email sent successfully to ${to} (Message ID: ${info.messageId})`);
        return true;
    } catch (error) {
        console.error(`Failed to send email to ${to}:`, error);
        return false;
    }
}

module.exports = {
    sendEmail,
};
