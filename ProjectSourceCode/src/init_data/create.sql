DROP TABLE IF EXISTS expense_participants;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
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
    amount_owed NUMERIC(10,2) NOT NULL CHECK (amount_owed >= 0)
);

INSERT INTO users (full_name, email, password) VALUES
('Brennan Long', 'brennan@test.com', '$2a$10$abcdefghijklmnopqrstuv'),
('Roommate 1', 'roommate1@test.com', '$2a$10$abcdefghijklmnopqrstuv'),
('Roommate 2', 'roommate2@test.com', '$2a$10$abcdefghijklmnopqrstuv'),
('Roommate 3', 'roommate3@test.com', '$2a$10$abcdefghijklmnopqrstuv');

-- Example expense:
-- I paid $90 internet for all 3 people equally
INSERT INTO expenses (description, amount, paid_by)
VALUES ('Internet Bill', 90.00, 1);

INSERT INTO expense_participants (expense_id, user_id, amount_owed) VALUES
(1, 2, 30.00),
(1, 3, 30.00);
