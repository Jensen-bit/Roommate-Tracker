const express = require('express');
const app = express();
const { sendExpenseEmail } = require('./src/services/emailService');

app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));

const pgp = require('pg-promise')();
const dbConfig = {
  host: 'db',
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
};
const db = pgp(dbConfig);

db.connect()
  .then(obj => {
    console.log('Database connection successful');
    obj.done();
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

app.post('/add-expense', async (req, res) => {
    // splits should be an array of objects: [{user_id: 1, percent: 50}, {user_id: 2, percent: 50}]
    const { amount, note, category, date, group_id, splits } = req.body;
    const payerId = req.session.user.user_id;
    const payerUsername = req.session.user.username;

    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
        return res.status(400).json({ 
            success: false, 
            message: "Amount must be a positive number." 
        });
    }

    try {
        await db.tx(async t => {
            // add expense
            const expense = await t.one(
                `INSERT INTO expenses (amount, note, category, expense_date, added_by, group_id) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING expense_id`,
                [amount, note, category, date || new Date(), payerId, group_id]
            );

            // split total amount based on percentage share
            const splitQueries = splits.map(s => {
                const amountOwed = (amount * (s.percent / 100)).toFixed(2);
                return t.none(
                    `INSERT INTO expense_splits (expense_id, user_id, amount_owed, share_percentage) 
                     VALUES ($1, $2, $3, $4)`,
                    [expense.expense_id, s.user_id, amountOwed, s.percent]
                );
            });
            await t.batch(splitQueries);

            // get group member emails from database to send notifications to
            const emailQuery = `
                SELECT email FROM users 
                JOIN users_to_groups ON users.user_id = users_to_groups.user_id
                WHERE users_to_groups.group_id = $1 AND users.user_id != $2;
            `;
            const roommates = await t.any(emailQuery, [group_id, payerId]);

            // send notifications
            const emailPromises = roommates.map(rm => 
                sendExpenseEmail(rm.email, amount, payerUsername, note)
            );
            await Promise.all(emailPromises);
        });
        
        res.status(200).json({ message: "Expense added, balances updated, and roommates notified!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Could not process expense" });
    }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('Server is listening on port 3000');
});