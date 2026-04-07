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
});
