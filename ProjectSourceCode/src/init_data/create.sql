DROP TABLE IF EXISTS balance_requests CASCADE;
DROP TABLE IF EXISTS expense_participants CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS group_invites CASCADE;
DROP TABLE IF EXISTS group_members CASCADE;
DROP TABLE IF EXISTS groups CASCADE;
DROP TABLE IF EXISTS users_to_groups CASCADE;
DROP TABLE IF EXISTS roommate_groups CASCADE;
DROP TABLE IF EXISTS chores CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
);

CREATE TABLE roommate_groups (
    group_id SERIAL PRIMARY KEY,
    group_name VARCHAR(100) NOT NULL
);

CREATE TABLE users_to_groups (
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    group_id INT NOT NULL REFERENCES roommate_groups(group_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, group_id)
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

CREATE TABLE group_invites (
    token VARCHAR(255) PRIMARY KEY,
    group_id INT REFERENCES groups(group_id) ON DELETE CASCADE,
    email VARCHAR(120) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    group_id INT NOT NULL REFERENCES roommate_groups(group_id) ON DELETE CASCADE, 
    category VARCHAR(50),
    expense_date DATE DEFAULT CURRENT_DATE, 
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

CREATE TABLE balance_requests (
    request_id SERIAL PRIMARY KEY,
    group_id INT REFERENCES groups(group_id) ON DELETE CASCADE,
    requester_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    target_user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    description VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by INT REFERENCES users(user_id)
);
