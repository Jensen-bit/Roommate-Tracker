const server = require('../index');
const chai = require('chai');
const chaiHttp = require('chai-http');

chai.should();
chai.use(chaiHttp);
const { expect } = chai;

describe('Server!', () => {
  it('Returns the default welcome message', (done) => {
    chai
      .request(server)
      .get('/welcome')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.status).to.equal('success');
        expect(res.body.message).to.equal('Welcome!');
        done();
      });
  });

  it('Loads the balances page', (done) => {
    chai
      .request(server)
      .get('/balances')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.text).to.include('Current Balances With Roommates');
        done();
      });
  });

  it('Loads the payment history page', (done) => {
    chai
      .request(server)
      .get('/payment-history')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.text).to.include('Payment History');
        done();
      });
  });

  it('Loads a single payment history detail page', (done) => {
    chai
      .request(server)
      .get('/payment-history/1')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.text).to.include('Payment Details');
        done();
      });
  });

  it('Returns 404 for invalid payment history detail ID', (done) => {
    chai
      .request(server)
      .get('/payment-history/99999')
      .end((err, res) => {
        expect(res).to.have.status(404);
        done();
      });
  });

  it('Filters payment history by roommate', (done) => {
    chai
      .request(server)
      .get('/payment-history?roommate=2')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.text).to.include('Payment History');
        done();
      });
  });
});