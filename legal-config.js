/* ============================================================================
   DEGENCARDS - legal identity, filled into /legal, /terms and /privacy.
   ONLY FILE TO EDIT before going live (and before selling anything):
   empty values show up in red as "[a completer]" on the pages.
   ============================================================================ */
window.LEGAL = {
  name:     '',                 // Nom Prenom (entrepreneur individuel / micro-entreprise), ou raison sociale
  status:   'Entrepreneur individuel (micro-entreprise)',
  address:  '',                 // adresse postale (ou adresse de domiciliation)
  siret:    '',                 // SIRET (obligatoire des qu'on vend)
  vat:      'TVA non applicable, art. 293 B du CGI',   // franchise en base ; sinon numero de TVA intracom
  email:    'squidyxzzz@gmail.com',                 // email de contact (support + RGPD), ex. contact@...
  director: '',                 // directeur de la publication (= vous)
  mediator: '',                 // mediateur de la consommation (nom + site), obligatoire pour vendre a des particuliers
  updated:  '5 octobre 2026 / October 5, 2026',
};
(function(){
  const L = window.LEGAL;
  document.querySelectorAll('[data-l]').forEach(el => {
    const v = (L[el.dataset.l] || '').trim();
    if(v){ el.textContent = v; if(el.dataset.l === 'email' && el.tagName === 'A') el.href = 'mailto:' + v; }
    else { el.textContent = '[\u00e0 compl\u00e9ter / to be completed]'; el.classList.add('todo'); }
  });
})();
