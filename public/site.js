// Language of the public pages: the one chosen, else the browser's (French or English).
;(function () {
  var KEY = 'mymedia.siteLang'
  var langs = ['en', 'fr']
  function pick() {
    try {
      var saved = localStorage.getItem(KEY)
      if (langs.indexOf(saved) >= 0) return saved
    } catch (e) {}
    return (navigator.language || 'en').slice(0, 2) === 'fr' ? 'fr' : 'en'
  }
  function apply(lang) {
    document.documentElement.lang = lang
    var t = document.documentElement.getAttribute('data-title-' + lang)
    if (t) document.title = t
    var buttons = document.querySelectorAll('[data-set-lang]')
    for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute('aria-pressed', String(buttons[i].getAttribute('data-set-lang') === lang))
  }
  apply(pick())
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-set-lang]')
    if (!b) return
    var lang = b.getAttribute('data-set-lang')
    try { localStorage.setItem(KEY, lang) } catch (err) {}
    apply(lang)
  })
})()
