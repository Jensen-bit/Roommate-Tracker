const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const pgp = require('pg-promise')();
const session = require('express-session');
const exphbs = require('express-handlebars');
const bcrypt = require('bcryptjs');
const { sendExpenseEmail, sendGroupInviteEmail } = require('./src/services/emailService'); 
require('dotenv').config();

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const hbs = exphbs.create({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: __dirname + '/views/layouts',
  helpers: {
    eq: (a, b) => a === b,
    json: (context) => JSON.stringify(context),
    date: (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  }
});

app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', __dirname + '/views');

app.get('/dark-mode.css', (req, res) => res.sendFile(__dirname + '/dark-mode.css'));
app.get('/dark-mode.js', (req, res) => res.sendFile(__dirname + '/dark-mode.js'));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'super duper secret!',
    resave: false,
    saveUninitialized: false
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

app.use(async (req, res, next) => {
  if (!req.session.user) return next();
  try {
    const userId = req.session.user.user_id;
    const userEmail = req.session.user.email;
    const invites = await db.one(
      `SELECT COUNT(*) AS count FROM group_invites WHERE email = $1`,
      [userEmail]
    );
    const requests = await db.one(
      `SELECT COUNT(*) AS count FROM balance_requests br
       JOIN groups g ON br.group_id = g.group_id
       WHERE g.created_by = $1 AND br.status = 'pending'`,
      [userId]
    );
    const total = parseInt(invites.count) + parseInt(requests.count);
    res.locals.notificationCount = total > 0 ? total : null;
  } catch (_) {
    res.locals.notificationCount = null;
  }
  next();
});

const db = pgp({
  host: process.env.POSTGRES_HOST || 'db',
  port: 5432,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
});

if (process.env.NODE_ENV === 'test') {
  app.use((req, res, next) => {
    if (!req.session.user) {
      req.session.user = {
        user_id: 1,
        full_name: 'Test User'
      };
    }
    next();
  });
}

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/balances');
  res.render('pages/login', {
    layout: 'auth',
    title: 'Login',
    error: req.query.error || null
  });
});

app.post('/login', async (req, res) => {
  const email = req.body.email ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password ? req.body.password.trim() : '';

  if (!email || !password) {
    return res.status(400).render('pages/login', {
      layout: 'auth', title: 'Login', error: 'Email and password are required.'
    });
  }

  try {
    const user = await db.oneOrNone(`SELECT user_id, full_name, email, password FROM users WHERE LOWER(email) = $1`, [email]);
    if (!user) {
      return res.status(401).render('pages/login', { layout: 'auth', title: 'Login', error: 'Invalid email or password.' });
    }

    const storedPassword = user.password || '';
    const passwordMatches = storedPassword.startsWith('$2')
      ? await bcrypt.compare(password, storedPassword)
      : password === storedPassword;

    if (!passwordMatches) {
      return res.status(401).render('pages/login', { layout: 'auth', title: 'Login', error: 'Invalid email or password.' });
    }

    req.session.user = { user_id: user.user_id, full_name: user.full_name, email: user.email };
    return res.redirect('/balances');
  } catch (err) {
    console.error(err);
    return res.status(500).render('pages/login', { layout: 'auth', title: 'Login', error: 'Unable to log in right now.' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => { res.redirect('/login'); });
});

app.get('/register', (req, res) => {
  res.render('pages/register', { layout: 'auth', title: 'Register' });
});

app.post('/register', async (req, res) => {
  const username = req.body.username || req.body.full_name || req.body.name || '';
  const email = req.body.email || '';
  const password = req.body.password || '';

  if (!username || !email || !password) {
    return res.status(400).json({ status: 'error', message: 'Name, email, and password are required.' });
  }

  try {
    const hash = await bcrypt.hash(password.trim(), 10);
    await db.none(`INSERT INTO users(full_name, email, password) VALUES($1, $2, $3)`, [username.trim(), email.trim().toLowerCase(), hash]);
    return res.status(200).json({ status: 'success', message: 'Success' });
  } catch (err) {
    console.error("Registration Error:", err);
    return res.status(400).json({ status: 'error', message: 'Unable to register user. Email may already be in use.' });
  }
});

app.get('/welcome', (req, res) => {
  res.json({ status: 'success', message: 'Welcome!' });
});

app.post('/add-expense', async (req, res) => {
    const { amount, note, category, date, group_id, splits } = req.body;
    if (!req.session.user) return res.status(401).json({ error: "Unauthorized. Please log in." });
    const payerId = req.session.user.user_id;
    const payerName = req.session.user.full_name;

    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
        return res.status(400).json({ success: false, message: "Amount must be a positive number." });
    }

    try {
        await db.tx(async t => {
            const expense = await t.one(
                `INSERT INTO expenses (amount, description, category, expense_date, paid_by, group_id) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING expense_id`,
                [amount, note, category, date || new Date(), payerId, group_id]
            );
            const splitQueries = splits.map(s => {
                const amountOwed = (amount * (s.percent / 100)).toFixed(2);
                return t.none(
                    `INSERT INTO expense_participants (expense_id, user_id, amount_owed, is_paid) VALUES ($1, $2, $3, FALSE)`,
                    [expense.expense_id, s.user_id, amountOwed]
                );
            });
            await t.batch(splitQueries);
            const emailQuery = `
                SELECT u.email FROM users u
                JOIN group_members gm ON u.user_id = gm.user_id
                WHERE gm.group_id = $1 AND u.user_id != $2;
            `;
            const roommates = await t.any(emailQuery, [group_id, payerId]);
            const emailPromises = roommates.map(rm => sendExpenseEmail(rm.email, amount, payerName, note));
            await Promise.all(emailPromises);
        });
        res.status(200).json({ message: "Expense added and balances updated!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Could not process expense" });
    }
});

app.get('/balances', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const currentUserId = req.session.user.user_id;
    const selectedGroupId = req.query.group ? Number(req.query.group) : null;

    let groups = [];
    try {
      groups = await db.any(
        `SELECT g.group_id, g.group_name FROM groups g JOIN group_members gm ON g.group_id = gm.group_id WHERE gm.user_id = $1 ORDER BY g.group_name`,
        [currentUserId]
      );
    } catch (e) { groups = []; }

    let memberIds = [];
    let selectedGroup = null;
    if (selectedGroupId && groups.length) {
      selectedGroup = groups.find(g => g.group_id === selectedGroupId) || null;
      try {
        const members = await db.any(`SELECT user_id FROM group_members WHERE group_id = $1 AND user_id <> $2`, [selectedGroupId, currentUserId]);
        memberIds = members.map(m => m.user_id);
      } catch (e) { memberIds = []; }
    }

    const memberFilter = selectedGroupId && memberIds.length > 0 ? `AND u.user_id IN (${memberIds.join(',')})` : selectedGroupId ? 'AND FALSE' : '';
    const query = `
      WITH paid_by_me AS (
        SELECT ep.user_id AS roommate_id, SUM(ep.amount_owed) AS amount FROM expenses e
        JOIN expense_participants ep ON e.expense_id = ep.expense_id
        WHERE e.paid_by = $1 AND ep.user_id <> $1 AND ep.is_paid = FALSE GROUP BY ep.user_id
      ),
      i_owe_them AS (
        SELECT e.paid_by AS roommate_id, SUM(ep.amount_owed) AS amount FROM expenses e
        JOIN expense_participants ep ON e.expense_id = ep.expense_id
        WHERE ep.user_id = $1 AND e.paid_by <> $1 AND ep.is_paid = FALSE GROUP BY e.paid_by
      ),
      combined AS (
        SELECT u.user_id AS roommate_id, u.full_name AS roommate_name, COALESCE(pbm.amount, 0) - COALESCE(iot.amount, 0) AS net_balance
        FROM users u LEFT JOIN paid_by_me pbm ON u.user_id = pbm.roommate_id LEFT JOIN i_owe_them iot ON u.user_id = iot.roommate_id
        WHERE u.user_id <> $1 ${memberFilter}
      )
      SELECT roommate_id, roommate_name, ROUND(net_balance::numeric, 2) AS net_balance FROM combined ORDER BY roommate_name;
    `;

    const rows = await db.any(query, [currentUserId]);
    const balances = rows.map((row) => {
      const amount = Number(row.net_balance);
      if (amount > 0) return { roommate_id: row.roommate_id, roommate_name: row.roommate_name, net_balance: amount, color_class: 'text-success', is_zero: false, display_text: `${row.roommate_name} owes you $${amount.toFixed(2)}` };
      if (amount < 0) return { roommate_id: row.roommate_id, roommate_name: row.roommate_name, net_balance: amount, color_class: 'text-danger', is_zero: false, display_text: `You owe ${row.roommate_name} $${Math.abs(amount).toFixed(2)}` };
      return { roommate_id: row.roommate_id, roommate_name: row.roommate_name, net_balance: amount, color_class: 'text-secondary', is_zero: true, display_text: '$0.00' };
    });

    const unpaidShares = await db.any(`SELECT ep.participant_id, e.description, u.full_name AS owes_user, ep.amount_owed FROM expense_participants ep JOIN expenses e ON ep.expense_id = e.expense_id JOIN users u ON ep.user_id = u.user_id WHERE ep.is_paid = FALSE ORDER BY ep.participant_id;`);
    
    let announcements = [];
    try {
      announcements = await db.any(`SELECT a.announcement_id, a.message, u.full_name as author_name, a.author_id, to_char(a.created_at, 'Mon DD, YYYY') as date_posted FROM announcements a JOIN users u ON a.author_id = u.user_id ORDER BY a.created_at DESC`);
    } catch (e) { console.log('Notice: Announcements table might not exist yet.'); }

    res.render('pages/balances', { layout: 'main', title: 'Balances', balancesActive: true, balances, unpaidShares, groups, selectedGroupId, selectedGroup, announcements, currentUserId });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading balances page');
  }
});

app.post('/mark-paid/:participantId', async (req, res) => {
  try {
    const participantId = Number(req.params.participantId);
    if (isNaN(participantId)) return res.status(400).send('Invalid participant ID');
    if (!req.session.user) return res.status(401).send('You must be logged in');

    const existingShare = await db.oneOrNone(`SELECT participant_id, is_paid FROM expense_participants WHERE participant_id = $1`, [participantId]);
    if (!existingShare) return res.status(404).send('Expense share not found');
    if (existingShare.is_paid) return res.status(400).send('Expense share is already marked as paid');

    await db.none(`UPDATE expense_participants SET is_paid = TRUE, paid_at = CURRENT_TIMESTAMP, marked_paid_by = $2 WHERE participant_id = $1`, [participantId, req.session.user.user_id]);
    res.redirect('/balances');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error marking expense as paid');
  }
});

app.get('/payment-history', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const currentUserId = req.session.user.user_id;
    const roommateFilter = req.query.roommate ? Number(req.query.roommate) : null;

    let historyQuery = `
      SELECT ep.participant_id, e.description, e.created_at, ep.paid_at, payer.full_name AS paid_by_name, participant.full_name AS roommate_name, ep.amount_owed
      FROM expense_participants ep JOIN expenses e ON ep.expense_id = e.expense_id JOIN users payer ON e.paid_by = payer.user_id JOIN users participant ON ep.user_id = participant.user_id
      WHERE ep.is_paid = TRUE AND (e.paid_by = $1 OR ep.user_id = $1)
    `;
    const params = [currentUserId];
    if (roommateFilter) {
      historyQuery += ` AND (participant.user_id = $2 OR payer.user_id = $2) `;
      params.push(roommateFilter);
    }
    historyQuery += ` ORDER BY ep.paid_at DESC NULLS LAST, e.created_at DESC `;

    const history = await db.any(historyQuery, params);
    const formattedHistory = history.map((row) => ({
      participant_id: row.participant_id, description: row.description, created_at: row.created_at ? new Date(row.created_at).toLocaleDateString() : '',
      paid_at: row.paid_at ? new Date(row.paid_at).toLocaleDateString() : '', paid_by_name: row.paid_by_name, roommate_name: row.roommate_name, amount_owed: Number(row.amount_owed).toFixed(2)
    }));

    const roommates = await db.any(`SELECT user_id, full_name FROM users WHERE user_id <> $1 ORDER BY full_name`, [currentUserId]);
    res.render('pages/payment-history', { layout: 'main', title: 'Payment History', historyActive: true, history: formattedHistory, roommates, selectedRoommate: roommateFilter });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading payment history');
  }
});

app.get('/payment-history/:participantId', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const participantId = Number(req.params.participantId);
    if (isNaN(participantId)) return res.status(400).send('Invalid participant ID');

    const details = await db.oneOrNone(`
      SELECT ep.participant_id, e.expense_id, e.description, e.amount AS total_expense_amount, e.created_at, ep.amount_owed, ep.paid_at, payer.full_name AS paid_by_name, participant.full_name AS roommate_name, marker.full_name AS marked_paid_by_name
      FROM expense_participants ep JOIN expenses e ON ep.expense_id = e.expense_id JOIN users payer ON e.paid_by = payer.user_id JOIN users participant ON ep.user_id = participant.user_id LEFT JOIN users marker ON ep.marked_paid_by = marker.user_id
      WHERE ep.participant_id = $1 AND ep.is_paid = TRUE
    `, [participantId]);

    if (!details) return res.status(404).send('Payment history item not found');

    const formattedDetails = {
      participant_id: details.participant_id, expense_id: details.expense_id, description: details.description, total_expense_amount: Number(details.total_expense_amount).toFixed(2),
      amount_owed: Number(details.amount_owed).toFixed(2), created_at: details.created_at ? new Date(details.created_at).toLocaleString() : '', paid_at: details.paid_at ? new Date(details.paid_at).toLocaleString() : '',
      paid_by_name: details.paid_by_name, roommate_name: details.roommate_name, marked_paid_by_name: details.marked_paid_by_name || 'Unknown'
    };
    res.render('pages/payment-history-details', { layout: 'main', payment: formattedDetails, title: 'Payment Details', historyActive: true });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading payment details');
  }
});

app.get('/pay-balance', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const currentUserId = req.session.user.user_id;

    const owedByMe = await db.any(`
      SELECT ep.participant_id, e.description, ep.amount_owed, payer.user_id AS payer_id, payer.full_name AS payer_name, e.created_at
      FROM expense_participants ep JOIN expenses e ON ep.expense_id = e.expense_id JOIN users payer ON e.paid_by = payer.user_id
      WHERE ep.user_id = $1 AND e.paid_by <> $1 AND ep.is_paid = FALSE ORDER BY payer.full_name, e.created_at
    `, [currentUserId]);

    const grouped = {};
    owedByMe.forEach((row) => {
      if (!grouped[row.payer_id]) grouped[row.payer_id] = { payer_id: row.payer_id, payer_name: row.payer_name, total: 0, items: [] };
      grouped[row.payer_id].total += Number(row.amount_owed);
      grouped[row.payer_id].items.push({ participant_id: row.participant_id, description: row.description, amount_owed: Number(row.amount_owed).toFixed(2), created_at: row.created_at ? new Date(row.created_at).toLocaleDateString() : '' });
    });

    const payees = Object.values(grouped).map((g) => ({ ...g, total: g.total.toFixed(2) }));
    res.render('pages/pay-balance', { layout: 'main', title: 'Pay Balances', payBalanceActive: true, payees });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading pay balance page');
  }
});

app.post('/pay-all/:payerId', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('You must be logged in');
    const currentUserId = req.session.user.user_id;
    const payerId = Number(req.params.payerId);
    if (isNaN(payerId)) return res.status(400).send('Invalid payer ID');

    await db.none(`UPDATE expense_participants ep SET is_paid = TRUE, paid_at = CURRENT_TIMESTAMP, marked_paid_by = $1 FROM expenses e WHERE ep.expense_id = e.expense_id AND ep.user_id = $1 AND e.paid_by = $2 AND ep.is_paid = FALSE`, [currentUserId, payerId]);
    res.redirect('/pay-balance');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing payment');
  }
});

app.post('/pay-single/:participantId', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('You must be logged in');
    const currentUserId = req.session.user.user_id;
    const participantId = Number(req.params.participantId);
    if (isNaN(participantId)) return res.status(400).send('Invalid participant ID');

    const share = await db.oneOrNone(`SELECT participant_id, is_paid, user_id FROM expense_participants WHERE participant_id = $1`, [participantId]);
    if (!share) return res.status(404).send('Share not found');
    if (share.is_paid) return res.status(400).send('Already paid');
    if (share.user_id !== currentUserId) return res.status(403).send('Not authorized');

    await db.none(`UPDATE expense_participants SET is_paid = TRUE, paid_at = CURRENT_TIMESTAMP, marked_paid_by = $2 WHERE participant_id = $1`, [participantId, currentUserId]);
    res.redirect('/pay-balance');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing payment');
  }
});

app.get('/groups', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const currentUserId = req.session.user.user_id;

    let groupsWithMembers = [];
    try {
      const groups = await db.any(
        `SELECT g.group_id, g.group_name, g.created_by, COUNT(gm.user_id) AS member_count
         FROM groups g JOIN group_members gm ON g.group_id = gm.group_id
         WHERE g.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
         GROUP BY g.group_id, g.group_name, g.created_by ORDER BY g.group_name`,
        [currentUserId]
      );
      groupsWithMembers = await Promise.all(groups.map(async (g) => {
        const members = await db.any(`SELECT u.user_id, u.full_name, u.email FROM group_members gm JOIN users u ON gm.user_id = u.user_id WHERE gm.group_id = $1 ORDER BY u.full_name`, [g.group_id]);
        return { ...g, members };
      }));
    } catch (e) { groupsWithMembers = []; }

    res.render('pages/groups', { layout: 'main', title: 'Groups', groupsActive: true, groups: groupsWithMembers, currentUserId: currentUserId, error: req.query.error || null, success: req.query.success || null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading groups page');
  }
});

app.post('/groups/create', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('You must be logged in');
    const currentUserId = req.session.user.user_id;
    const groupName = req.body.group_name ? req.body.group_name.trim() : '';

    if (!groupName) return res.redirect('/groups?error=Group+name+is+required');
    const newGroup = await db.one(`INSERT INTO groups (group_name, created_by) VALUES ($1, $2) RETURNING group_id`, [groupName, currentUserId]);
    await db.none(`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`, [newGroup.group_id, currentUserId]);
    res.redirect('/groups?success=Group+created+successfully');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating group');
  }
});

app.post('/groups/:groupId/add', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('You must be logged in');
    const groupId = Number(req.params.groupId);
    const email = req.body.email ? req.body.email.trim().toLowerCase() : '';

    if (!email) return res.redirect(`/groups?error=Email+is+required`);

    const group = await db.oneOrNone('SELECT group_name FROM groups WHERE group_id = $1', [groupId]);
    if (!group) return res.redirect(`/groups?error=Group+not+found`);

    const existingMember = await db.oneOrNone(`SELECT gm.id FROM group_members gm JOIN users u ON gm.user_id = u.user_id WHERE gm.group_id = $1 AND u.email = $2`, [groupId, email]);
    if (existingMember) return res.redirect(`/groups?error=That+person+is+already+in+this+group`);

    // Generate secure token
    const token = crypto.randomBytes(16).toString('hex');

    await db.none(`INSERT INTO group_invites (token, group_id, email) VALUES ($1, $2, $3)`, [token, groupId, email]);
    
    // Fire Email Link
    const inviteLink = `http://localhost:3000/groups/join/${token}`;
    await sendGroupInviteEmail(email, req.session.user.full_name, group.group_name, inviteLink);

    res.redirect('/groups?success=Invitation+email+sent!');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error sending invitation');
  }
});

// The link they click inside the email
app.get('/groups/join/:token', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login?error=Please+log+in+to+accept+your+invitation.');
    const token = req.params.token;
    const currentUserId = req.session.user.user_id;
    const currentUserEmail = req.session.user.email;

    const invite = await db.oneOrNone('SELECT * FROM group_invites WHERE token = $1', [token]);
    if (!invite) return res.redirect('/groups?error=Invalid+or+expired+invitation+link.');
    if (invite.email !== currentUserEmail) return res.redirect('/groups?error=This+invitation+was+sent+to+a+different+email+address.');

    await db.none(`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [invite.group_id, currentUserId]);
    await db.none('DELETE FROM group_invites WHERE token = $1', [token]);

    res.redirect('/groups?success=You+have+successfully+joined+the+group!');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error joining group');
  }
});

app.post('/groups/:groupId/remove/:userId', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('You must be logged in');
    await db.none(`DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`, [Number(req.params.groupId), Number(req.params.userId)]);
    res.redirect('/groups?success=Member+removed');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error removing member');
  }
});

app.post('/groups/:groupId/delete', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('You must be logged in');
    const groupId = Number(req.params.groupId);
    const currentUserId = req.session.user.user_id;
    const group = await db.oneOrNone(`SELECT created_by FROM groups WHERE group_id = $1`, [groupId]);
    if (!group || group.created_by !== currentUserId) return res.redirect('/groups?error=Only+the+group+creator+can+delete+it');

    await db.none(`DELETE FROM group_members WHERE group_id = $1`, [groupId]);
    await db.none(`DELETE FROM groups WHERE group_id = $1`, [groupId]);
    res.redirect('/groups?success=Group+deleted');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting group');
  }
});

app.get('/notifications', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const currentUserId = req.session.user.user_id;
    const currentUserEmail = req.session.user.email;
    const groupInvites = await db.any(
      `SELECT gi.token AS invite_id, gi.created_at,
              to_char(gi.created_at, 'Mon DD, YYYY') AS invite_date,
              g.group_name,
              'A Group Member' AS invited_by_name
       FROM group_invites gi
       JOIN groups g ON gi.group_id = g.group_id
       WHERE gi.email = $1
       ORDER BY gi.created_at DESC`,
      [currentUserEmail]
    );

    const balanceRequests = await db.any(
      `SELECT br.request_id, br.amount, br.description,
              to_char(br.created_at, 'Mon DD, YYYY') AS created_date,
              g.group_name,
              req.full_name AS requester_name,
              tgt.full_name AS target_name
       FROM balance_requests br
       JOIN groups g ON br.group_id = g.group_id
       JOIN users req ON br.requester_id = req.user_id
       JOIN users tgt ON br.target_user_id = tgt.user_id
       WHERE g.created_by = $1 AND br.status = 'pending'
       ORDER BY br.created_at DESC`,
      [currentUserId]
    );

    res.render('pages/notifications', { layout: 'main', title: 'Notifications', notificationsActive: true, groupInvites, balanceRequests, hasGroupInvites: groupInvites.length > 0, hasBalanceRequests: balanceRequests.length > 0, hasAny: groupInvites.length > 0 || balanceRequests.length > 0, error: req.query.error || null, success: req.query.success || null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading notifications');
  }
});

app.post('/notifications/invite/:id/accept', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  res.redirect(`/groups/join/${req.params.id}`);
});

app.post('/notifications/invite/:id/decline', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('Login required');
    await db.none(`DELETE FROM group_invites WHERE token = $1 AND email = $2`, [req.params.id, req.session.user.email]);
    res.redirect('/notifications?success=Invite+declined');
  } catch (err) {
    console.error(err);
    res.redirect('/notifications?error=Failed+to+decline+invite');
  }
});

app.post('/notifications/balance/:id/accept', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('Login required');
    const currentUserId = req.session.user.user_id;
    const requestId = Number(req.params.id);

    const request = await db.oneOrNone(`SELECT br.*, g.created_by AS manager_id FROM balance_requests br JOIN groups g ON br.group_id = g.group_id WHERE br.request_id = $1 AND br.status = 'pending'`, [requestId]);
    if (!request || request.manager_id !== currentUserId) return res.redirect('/notifications?error=Not+authorized+or+request+not+found');

    const expense = await db.one(`INSERT INTO expenses (description, amount, paid_by, group_id, category) VALUES ($1, $2, $3, $4, 'Balance Update') RETURNING expense_id`, [request.description, request.amount, request.requester_id, request.group_id]);
    await db.none(`INSERT INTO expense_participants (expense_id, user_id, amount_owed) VALUES ($1, $2, $3)`, [expense.expense_id, request.target_user_id, request.amount]);
    await db.none(`UPDATE balance_requests SET status = 'accepted', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $1 WHERE request_id = $2`, [currentUserId, requestId]);

    res.redirect('/notifications?success=Balance+request+accepted');
  } catch (err) {
    console.error(err);
    res.redirect('/notifications?error=Failed+to+accept+request');
  }
});

app.post('/notifications/balance/:id/reject', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('Login required');
    const currentUserId = req.session.user.user_id;
    const requestId = Number(req.params.id);

    const request = await db.oneOrNone(`SELECT br.*, g.created_by AS manager_id FROM balance_requests br JOIN groups g ON br.group_id = g.group_id WHERE br.request_id = $1 AND br.status = 'pending'`, [requestId]);
    if (!request || request.manager_id !== currentUserId) return res.redirect('/notifications?error=Not+authorized+or+request+not+found');

    await db.none(`UPDATE balance_requests SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $1 WHERE request_id = $2`, [currentUserId, requestId]);
    res.redirect('/notifications?success=Balance+request+rejected');
  } catch (err) {
    console.error(err);
    res.redirect('/notifications?error=Failed+to+reject+request');
  }
});

app.get('/money', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const currentUserId = req.session.user.user_id;

    const managedGroups = await db.any(`SELECT group_id, group_name FROM groups WHERE created_by = $1 ORDER BY group_name`, [currentUserId]);
    for (const g of managedGroups) {
      g.members = await db.any(`SELECT u.user_id, u.full_name FROM group_members gm JOIN users u ON gm.user_id = u.user_id WHERE gm.group_id = $1 AND gm.user_id <> $2 ORDER BY u.full_name`, [g.group_id, currentUserId]);
    }

    const memberGroups = await db.any(`SELECT g.group_id, g.group_name FROM groups g JOIN group_members gm ON g.group_id = gm.group_id WHERE gm.user_id = $1 AND g.created_by <> $1 ORDER BY g.group_name`, [currentUserId]);
    for (const g of memberGroups) {
      g.members = await db.any(`SELECT u.user_id, u.full_name FROM group_members gm JOIN users u ON gm.user_id = u.user_id WHERE gm.group_id = $1 AND gm.user_id <> $2 ORDER BY u.full_name`, [g.group_id, currentUserId]);
    }

    const pendingRequests = await db.any(`SELECT br.request_id, br.amount, br.description, to_char(br.created_at, 'Mon DD, YYYY') AS created_date, g.group_name, req.full_name AS requester_name, tgt.full_name AS target_name FROM balance_requests br JOIN groups g ON br.group_id = g.group_id JOIN users req ON br.requester_id = req.user_id JOIN users tgt ON br.target_user_id = tgt.user_id WHERE g.created_by = $1 AND br.status = 'pending' ORDER BY br.created_at DESC`, [currentUserId]);
    const myRequests = await db.any(`SELECT br.request_id, br.amount, br.description, br.status, to_char(br.created_at, 'Mon DD, YYYY') AS created_date, to_char(br.reviewed_at, 'Mon DD, YYYY') AS reviewed_date, g.group_name, tgt.full_name AS target_name, rv.full_name AS reviewed_by_name FROM balance_requests br JOIN groups g ON br.group_id = g.group_id JOIN users tgt ON br.target_user_id = tgt.user_id LEFT JOIN users rv ON br.reviewed_by = rv.user_id WHERE br.requester_id = $1 ORDER BY br.created_at DESC`, [currentUserId]);

    res.render('pages/money', { layout: 'main', title: 'Add Balance', moneyActive: true, managedGroups, memberGroups, pendingRequests, myRequests, isManagerAnywhere: managedGroups.length > 0, isMemberNotManager: memberGroups.length > 0, hasPendingRequests: pendingRequests.length > 0, hasMyRequests: myRequests.length > 0, managedGroupsJson: JSON.stringify(managedGroups), memberGroupsJson: JSON.stringify(memberGroups), error: req.query.error || null, success: req.query.success || null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading Add Balance page');
  }
});

app.post('/money/add', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('Login required');
    const currentUserId = req.session.user.user_id;
    const groupId = Number(req.body.group_id);
    const targetUserId = Number(req.body.user_id);
    const amount = parseFloat(req.body.amount);
    const description = req.body.description ? req.body.description.trim() : 'Balance added by manager';

    if (!groupId || !targetUserId || isNaN(amount) || amount <= 0) return res.redirect('/money?error=Invalid+input');

    const group = await db.oneOrNone(`SELECT created_by FROM groups WHERE group_id = $1`, [groupId]);
    if (!group || group.created_by !== currentUserId) return res.redirect('/money?error=Only+the+group+manager+can+add+balances+directly');

    const isMember = await db.oneOrNone(`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`, [groupId, targetUserId]);
    if (!isMember || targetUserId === currentUserId) return res.redirect('/money?error=Invalid+target+member');

    const expense = await db.one(`INSERT INTO expenses (description, amount, paid_by, group_id, category) VALUES ($1, $2, $3, $4, 'Balance Update') RETURNING expense_id`, [description, amount, currentUserId, groupId]);
    await db.none(`INSERT INTO expense_participants (expense_id, user_id, amount_owed) VALUES ($1, $2, $3)`, [expense.expense_id, targetUserId, amount]);

    res.redirect('/money?success=Balance+added+successfully');
  } catch (err) {
    console.error(err);
    res.redirect('/money?error=Failed+to+add+balance');
  }
});

app.post('/money/request', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('Login required');
    const currentUserId = req.session.user.user_id;
    const groupId = Number(req.body.group_id);
    const targetUserId = Number(req.body.user_id);
    const amount = parseFloat(req.body.amount);
    const description = req.body.description ? req.body.description.trim() : '';

    if (!groupId || !targetUserId || isNaN(amount) || amount <= 0 || !description) return res.redirect('/money?error=All+fields+are+required');

    const group = await db.oneOrNone(`SELECT created_by FROM groups WHERE group_id = $1`, [groupId]);
    if (!group) return res.redirect('/money?error=Group+not+found');
    if (group.created_by === currentUserId) return res.redirect('/money?error=Managers+can+add+balances+directly');

    const isMember = await db.oneOrNone(`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`, [groupId, currentUserId]);
    if (!isMember) return res.redirect('/money?error=You+are+not+in+this+group');

    const isTargetMember = await db.oneOrNone(`SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`, [groupId, targetUserId]);
    if (!isTargetMember || targetUserId === currentUserId) return res.redirect('/money?error=Invalid+target+member');

    await db.none(`INSERT INTO balance_requests (group_id, requester_id, target_user_id, amount, description) VALUES ($1, $2, $3, $4, $5)`, [groupId, currentUserId, targetUserId, amount, description]);

    res.redirect('/money?success=Request+submitted!+Waiting+for+manager+approval');
  } catch (err) {
    console.error(err);
    res.redirect('/money?error=Failed+to+submit+request');
  }
});

app.post('/money/requests/:id/accept', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('Login required');
    const currentUserId = req.session.user.user_id;
    const requestId = Number(req.params.id);

    const request = await db.oneOrNone(`SELECT br.*, g.created_by AS manager_id FROM balance_requests br JOIN groups g ON br.group_id = g.group_id WHERE br.request_id = $1 AND br.status = 'pending'`, [requestId]);
    if (!request || request.manager_id !== currentUserId) return res.redirect('/money?error=Not+authorized+or+request+not+found');

    const expense = await db.one(`INSERT INTO expenses (description, amount, paid_by, group_id, category) VALUES ($1, $2, $3, $4, 'Balance Update') RETURNING expense_id`, [request.description, request.amount, request.requester_id, request.group_id]);
    await db.none(`INSERT INTO expense_participants (expense_id, user_id, amount_owed) VALUES ($1, $2, $3)`, [expense.expense_id, request.target_user_id, request.amount]);
    await db.none(`UPDATE balance_requests SET status = 'accepted', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $1 WHERE request_id = $2`, [currentUserId, requestId]);

    res.redirect('/money?success=Request+accepted+and+balance+updated');
  } catch (err) {
    console.error(err);
    res.redirect('/money?error=Failed+to+accept+request');
  }
});

app.post('/money/requests/:id/reject', async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).send('Login required');
    const currentUserId = req.session.user.user_id;
    const requestId = Number(req.params.id);

    const request = await db.oneOrNone(`SELECT br.*, g.created_by AS manager_id FROM balance_requests br JOIN groups g ON br.group_id = g.group_id WHERE br.request_id = $1 AND br.status = 'pending'`, [requestId]);
    if (!request || request.manager_id !== currentUserId) return res.redirect('/money?error=Not+authorized+or+request+not+found');

    await db.none(`UPDATE balance_requests SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $1 WHERE request_id = $2`, [currentUserId, requestId]);

    res.redirect('/money?success=Request+rejected');
  } catch (err) {
    console.error(err);
    res.redirect('/money?error=Failed+to+reject+request');
  }
});

app.get('/settings', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const user = await db.oneOrNone(`SELECT user_id, full_name, email FROM users WHERE user_id = $1`, [req.session.user.user_id]);
    if (!user) return res.redirect('/login');
    res.render('pages/settings', { layout: 'main', title: 'Account Settings', settingsActive: true, user, success: req.query.success || null, error: req.query.error || null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading settings');
  }
});

app.post('/settings/name', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const name = req.body.full_name ? req.body.full_name.trim() : '';
    if (!name) return res.redirect('/settings?error=Name+cannot+be+empty');

    await db.none(`UPDATE users SET full_name = $1 WHERE user_id = $2`, [name, req.session.user.user_id]);
    req.session.user.full_name = name;
    res.redirect('/settings?success=name');
  } catch (err) {
    console.error(err);
    res.redirect('/settings?error=Failed+to+update+name');
  }
});

app.post('/settings/email', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const email = req.body.email ? req.body.email.trim().toLowerCase() : '';
    if (!email) return res.redirect('/settings?error=Email+cannot+be+empty');

    const existing = await db.oneOrNone(`SELECT user_id FROM users WHERE LOWER(email) = $1 AND user_id <> $2`, [email, req.session.user.user_id]);
    if (existing) return res.redirect('/settings?error=That+email+is+already+in+use');

    await db.none(`UPDATE users SET email = $1 WHERE user_id = $2`, [email, req.session.user.user_id]);
    req.session.user.email = email;
    res.redirect('/settings?success=email');
  } catch (err) {
    console.error(err);
    res.redirect('/settings?error=Failed+to+update+email');
  }
});

app.post('/settings/password', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) return res.redirect('/settings?error=All+password+fields+are+required');
    if (new_password !== confirm_password) return res.redirect('/settings?error=New+passwords+do+not+match');
    if (new_password.length < 6) return res.redirect('/settings?error=Password+must+be+at+least+6+characters');

    const user = await db.oneOrNone(`SELECT password FROM users WHERE user_id = $1`, [req.session.user.user_id]);
    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) return res.redirect('/settings?error=Current+password+is+incorrect');

    const hashed = await bcrypt.hash(new_password, 10);
    await db.none(`UPDATE users SET password = $1 WHERE user_id = $2`, [hashed, req.session.user.user_id]);
    res.redirect('/settings?success=password');
  } catch (err) {
    console.error(err);
    res.redirect('/settings?error=Failed+to+update+password');
  }
});

app.get('/', (req, res) => {
  res.redirect('/balances');
});

app.post('/announcements/add', async (req, res) => {
  try {
    const { message } = req.body;
    await db.none('INSERT INTO announcements (message, author_id) VALUES ($1, $2)', [message, req.session.user.user_id]);
    res.redirect('/balances');
  } catch (err) {
    console.log(err);
    res.redirect('/balances?error=Failed to post announcement');
  }
});

app.post('/announcements/:id/delete', async (req, res) => {
  try {
    await db.none('DELETE FROM announcements WHERE announcement_id = $1 AND author_id = $2', [req.params.id, req.session.user.user_id]);
    res.redirect('/balances');
  } catch (err) {
    console.log(err);
    res.redirect('/balances');
  }
});

app.get('/chores', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    let chores = [];
    try {
      chores = await db.any(`
        SELECT c.chore_id, c.description, c.is_completed, u.full_name as assigned_name, cb.full_name as completed_by_name, to_char(c.completed_at, 'Mon DD, YYYY HH:MI AM') as completed_date
        FROM chores c LEFT JOIN users u ON c.assigned_to = u.user_id LEFT JOIN users cb ON c.completed_by = cb.user_id ORDER BY c.is_completed ASC, c.created_at DESC
      `);
    } catch (e) { console.log('Notice: Chores table might not exist yet.'); }

    const roommates = await db.any('SELECT user_id, full_name FROM users ORDER BY full_name');
    res.render('pages/chores', { layout: 'main', title: 'Household Chores', choresActive: true, chores: chores, roommates: roommates, error: req.query.error, success: req.query.success });
  } catch (err) {
    console.error(err);
    res.redirect('/balances?error=Failed to load chores');
  }
});

app.post('/chores/:id/complete', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    await db.none(`UPDATE chores SET is_completed = TRUE, completed_at = CURRENT_TIMESTAMP, completed_by = $1 WHERE chore_id = $2`, [req.session.user.user_id, req.params.id]);
    res.redirect('/chores?success=Chore marked complete!');
  } catch (err) {
    console.error(err);
    res.redirect('/chores?error=Failed to update chore');
  }
});

app.post('/chores/add', async (req, res) => {
  try {
    if (!req.session.user) return res.redirect('/login');
    const { description, assigned_to } = req.body;
    await db.none('INSERT INTO chores (description, assigned_to) VALUES ($1, $2)', [description, assigned_to]);
    res.redirect('/chores?success=Chore added!');
  } catch (err) {
    console.error(err);
    res.redirect('/chores?error=Failed to add chore');
  }
});

if (require.main === module) {
  app.listen(3000, '0.0.0.0', () => {
    console.log('Server is running on port 3000');
  });
}

module.exports = app;