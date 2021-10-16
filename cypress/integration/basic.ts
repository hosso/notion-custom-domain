describe('Basic', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('stays in the custom domain', () => {
    cy.url().should('eq', Cypress.config().baseUrl + '/');
  });

  it('displays a notion page', () => {
    cy.get('body').should('has.class', 'notion-body');
  });
});
