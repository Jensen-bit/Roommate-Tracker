# Lab 10 UAT Plan

## Team Information

- Team: FairShare
- Test environment: `localhost:3000` using Docker Compose
- Application under test: FairShare roommate expense tracking app
- User acceptance testers:
  - Brennan Long, student user
  - Jensen Trempe, student user
  - Elias Villalobos, student user
  - Brandon Aitken, student user
  - Cole, student user

## Feature 1: User Registration

### Description

This feature allows a new user to create an account by submitting a username and password through the `/register` route.

### Test Data

- Valid input:
  - Username: `test`
  - Password: `test`
- Invalid input:
  - Username: ``
  - Password: ``

### Test Environment

- Local Docker environment
- URL: `http://localhost:3000/register`
- PostgreSQL container initialized from `src/init_data/create.sql`

### User Activity / Test Cases

1. Navigate to `/register`.
2. Enter a valid username and password.
3. Submit the registration form.
4. Verify the application returns a successful response.
5. Repeat the test with empty username and password fields.

### Expected Results

- Valid registration should succeed with HTTP `200` and success message `Success`.
- Invalid registration should fail with HTTP `400` and message `Username and password are required.`

### Actual Observed Results

- Valid registration returned HTTP `200` and success message `Success`.
- Invalid registration returned HTTP `400` and the correct validation error message.

## Feature 2: View Current Balances

### Description

This feature allows an authenticated user to view current balances with roommates and unpaid expense shares on the `/balances` page.

### Test Data

- Seeded users and expenses from `src/init_data/create.sql`
- Temp session user in server middleware:
  - `user_id: 1`
  - `full_name: test`

### Test Environment

- Local Docker environment
- URL: `http://localhost:3000/balances`
- Handlebars-rendered page with seeded database content

### User Activity / Test Cases

1. Navigate to `/balances`.
2. Verify the page loads correctly.
3. Confirm roommate balance cards are displayed.
4. Confirm unpaid expense shares section is displayed.

### Expected Results

- Page should render successfully with HTTP `200`.
- Page should include the heading `Current Balances With Roommates`.
- User should see balance information and unpaid expense share information.

### Actual Observed Results

- `/balances` rendered successfully with HTTP `200`.
- The page displayed the expected heading and roommate balance cards.
- Unpaid expense shares were visible on the page.

## Feature 3: Payment History

### Description

This feature allows a user to view payment history records and details for previously paid expense shares.

### Test Data

- Seeded payment history data from `src/init_data/create.sql`
- Existing paid expense records with `is_paid = TRUE`

### Test Environment

- Local Docker environment
- URLs:
  - `http://localhost:3000/payment-history`
  - `http://localhost:3000/payment-history/<participantId>`

### User Activity / Test Cases

1. Navigate to `/payment-history`.
2. Verify the history page loads.
3. Select a payment history item.
4. Open its details page.
5. Verify payment details are shown correctly.

### Expected Results

- Payment history page should load successfully and show past paid items.
- Details page should display expense description, total amount, amount owed, payer, roommate, and payment timestamps.

### Actual Observed Results

- `/payment-history` loaded successfully in the browser.
- Payment detail pages displayed the expected fields and values for paid records.

## Summary

The three selected features were tested in the local Docker environment and behaved as expected. The application successfully handled both positive and negative test scenarios for registration, rendered the balances page correctly, and displayed payment history information properly.
