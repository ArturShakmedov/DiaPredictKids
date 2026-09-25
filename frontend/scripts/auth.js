/* ==========================================================================
   NDST — вход и регистрация

   Одна форма обслуживает три страницы: вход врача, вход родителя и
   регистрацию родителя. Отличаются они только адресом запроса и тем,
   куда вести после успеха, — это задано атрибутами <body>:
     data-auth-url   — эндпоинт
     data-auth-home  — куда вернуться, если в адресе нет ?next
   Поле имени добавляется только на регистрации и отправляется, если есть.
   ========================================================================== */

(function () {
  'use strict';

  var T = function (ru) { return window.NdstI18n ? window.NdstI18n.t(ru) : ru; };

  var form = document.getElementById('loginForm');
  if (!form) return;

  var btn = document.getElementById('loginBtn');
  var errorBox = document.getElementById('loginError');
  var nameInput = document.getElementById('name');
  var codeInput = document.getElementById('code');   // регистрация врача

  var url = document.body.dataset.authUrl || '/api/auth/login';
  var home = document.body.dataset.authHome || '/doctor';

  /* Подсказка про демо-доступ показывается только на локальной машине */
  var isLocal = ['localhost', '127.0.0.1', '::1'].indexOf(location.hostname) !== -1;
  var hint = document.getElementById('demoHint');
  if (hint && isLocal) hint.hidden = false;

  function showError(text) {
    errorBox.textContent = text;
    errorBox.hidden = false;
  }

  function nextUrl() {
    var next = new URLSearchParams(location.search).get('next') || home;
    // принимаем только внутренние адреса — чтобы форму нельзя было
    // использовать для перенаправления на чужой сайт
    return /^\/[^/\\]/.test(next) ? next : home;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.hidden = true;

    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;
    var name = nameInput ? nameInput.value.trim() : null;

    if (!email || password.length < 8) {
      showError(T('Введите почту и пароль не короче 8 символов.'));
      return;
    }
    if (nameInput && name.length < 2) {
      showError(T('Укажите, как к вам обращаться.'));
      return;
    }
    if (codeInput && !codeInput.value.trim()) {
      showError(T('Введите код клиники.'));
      return;
    }

    var payload = { email: email, password: password };
    if (nameInput) payload.name = name;
    if (codeInput) payload.code = codeInput.value.trim();

    btn.dataset.busy = '1';

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    })
      .then(function (r) {
        return r.json().then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
      })
      .then(function (res) {
        if (res.ok) {
          location.href = nextUrl();
          return;
        }
        var detail = res.body && res.body.detail;
        // 422 от pydantic приходит списком — показываем общий текст
        if (typeof detail !== 'string') detail = T('Не удалось войти. Проверьте данные.');
        showError(T(detail));
        btn.dataset.busy = '';
      })
      .catch(function () {
        showError(T('Сервер недоступен. Попробуйте позже.'));
        btn.dataset.busy = '';
      });
  });
})();
