const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendExpenseEmail = async (targetEmail, expenseAmount, addedBy, description, note) => {
    const noteText = note ? `\n\nNote: "${note}"` : '';
    
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: targetEmail,
        subject: `FairShare Alert: New $${expenseAmount} Expense`,
        text: `Hello!\n\n${addedBy} just added a new group expense totaling $${expenseAmount}.${noteText}\n\nLog in to your FairShare account to view your updated roommate balances.`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email successfully sent to ${targetEmail}`);
        return true;
    } catch (error) {
        console.error('Email failed to send:', error);
        return false;
    }
};

module.exports = { sendExpenseEmail };