// ********************** Initialize server **********************************
const server = require('../index'); // Make sure path to your index.js is correct

// ********************** Import Libraries ***********************************
const chai = require('chai');
const chaiHttp = require('chai-http');
chai.should();
chai.use(chaiHttp);
const { assert, expect } = chai;

// ********************** DEFAULT WELCOME TESTCASE ****************************
describe('Server!', () => {
  it('Returns the default welcome message', (done) => {
    chai
      .request(server)
      .get('/welcome')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.status).to.equals('success');
        assert.strictEqual(res.body.message, 'Welcome!');
        done();
      });
  });
});

// ********************** REGISTER API TESTCASES ****************************
describe('Testing Register API', () => {
  // Positive Test Case: valid username and password should register successfully
  it('Positive: /register - valid registration should return success', (done) => {
    chai
      .request(server)
      .post('/register')
      .send({ username: 'testuser_valid', password: 'securepassword123' })
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.message).to.equals('Success');
        done();
      });
  });

  // Negative Test Case: empty password should fail with 400
  it('Negative: /register - missing password should return 400', (done) => {
    chai
      .request(server)
      .post('/register')
      .send({ username: '', password: '' })
      .end((err, res) => {
        expect(res).to.have.status(400);
        expect(res.body.message).to.equals('Username and password are required.');
        done();
      });
  });
});

// ********************** EXTRA CREDIT: ADDITIONAL UNIT TESTS ****************************
// Testing the /balances route (authenticated via temp session middleware in index.js)
describe('Testing Balances API (Extra Credit)', () => {
  // Positive Test Case: /balances should load and return HTML
  it('Positive: /balances - should render balances page with status 200', (done) => {
    chai
      .request(server)
      .get('/balances')
      .end((err, res) => {
        expect(res).to.have.status(200);
        res.should.be.html;
        expect(res.text).to.include('Current Balances With Roommates');
        done();
      });
  });

  // Negative Test Case: /mark-paid with invalid (non-numeric) participant ID should return 400
  it('Negative: /mark-paid/:participantId - invalid ID should return 400', (done) => {
    chai
      .request(server)
      .post('/mark-paid/not-a-number')
      .end((err, res) => {
        expect(res).to.have.status(400);
        done();
      });
  });
});

after(() => {
  server.close();
});
