DROP TABLE IF EXISTS users CASCADE;
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE
);

DROP TABLE IF EXISTS roommate_groups CASCADE;
CREATE TABLE roommate_groups (
    group_id SERIAL PRIMARY KEY,
    group_name VARCHAR(100) NOT NULL
);

DROP TABLE IF EXISTS users_to_groups CASCADE;
CREATE TABLE users_to_groups (
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    group_id INT NOT NULL REFERENCES roommate_groups(group_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, group_id)
);

DROP TABLE IF EXISTS expenses CASCADE;
CREATE TABLE expenses (
    expense_id SERIAL PRIMARY KEY,
    amount DECIMAL(10, 2) NOT NULL,
    note VARCHAR(255),
    added_by INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    group_id INT NOT NULL REFERENCES roommate_groups(group_id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tracks the specific breakdown of who owes what for each expense
DROP TABLE IF EXISTS expense_splits CASCADE;
CREATE TABLE expense_splits (
    split_id SERIAL PRIMARY KEY,
    expense_id INT NOT NULL REFERENCES expenses(expense_id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    amount_owed DECIMAL(10, 2) NOT NULL,
    share_percentage DECIMAL(5, 2) NOT NULL -- e.g., 33.33
);

-- Update the expenses table to include category and date
ALTER TABLE expenses ADD COLUMN category VARCHAR(50);
ALTER TABLE expenses ADD COLUMN expense_date DATE DEFAULT CURRENT_DATE;