DROP TABLE IF EXISTS expense_participants;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
);

CREATE TABLE announcements (
    announcement_id SERIAL PRIMARY KEY,
    message VARCHAR(500) NOT NULL,
    author_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chores (
    chore_id SERIAL PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    assigned_to INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP,
    completed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expenses (
    expense_id SERIAL PRIMARY KEY,
    description VARCHAR(255) NOT NULL,
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    paid_by INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expense_participants (
    participant_id SERIAL PRIMARY KEY,
    expense_id INTEGER NOT NULL REFERENCES expenses(expense_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    amount_owed NUMERIC(10,2) NOT NULL CHECK (amount_owed >= 0),
    is_paid BOOLEAN DEFAULT FALSE,
    paid_at TIMESTAMP,
    marked_paid_by INTEGER REFERENCES users(user_id)
);

CREATE TABLE groups (
    group_id SERIAL PRIMARY KEY,
    group_name VARCHAR(100) NOT NULL,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE group_members (
    id SERIAL PRIMARY KEY,
    group_id INT REFERENCES groups(group_id) ON DELETE CASCADE,
    user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE(group_id, user_id)
);

-- password for all users is 'password' (bcrypt hashed)
INSERT INTO users (full_name, email, password) VALUES
('Brennan Long',  'brennan@test.com',   '$2b$10$DF1tG1G96APPC/oQQS6LTOsXsubwUicvuX8t3kPjtTr1WnGfQj1RW'),
('Jensen Trempe',    'Jensen@test.com', '$2b$10$DF1tG1G96APPC/oQQS6LTOsXsubwUicvuX8t3kPjtTr1WnGfQj1RW'),
('Roommate 2',    'roommate2@test.com', '$2b$10$DF1tG1G96APPC/oQQS6LTOsXsubwUicvuX8t3kPjtTr1WnGfQj1RW'),
('Roommate 3',    'roommate3@test.com', '$2b$10$DF1tG1G96APPC/oQQS6LTOsXsubwUicvuX8t3kPjtTr1WnGfQj1RW');

INSERT INTO expenses (description, amount, paid_by, created_at) VALUES
('Internet Bill', 90.00,  1, CURRENT_TIMESTAMP - INTERVAL '5 days'),
('Groceries',     60.00,  2, CURRENT_TIMESTAMP - INTERVAL '3 days'),
('Utilities',     120.00, 1, CURRENT_TIMESTAMP - INTERVAL '1 day');

INSERT INTO expense_participants (expense_id, user_id, amount_owed, is_paid, paid_at, marked_paid_by) VALUES
(1, 2, 30.00, TRUE,  CURRENT_TIMESTAMP - INTERVAL '4 days', 1),
(1, 3, 30.00, FALSE, NULL, NULL),
(2, 1, 30.00, TRUE,  CURRENT_TIMESTAMP - INTERVAL '2 days', 2),
(2, 3, 30.00, FALSE, NULL, NULL),
(3, 2, 40.00, FALSE, NULL, NULL),
(3, 3, 40.00, FALSE, NULL, NULL);

INSERT INTO groups (group_name, created_by) VALUES ('Apartment', 1);

INSERT INTO group_members (group_id, user_id) VALUES
(1, 1),
(1, 2),
(1, 3),
(1, 4);

-- test data
INSERT INTO chores (description, assigned_to) VALUES
('Take out the kitchen trash', 1),
('Wipe down the counters', 2),
('Vacuum the living room', 3),
('Clean the main bathroom', 4);