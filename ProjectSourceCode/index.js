const express = require('express');
const bodyParser = require('body-parser');
const pgp = require('pg-promise')();
const session = require('express-session');
const exphbs = require('express-handlebars');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.engine(
  'hbs',
  exphbs.engine({
    extname: '.hbs'
  })
);
app.set('view engine', 'hbs');
app.set('views', __dirname + '/views');

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'super duper secret!',
    resave: false,
    saveUninitialized: false
  })
);

const db = pgp({
  host: 'db',
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
});

// temp login
app.use((req, res, next) => {
  if (!req.session.user) {
    req.session.user = {
      user_id: 1,
      full_name: 'Brennan Long'
    };
  }
  next();
});

app.get('/register', (req, res) => {
  res.render('pages/register');
});

app.get('/login', (req, res) => {
  res.status(200).send('Login page');
});

// POST /register — create new user
app.post('/register', async (req, res) => {
  const username = req.body.username ? req.body.username.trim() : '';
  const password = req.body.password ? req.body.password.trim() : '';

  // Negative case: reject empty inputs
  if (!username || !password) {
    return res.status(400).json({ status: 'error', message: 'Username and password are required.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);

    await db.none(
      'INSERT INTO users(full_name, email, password) VALUES($1, $2, $3)',
      [username, `${username}@fairshare.local`, hash]
    );

    return res.status(200).json({ status: 'success', message: 'Success' });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ status: 'error', message: 'Unable to register user.' });
  }
});

app.get('/welcome', (req, res) => {
  res.json({ status: 'success', message: 'Welcome!' });
});

app.get('/balances', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const currentUserId = req.session.user.user_id;

    const query = `
      WITH paid_by_me AS (
        SELECT
          ep.user_id AS roommate_id,
          SUM(ep.amount_owed) AS amount
        FROM expenses e
        JOIN expense_participants ep ON e.expense_id = ep.expense_id
        WHERE e.paid_by = $1
          AND ep.user_id <> $1
          AND ep.is_paid = FALSE
        GROUP BY ep.user_id
      ),
      i_owe_them AS (
        SELECT
          e.paid_by AS roommate_id,
          SUM(ep.amount_owed) AS amount
        FROM expenses e
        JOIN expense_participants ep ON e.expense_id = ep.expense_id
        WHERE ep.user_id = $1
          AND e.paid_by <> $1
          AND ep.is_paid = FALSE
        GROUP BY e.paid_by
      ),
      combined AS (
        SELECT
          u.user_id AS roommate_id,
          u.full_name AS roommate_name,
          COALESCE(pbm.amount, 0) - COALESCE(iot.amount, 0) AS net_balance
        FROM users u
        LEFT JOIN paid_by_me pbm ON u.user_id = pbm.roommate_id
        LEFT JOIN i_owe_them iot ON u.user_id = iot.roommate_id
        WHERE u.user_id <> $1
      )
      SELECT roommate_id, roommate_name, ROUND(net_balance::numeric, 2) AS net_balance
      FROM combined
      ORDER BY roommate_name;
    `;

    const rows = await db.any(query, [currentUserId]);

    const balances = rows.map((row) => {
      const amount = Number(row.net_balance);

      if (amount > 0) {
        return {
          roommate_id: row.roommate_id,
          roommate_name: row.roommate_name,
          net_balance: amount,
          color_class: 'text-success',
          is_zero: false,
          display_text: `${row.roommate_name} owes you $${amount.toFixed(2)}`
        };
      }

      if (amount < 0) {
        return {
          roommate_id: row.roommate_id,
          roommate_name: row.roommate_name,
          net_balance: amount,
          color_class: 'text-danger',
          is_zero: false,
          display_text: `You owe ${row.roommate_name} $${Math.abs(amount).toFixed(2)}`
        };
      }

      return {
        roommate_id: row.roommate_id,
        roommate_name: row.roommate_name,
        net_balance: amount,
        color_class: 'text-secondary',
        is_zero: true,
        display_text: '$0.00'
      };
    });

    const unpaidShares = await db.any(`
      SELECT
        ep.participant_id,
        e.description,
        u.full_name AS owes_user,
        ep.amount_owed
      FROM expense_participants ep
      JOIN expenses e ON ep.expense_id = e.expense_id
      JOIN users u ON ep.user_id = u.user_id
      WHERE ep.is_paid = FALSE
      ORDER BY ep.participant_id;
    `);

    res.render('pages/balances', { balances, unpaidShares });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading balances page');
  }
});

app.post('/mark-paid/:participantId', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).send('You must be logged in');
    }

    const participantId = Number(req.params.participantId);

    if (isNaN(participantId)) {
      return res.status(400).send('Invalid participant ID');
    }

    const existingShare = await db.oneOrNone(
      `
      SELECT participant_id, is_paid
      FROM expense_participants
      WHERE participant_id = $1
      `,
      [participantId]
    );

    if (!existingShare) {
      return res.status(404).send('Expense share not found');
    }

    if (existingShare.is_paid) {
      return res.status(400).send('Expense share is already marked as paid');
    }

    await db.none(
      `
      UPDATE expense_participants
      SET is_paid = TRUE,
          paid_at = CURRENT_TIMESTAMP,
          marked_paid_by = $2
      WHERE participant_id = $1
      `,
      [participantId, req.session.user.user_id]
    );

    res.redirect('/balances');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error marking expense as paid');
  }
});

// PAYMENT HISTORY PAGE
app.get('/payment-history', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const currentUserId = req.session.user.user_id;
    const roommateFilter = req.query.roommate ? Number(req.query.roommate) : null;

    let historyQuery = `
      SELECT
        ep.participant_id,
        e.description,
        e.created_at,
        ep.paid_at,
        payer.full_name AS paid_by_name,
        participant.full_name AS roommate_name,
        ep.amount_owed
      FROM expense_participants ep
      JOIN expenses e ON ep.expense_id = e.expense_id
      JOIN users payer ON e.paid_by = payer.user_id
      JOIN users participant ON ep.user_id = participant.user_id
      WHERE ep.is_paid = TRUE
        AND (e.paid_by = $1 OR ep.user_id = $1)
    `;

    const params = [currentUserId];

    if (roommateFilter) {
      historyQuery += `
        AND (participant.user_id = $2 OR payer.user_id = $2)
      `;
      params.push(roommateFilter);
    }

    historyQuery += `
      ORDER BY ep.paid_at DESC NULLS LAST, e.created_at DESC
    `;

    const history = await db.any(historyQuery, params);

    const formattedHistory = history.map((row) => ({
      participant_id: row.participant_id,
      description: row.description,
      created_at: row.created_at ? new Date(row.created_at).toLocaleDateString() : '',
      paid_at: row.paid_at ? new Date(row.paid_at).toLocaleDateString() : '',
      paid_by_name: row.paid_by_name,
      roommate_name: row.roommate_name,
      amount_owed: Number(row.amount_owed).toFixed(2)
    }));

    const roommates = await db.any(
      `
      SELECT user_id, full_name
      FROM users
      WHERE user_id <> $1
      ORDER BY full_name
      `,
      [currentUserId]
    );

    res.render('pages/payment-history', {
      history: formattedHistory,
      roommates,
      selectedRoommate: roommateFilter
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading payment history');
  }
});

// PAYMENT HISTORY DETAILS PAGE
app.get('/payment-history/:participantId', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect('/login');
    }

    const participantId = Number(req.params.participantId);

    if (isNaN(participantId)) {
      return res.status(400).send('Invalid participant ID');
    }

    const details = await db.oneOrNone(
      `
      SELECT
        ep.participant_id,
        e.expense_id,
        e.description,
        e.amount AS total_expense_amount,
        e.created_at,
        ep.amount_owed,
        ep.paid_at,
        payer.full_name AS paid_by_name,
        participant.full_name AS roommate_name,
        marker.full_name AS marked_paid_by_name
      FROM expense_participants ep
      JOIN expenses e ON ep.expense_id = e.expense_id
      JOIN users payer ON e.paid_by = payer.user_id
      JOIN users participant ON ep.user_id = participant.user_id
      LEFT JOIN users marker ON ep.marked_paid_by = marker.user_id
      WHERE ep.participant_id = $1
        AND ep.is_paid = TRUE
      `,
      [participantId]
    );

    if (!details) {
      return res.status(404).send('Payment history item not found');
    }

    const formattedDetails = {
      participant_id: details.participant_id,
      expense_id: details.expense_id,
      description: details.description,
      total_expense_amount: Number(details.total_expense_amount).toFixed(2),
      amount_owed: Number(details.amount_owed).toFixed(2),
      created_at: details.created_at ? new Date(details.created_at).toLocaleString() : '',
      paid_at: details.paid_at ? new Date(details.paid_at).toLocaleString() : '',
      paid_by_name: details.paid_by_name,
      roommate_name: details.roommate_name,
      marked_paid_by_name: details.marked_paid_by_name || 'Unknown'
    };

    res.render('pages/payment-history-details', { payment: formattedDetails });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading payment details');
  }
});

app.get('/', (req, res) => {
  res.redirect('/balances');
});

module.exports = app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
