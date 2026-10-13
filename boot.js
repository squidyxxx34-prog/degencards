/* runs before first paint: a returning signed-in user (or an OAuth / magic-link return) skips the landing flash.
   Everyone else, crawlers included, gets the landing straight from the HTML. app.js decides for real once the session is read. */
(function(){
  try{
    var k = 'sb-wlxyepkewatmwlziybfb-auth-token', v = localStorage.getItem(k);
    var back = /[?&#](code|access_token|token_hash)=/.test(location.search + location.hash);
    if(back || (v && v.indexOf('access_token') > -1)) document.documentElement.classList.add('dc-authed');
  }catch(e){}
})();
