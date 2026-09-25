/* ==========================================================================
   NDST — кабинет врача (демо)
   Все данные вымышленные и живут только в памяти вкладки.
   ========================================================================== */

(function () {
  'use strict';

  var T = function (ru, vars) {
    return window.NdstI18n ? window.NdstI18n.t(ru, vars) : ru;
  };
  var applyI18n = function (el) {
    if (window.NdstI18n) window.NdstI18n.apply(el);
  };

  /* ======================================================================
     Демонстрационные данные
     ====================================================================== */

  let PATIENTS = [];   // наполняется из /api/assessments
  let lastStats = null;

  const PER_PAGE = 8;

  const LEVELS = {
    low:  { key: 'low',  label: 'Низкий',    color: '#22C55E' },
    mod:  { key: 'mod',  label: 'Умеренный', color: '#F59E0B' },
    high: { key: 'high', label: 'Высокий',   color: '#EF4444' }
  };

  // Справочные значения: в балл не входят, но врачу их видеть нужно —
  // иначе анкета собирала бы группу крови в пустоту.
  // Неразрывный пробел: в узкой колонке «B (III)» иначе рвётся на две строки
  const BLOOD = {
    O: 'O (I)', A: 'A (II)', B: 'B (III)', AB: 'AB (IV)'
  };

  // Шкала ДСТ: степень дисплазии считается отдельно от риска диабета
  const DST_SHORT = { 0: 'Без ДСТ', 1: 'ДСТ I', 2: 'ДСТ II', 3: 'ДСТ III' };
  const DST_GROUP = {
    0: 'Без ДСТ (индекс 0–15)',
    1: 'ДСТ I степени (индекс 16–25)',
    2: 'ДСТ II степени (индекс 26–35)',
    3: 'ДСТ III степени (индекс 36 и выше)'
  };
  const DST_BADGE = { 0: 'low', 1: 'mod', 2: 'high', 3: 'high' };

  function levelOf(score) {
    if (score >= 60) return LEVELS.high;
    if (score >= 25) return LEVELS.mod;
    return LEVELS.low;
  }

  /* ======================================================================
     Утилиты
     ====================================================================== */

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function fmtDate(iso) {
    const months = window.NdstI18n
      ? window.NdstI18n.months()
      : ['янв', 'фев', 'мар', 'апр', 'мая', 'июн',
         'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    const d = new Date(iso + 'T00:00:00');
    return d.getDate() + ' ' + months[d.getMonth()];
  }

  function plural(n, forms) {
    if (window.NdstI18n) return window.NdstI18n.plural(n, forms);
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function rowHTML(p, withStatus) {
    const lv = levelOf(p.score);
    const tags = p.factors.length
      ? p.factors.slice(0, 3).map((f) => '<span class="pill">' + esc(f) + '</span>').join(' ')
      : '<span class="text-3 small">не отмечены</span>';

    const name = T(p.name);
    return '<tr>' +
      '<td><div class="patient">' +
        '<span class="patient__av">' + esc(initials(name)) + '</span>' +
        '<button class="patient__open" type="button" data-card="' + esc(p.id) + '">' +
          '<span class="patient__name">' + esc(name) + '</span><br>' +
          '<span class="patient__id">' + esc(p.id) +
            (p.blood ? ' · ' + esc(p.blood) : '') + '</span></button>' +
        // кнопка рядом с кодом: последняя колонка на ноутбуке уезжала за край таблицы
        '<button class="icon-btn icon-btn--sm patient__pdf" type="button" title="Скачать PDF" ' +
          'aria-label="Скачать PDF" data-pdf="' + esc(p.id) + '">' +
          '<i data-icon="download"></i></button>' +
      '</div></td>' +
      '<td>' + p.age + ' ' + plural(p.age, ['год', 'года', 'лет']) + '</td>' +
      '<td><div class="risk-cell">' +
        '<span class="risk-cell__score ' + lv.key + '">' + p.score + '%</span>' +
        '<span class="badge badge--' + lv.key + '"><span class="dot"></span>' + lv.label + '</span>' +
      '</div></td>' +
      // кнопка открывает осмотр по полной шкале ДСТ
      '<td><button class="dst-cell" type="button" data-exam="' + esc(p.id) + '">' +
        '<span class="dst-cell__deg dst-deg--' + p.dstDegree + '">' + DST_SHORT[p.dstDegree] + '</span>' +
        '<span class="dst-cell__meta"><span>' + esc(T('индекс {n}', { n: p.dst })) + '</span> · ' +
          '<span>' + (p.dstSource === 'doctor' ? 'осмотр врача' : 'со слов родителя') + '</span></span>' +
      '</button></td>' +
      '<td><div class="row row-wrap" style="gap:6px">' + tags + '</div></td>' +
      '<td>' + fmtDate(p.date) + '</td>' +
      (withStatus
        ? '<td><span class="status ' + (p.follow ? 'wait' : 'done') + '">' +
          '<i data-icon="' + (p.follow ? 'bell' : 'check-circle') + '"></i>' +
          (p.follow ? 'Нужен контроль' : 'Наблюдение') + '</span></td>'
        : '') +
    '</tr>';
  }

  /* ======================================================================
     Кольцевая диаграмма распределения риска
     ====================================================================== */

  function renderDonut() {
    const counts = { low: 0, mod: 0, high: 0 };
    PATIENTS.forEach((p) => { counts[levelOf(p.score).key]++; });
    const total = PATIENTS.length || 1;   // пустая база не должна ронять диаграмму

    const svg = $('#donut');
    const R = 74, CX = 100, CY = 100;
    const C = 2 * Math.PI * R;
    let offset = 0;
    let parts = '';

    ['high', 'mod', 'low'].forEach((k) => {
      const frac = counts[k] / total;
      const len = C * frac;
      parts +=
        '<circle cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="none" ' +
        'stroke="' + LEVELS[k].color + '" stroke-width="22" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" ' +
        'stroke-dashoffset="' + (-offset).toFixed(2) + '" ' +
        'transform="rotate(-90 ' + CX + ' ' + CY + ')" stroke-linecap="butt"/>';
      offset += len;
    });

    svg.innerHTML =
      '<circle cx="100" cy="100" r="74" fill="none" stroke="#193149" stroke-width="22"/>' +
      parts +
      '<text x="100" y="96" text-anchor="middle" fill="#F4F8FC" font-family="Inter, sans-serif" ' +
        'font-size="30" font-weight="700" letter-spacing="-1">' + total + '</text>' +
      '<text x="100" y="116" text-anchor="middle" fill="#71869A" font-family="Inter, sans-serif" ' +
        'font-size="10" letter-spacing="1">ОЦЕНОК</text>';

    applyI18n(svg);
    $('#donutLegend').innerHTML = ['high', 'mod', 'low'].map((k) =>
      '<div class="legend__item">' +
        '<span class="legend__dot" style="background:' + LEVELS[k].color + '"></span>' +
        LEVELS[k].label + ' риск' +
        '<span class="legend__val">' + counts[k] + '</span>' +
        '<span class="legend__pct">' + Math.round(counts[k] / total * 100) + '%</span>' +
      '</div>').join('');
    applyI18n($('#donutLegend'));
  }

  /* ======================================================================
     Таблица пациентов: поиск, фильтры, сортировка, страницы
     ====================================================================== */

  const state = { filter: 'all', query: '', sort: 'date', dir: -1, page: 1 };

  function filtered() {
    let list = PATIENTS.slice();

    if (state.filter === 'followup') list = list.filter((p) => p.follow);
    else if (state.filter === 'dst') list = list.filter((p) => p.dstDegree >= 1);
    else if (state.filter === 'nodst') list = list.filter((p) => p.dstDegree === 0);
    else if (state.filter !== 'all') list = list.filter((p) => levelOf(p.score).key === state.filter);

    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter((p) =>
        p.name.toLowerCase().indexOf(q) !== -1 ||
        p.id.toLowerCase().indexOf(q) !== -1 ||
        p.factors.join(' ').toLowerCase().indexOf(q) !== -1);
    }

    list.sort((a, b) => {
      const k = state.sort;
      if (k === 'name') return a.name.localeCompare(b.name, 'ru') * state.dir;
      if (k === 'date') return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * state.dir;
      return (a[k] - b[k]) * state.dir;
    });

    return list;
  }

  function renderPatients() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (state.page > pages) state.page = pages;

    const from = (state.page - 1) * PER_PAGE;
    const slice = list.slice(from, from + PER_PAGE);
    const body = $('#patientsBody');

    body.innerHTML = slice.length
      ? slice.map((p) => rowHTML(p, true)).join('')
      : '<tr><td colspan="7" class="empty-row">Ничего не найдено. Измените фильтр или запрос.</td></tr>';

    window.NdstIcons.renderIcons(body);
    applyI18n(body);

    $('#tableInfo').textContent = list.length
      ? T('Показано {a}–{b} из {n}',
          { a: from + 1, b: from + slice.length, n: list.length })
      : T('Нет записей');

    $('#patientsSub').textContent =
      T('Загружено {n} {word} · {m} на повторном контроле', {
        n: PATIENTS.length,
        word: plural(PATIENTS.length, ['записи', 'записей', 'записей']),
        m: PATIENTS.filter((p) => p.follow).length
      });

    // страницы
    let pagerHTML = '';
    for (let i = 1; i <= pages; i++) {
      pagerHTML += '<button type="button" data-page="' + i + '"' +
        (i === state.page ? ' class="is-active"' : '') + '>' + i + '</button>';
    }
    $('#pager').innerHTML = pages > 1 ? pagerHTML : '';
  }

  function renderCounts() {
    const counts = {
      all: PATIENTS.length,
      high: PATIENTS.filter((p) => levelOf(p.score).key === 'high').length,
      mod: PATIENTS.filter((p) => levelOf(p.score).key === 'mod').length,
      low: PATIENTS.filter((p) => levelOf(p.score).key === 'low').length,
      followup: PATIENTS.filter((p) => p.follow).length,
      dst: PATIENTS.filter((p) => p.dstDegree >= 1).length,
      nodst: PATIENTS.filter((p) => p.dstDegree === 0).length
    };
    $$('[data-count]').forEach((el) => { el.textContent = counts[el.dataset.count]; });
  }

  function renderRecent() {
    const recent = PATIENTS.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
    const body = $('#recentBody');
    body.innerHTML = recent.map((p) => rowHTML(p, false)).join('');
    window.NdstIcons.renderIcons(body);
    applyI18n(body);
  }

  /* ======================================================================
     Навигация между разделами
     ====================================================================== */

  /* У каждого раздела свой адрес: /doctor — сводка, остальные /doctor/<раздел>.
     Переход идёт через history, страница не перезагружается, но ссылку
     можно скопировать, открыть в новой вкладке и вернуться «назад». */

  const SECTION_PATH = {
    overview: '/doctor',
    assessments: '/doctor/assessments',
    risk: '/doctor/risk',
    stats: '/doctor/stats',
    knowledge: '/doctor/knowledge',
    settings: '/doctor/settings'
  };

  function viewFromPath(pathname) {
    const clean = pathname.replace(/\/+$/, '') || '/doctor';
    if (clean === '/doctor') return 'overview';
    const tail = clean.slice('/doctor/'.length);
    return SECTION_PATH[tail] ? tail : 'overview';
  }

  function updateTitle(view) {
    const link = document.querySelector('.side__link[data-view="' + view + '"]');
    let section = '';
    if (link) {
      // в пункте меню есть счётчик — в заголовок вкладки он не нужен
      const copy = link.cloneNode(true);
      copy.querySelectorAll('.count, svg').forEach((n) => n.remove());
      section = copy.textContent.replace(/\s+/g, ' ').trim();
    }
    document.title = section ? section + ' — NDST' : 'NDST';
  }

  function showView(name, options) {
    const opts = options || {};
    const views = $$('.view');
    const target = views.some((v) => v.dataset.view === name) ? name : 'overview';

    views.forEach((v) => v.classList.toggle('is-current', v.dataset.view === target));
    $$('.side__link').forEach((l) => l.classList.toggle('is-active', l.dataset.view === target));
    updateTitle(target);

    if (opts.push && location.pathname !== SECTION_PATH[target]) {
      history.pushState({ view: target }, '', SECTION_PATH[target]);
    }
    if (!opts.silent) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-view]');
    if (!link) return;
    // средняя кнопка и Ctrl/Cmd — пусть браузер откроет в новой вкладке
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    showView(link.dataset.view, { push: true });
  });

  window.addEventListener('popstate', () => {
    showView(viewFromPath(location.pathname), { silent: true });
  });

  /* ======================================================================
     Обработчики
     ====================================================================== */

  /* ======================================================================
     Данные с сервера
     ====================================================================== */

  function api(path, options) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, options || {}))
      .then((r) => {
        if (r.status === 401) {
          location.href = '/login?next=' + encodeURIComponent(location.pathname);
          throw new Error('unauthorized');
        }
        if (!r.ok) {
          return r.json().catch(() => null).then((body) => {
            const err = new Error(path + ' -> ' + r.status);
            err.detail = body && typeof body.detail === 'string' ? body.detail : null;
            throw err;
          });
        }
        return r.status === 204 ? null : r.json();
      });
  }

  function initials(text) {
    const parts = String(text).replace('.', '. ').split(/\s+/).filter(Boolean);
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function fillMe(me) {
    $('#meName').textContent = me.name;
    $('#meInitials').textContent = initials(me.name);
  }

  /** Линейный график по месяцам. Значения приходят из /api/clinic/stats,
      поэтому масштаб оси подбирается под данные, а не задан заранее. */
  function renderTrend(months) {
    const svg = $('#trendChart');
    if (!svg) return;
    const X0 = 44, X1 = 640, Y0 = 20, Y1 = 220;
    const data = months.length ? months : [{ ym: '', total: 0, high: 0 }];
    const peak = Math.max(4, ...data.map((m) => m.total));
    const step = Math.ceil(peak / 4);
    const top = step * 4;

    const px = (i) => data.length < 2 ? X0
      : X0 + i * (X1 - X0) / (data.length - 1);
    const py = (v) => Y1 - (v / top) * (Y1 - Y0);

    const line = (key) => data.map((m, i) =>
      (i ? 'L' : 'M') + px(i).toFixed(1) + ' ' + py(m[key]).toFixed(1)).join(' ');

    const grid = [0, 1, 2, 3, 4].map((i) => {
      const y = Y1 - i * (Y1 - Y0) / 4;
      return '<line x1="' + X0 + '" y1="' + y + '" x2="' + X1 + '" y2="' + y +
             '" stroke="#193149" stroke-width="1"/>' +
             '<text x="' + (X0 - 10) + '" y="' + (y + 4) + '" text-anchor="end" ' +
             'fill="#71869A" font-family="Inter, sans-serif" font-size="11">' +
             (step * i) + '</text>';
    }).join('');

    const labels = data.map((m, i) => {
      const mo = m.ym ? window.NdstI18n
        ? window.NdstI18n.months()[parseInt(m.ym.slice(5), 10) - 1]
        : m.ym.slice(5) : '';
      return '<text x="' + px(i).toFixed(1) + '" y="246" text-anchor="middle" ' +
             'fill="#71869A" font-family="Inter, sans-serif" font-size="11">' + mo + '</text>';
    }).join('');

    const dots = data.map((m, i) =>
      '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(m.total).toFixed(1) +
      '" r="4" fill="#0E2033" stroke="#19D3E6" stroke-width="2"/>').join('');

    svg.innerHTML =
      '<defs><linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#19D3E6" stop-opacity="0.25"/>' +
      '<stop offset="1" stop-color="#19D3E6" stop-opacity="0"/></linearGradient></defs>' +
      '<g class="c-y">' + grid + '</g>' +
      '<path d="' + line('total') + ' L' + px(data.length - 1).toFixed(1) + ' ' + Y1 +
      ' L' + px(0).toFixed(1) + ' ' + Y1 + ' Z" fill="url(#dashArea)"/>' +
      '<path d="' + line('total') + '" fill="none" stroke="#19D3E6" stroke-width="2.5" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="' + line('high') + '" fill="none" stroke="#EF4444" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>' +
      dots + '<g class="c-x">' + labels + '</g>';
  }

  /* ---- Период сводки и выгрузка ---------------------------------- */

  const PERIODS = [30, 90, 365];
  let periodDays = 30;

  function periodText(days) {
    return days === 365 ? T('Год') : T('{n} дней', { n: days });
  }

  function csvLink(extra) {
    const params = new URLSearchParams(extra || {});
    if (state.filter === 'high' || state.filter === 'mod' || state.filter === 'low') {
      params.set('level', state.filter);
    }
    if (state.filter === 'followup') params.set('follow_up', 'true');
    if (state.query) params.set('q', state.query);
    return '/api/clinic/export.csv?' + params.toString();
  }

  function fillStats(st) {
    const nf = (n) => n.toLocaleString('ru-RU').replace(/,/g, ' ');
    $('#statTotal').textContent = nf(st.total);
    $('#statMonth').textContent = nf(st.last_month);
    $('#statHigh').textContent = nf(st.by_level.high);
    $('#statFollow').textContent = nf(st.follow_up);
    $('#statHighNote').textContent = st.high_share + '% ' + T('от всех оценок');
    $('#cntAssessments').textContent = nf(st.total);
    renderTrend(st.months || []);
    renderCompare(st);
  }

  /* ======================================================================
     Анализ риска: риск диабета в группах по степени ДСТ
     ====================================================================== */

  function renderCompare(st) {
    const body = $('#compareBody');
    if (!body || !st.dst_groups) return;
    const pct = (n, total) => (total ? Math.round(n / total * 100) : 0);
    const avg = (g) => (g.avg_score === null ? '—' : g.avg_score + '%');

    const row = (label, g, cls) => {
      const bar = g.n
        ? '<div class="compare-bar">' + ['low', 'mod', 'high'].map((k) =>
            '<span style="width:' + (g[k] / g.n * 100).toFixed(1) + '%;background:' +
            LEVELS[k].color + '"></span>').join('') + '</div>'
        : '<span class="text-3 small">нет данных</span>';
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' +
        '<td><span>' + esc(label) + '</span></td>' +
        '<td>' + g.n + '</td>' +
        '<td>' + avg(g) + '</td>' +
        '<td>' + bar + '</td>' +
        '<td>' + (g.n ? pct(g.high, g.n) + '%' : '—') + '</td>' +
        '<td>' + g.doctor + '</td>' +
      '</tr>';
    };

    body.innerHTML = st.dst_groups.map((g) => row(DST_GROUP[g.degree], g, '')).join('') +
      row('Все дети с ДСТ (I–III степень)', st.dst_with, 'compare-row--total');
    applyI18n(body);

    const none = st.dst_groups[0];
    const withDst = st.dst_with;
    const examined = st.dst_groups.reduce((s, g) => s + g.doctor, 0);

    $('#cmpNoDst').textContent = none.n ? pct(none.high, none.n) + '%' : '—';
    $('#cmpNoDstNote').textContent = T('Оценок: {n} · средний риск {avg}', { n: none.n, avg: avg(none) });
    $('#cmpDst').textContent = withDst.n ? pct(withDst.high, withDst.n) + '%' : '—';
    $('#cmpDstNote').textContent = T('Оценок: {n} · средний риск {avg}', { n: withDst.n, avg: avg(withDst) });
    $('#cmpExamined').textContent = String(examined);
    $('#cmpExaminedNote').textContent = T('из {n} оценок', { n: st.total });
  }


  /* ======================================================================
     Настройки: профиль, код клиники и врачи
     Раньше код приглашения лежал только в файле, а врача заводили запросом
     к базе — теперь всё это делается администратором прямо в кабинете.
     ====================================================================== */

  const ROLE_NAME = { admin: 'Администратор', pediatrician: 'Педиатр' };
  let removeAsked = null;   // у какого врача уже нажали «убрать доступ»

  function loadSettings() {
    api('/api/admin/settings').then(renderSettings).catch(() => {});
  }

  function roleName(role) { return T(ROLE_NAME[role] || role); }

  function renderSettings(s) {
    $('#setName').textContent = s.me.name;
    $('#setEmail').textContent = s.me.email;
    $('#setRole').textContent = roleName(s.me.role);
    $('#meRole').textContent = roleName(s.me.role);

    $('#codePanel').hidden = !s.is_admin;
    $('#doctorsPanel').hidden = !s.is_admin;
    if (!s.is_admin) return;

    $('#clinicCode').textContent = s.clinic_code;
    $('#codeNew').hidden = s.code_from_env;
    if (s.code_from_env) {
      $('#codeNote').textContent =
        T('Код задан переменной окружения NDST_CLINIC_CODE — менять его нужно там.');
    }

    $('#doctorsNote').textContent = T('Всего врачей: {n}', { n: s.doctors.length });
    const admins = s.doctors.filter((d) => d.role === 'admin').length;
    $('#doctorsBody').innerHTML = s.doctors.map((d) => {
      const isMe = d.id === s.me.id;
      const isAdmin = d.role === 'admin';
      const lastAdmin = isAdmin && admins <= 1;
      return '<tr>' +
        '<td><span>' + esc(d.name) + '</span>' +
          (isMe ? ' <span class="text-3 small">' + T('это вы') + '</span>' : '') + '</td>' +
        '<td>' + esc(d.email) + '</td>' +
        '<td><span class="role-badge' + (isAdmin ? ' role-badge--admin' : '') + '">' +
          roleName(d.role) + '</span></td>' +
        '<td>' + fmtDate(d.created_at.slice(0, 10)) + '</td>' +
        '<td><div class="doctor-actions">' +
          (lastAdmin ? '' :
            '<button class="btn btn-ghost btn-sm" type="button" data-role="' + d.id +
            '" data-role-next="' + (isAdmin ? 'pediatrician' : 'admin') + '">' +
            (isAdmin ? T('Сделать педиатром') : T('Сделать администратором')) + '</button>') +
          (isMe ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-reset="' +
            d.id + '" data-name="' + esc(d.name) + '">' + T('Сбросить пароль') + '</button>') +
          (isMe || lastAdmin ? '' : '<button class="btn btn-ghost btn-sm" type="button" data-remove="' +
            d.id + '">' + T('Убрать доступ') + '</button>') +
          (lastAdmin && isMe ? '<span class="text-3 small">' +
            T('единственный администратор') + '</span>' : '') +
        '</div></td>' +
      '</tr>';
    }).join('');

    applyI18n($('section[data-view="settings"]'));
    window.NdstIcons.renderIcons($('section[data-view="settings"]'));
  }

  function jsonBody(method, body) {
    return { method: method, headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify(body) };
  }

  function settingsError(e) {
    if (e.message === 'unauthorized') return;
    showToast(T(e.detail || 'Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.'),
              'error');
  }

  function changePassword() {
    const current = $('#passCurrent').value;
    const fresh = $('#passNew').value;
    const box = $('#passError');
    box.hidden = true;

    if (current.length < 8 || fresh.length < 8) {
      box.textContent = T('Пароль не короче 8 символов.');
      box.hidden = false;
      return;
    }

    const button = $('#passSave');
    button.dataset.busy = '1';
    api('/api/admin/password', jsonBody('PATCH',
        { current_password: current, new_password: fresh }))
      .then(() => {
        $('#passCurrent').value = '';
        $('#passNew').value = '';
        showToast(T('Пароль изменён'));
      })
      .catch((e) => {
        if (e.message === 'unauthorized') return;
        box.textContent = T(e.detail || 'Не удалось сменить пароль.');
        box.hidden = false;
      })
      .then(() => { button.dataset.busy = ''; });
  }


  /* ======================================================================
     База знаний: веса берутся из тех же справочников, что считают оценку
     ====================================================================== */

  function renderKnowledge() {
    const M = window.NdstModel;
    const D = window.NdstDst;
    if (!M || !D || !$('#kbRisk')) return;

    const risk = [];
    const add = (group, label, points) => risk.push(
      '<tr><td><span>' + esc(group) + '</span></td><td><span>' + esc(label) +
      '</span></td><td>' + points + '</td></tr>');
    Object.keys(M.SYMPTOMS).forEach((k) => add('Симптом', M.SYMPTOMS[k].label, M.SYMPTOMS[k].w));
    Object.keys(M.DURATION).forEach((k) => {
      if (M.DURATION[k].w) add('Длительность', M.DURATION[k].label, M.DURATION[k].w);
    });
    Object.keys(M.RISKS).forEach((k) => add('Фактор риска', M.RISKS[k].label, M.RISKS[k].w));
    Object.keys(M.DIET).forEach((k) => {
      if (M.DIET[k].w) add('Питание', M.DIET[k].label, M.DIET[k].w);
    });
    Object.keys(M.CARBS).forEach((k) => {
      if (M.CARBS[k].w) add('Питание', M.CARBS[k].label, M.CARBS[k].w);
    });
    // ИМТ зависит от возраста — берём примеры у восьмилетнего мальчика
    [12, 19, 25].forEach((bmi) => {
      const c = M.classifyBMI(bmi, 8, 'm');
      if (c.w) add('Антропометрия', 'ИМТ: ' + c.label.toLowerCase(), c.w);
    });
    $('#kbRisk').innerHTML = risk.join('');

    const parentKeys = [].concat.apply([], D.PARENT_FORM.map((g) => g.keys));
    const inForm = (key) => (parentKeys.indexOf(key) !== -1 ? '<span>да</span>' : '—');
    const dst = Object.keys(D.PHENOTYPES)
      .sort((a, b) => D.PHENOTYPES[b].w - D.PHENOTYPES[a].w)
      .map((k) => '<tr><td><span>' + esc(D.PHENOTYPES[k].label) + '</span></td><td>' +
        D.PHENOTYPES[k].w + '</td><td>' + inForm(k) + '</td></tr>');
    Object.keys(D.COMPLEX).forEach((k) => dst.push(
      '<tr><td><span>' + esc(D.COMPLEX[k].label) + '</span></td><td>3 / 5</td><td>' +
      inForm(k) + '</td></tr>'));
    dst.push('<tr><td><span>' + esc(D.ARACH_LABEL) + '</span></td><td>3 / 5</td><td>—</td></tr>');
    Object.keys(D.ANOMALIES).forEach((k) => dst.push(
      '<tr><td><span>' + esc(D.ANOMALIES[k].label) + '</span> ' +
      '<span class="text-3 small">аномалия, в индекс не входит</span></td><td>—</td><td>' +
      inForm(k) + '</td></tr>'));
    $('#kbDst').innerHTML = dst.join('');

    applyI18n($('section[data-view="knowledge"]'));
  }

  /** Все оценки постранично: сервер отдаёт не больше 200 за раз, и прежняя
      загрузка одной страницей молча теряла всё, что старше. */
  function loadAllAssessments() {
    const size = 200;
    const all = [];
    const page = (offset) => api('/api/assessments?limit=' + size + '&offset=' + offset)
      .then((list) => {
        list.forEach((a) => all.push(a));
        return list.length === size ? page(offset + size) : all;
      });
    return page(0);
  }

  /* ======================================================================
     PDF-сводка отдельной оценки
     Файл готовит сервер по сохранённым ответам — тот же документ, что
     скачивает родитель, но с датой анкеты, меткой и осмотром врача.
     ====================================================================== */

  let toastTimer = null;

  function showToast(text, kind) {
    const toast = $('#toast');
    toast.textContent = text;
    toast.className = 'toast' + (kind === 'error' ? ' toast--error' : '');
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, kind === 'error' ? 6000 : 15000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    $('#toast').hidden = true;
  }

  function downloadPdf(button) {
    if (button.dataset.busy === '1') return;
    const id = button.dataset.pdf;
    const lang = window.NdstI18n ? window.NdstI18n.lang : 'ru';
    button.dataset.busy = '1';
    showToast(T('Готовим PDF…'));

    fetch('/api/assessments/' + encodeURIComponent(id) + '/pdf?lang=' + lang,
          { credentials: 'same-origin' })
      .then((r) => {
        if (r.status === 401) {
          location.href = '/login?next=/doctor';
          throw new Error('unauthorized');
        }
        if (!r.ok) throw new Error('pdf ' + r.status);
        // имя с меткой пациента приходит в filename* — оно может быть кириллицей
        const header = r.headers.get('Content-Disposition') || '';
        const utf = /filename\*=UTF-8''([^;]+)/i.exec(header);
        const plain = /filename="([^"]+)"/.exec(header);
        const name = utf ? decodeURIComponent(utf[1]) : plain ? plain[1] : 'NDST-' + id + '.pdf';
        return r.blob().then((blob) => ({ blob: blob, name: name }));
      })
      .then((file) => {
        const url = URL.createObjectURL(file.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        hideToast();
      })
      .catch((e) => {
        if (e.message === 'unauthorized') return;
        showToast(T('Не удалось подготовить PDF. Попробуйте ещё раз через минуту.'), 'error');
      })
      .then(() => { button.dataset.busy = ''; });
  }


  /* ======================================================================
     Карточка оценки: метка пациента и повторный контроль
     Ручки на сервере были с самого начала, а кнопок в кабинете не было —
     врач не мог ни подписать оценку, ни отметить контроль.
     ====================================================================== */

  let cardTarget = null;

  function openCard(id) {
    const p = PATIENTS.filter((x) => x.id === id)[0];
    if (!p) return;
    cardTarget = p;
    $('#cardCode').textContent = p.id;
    $('#cardDate').textContent = fmtDate(p.date);
    $('#cardLabel').value = p.raw.patient_label || '';
    $('#cardFollow').checked = Boolean(p.follow);
    $('#cardError').hidden = true;
    const dialog = $('#cardDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeCard() {
    const dialog = $('#cardDialog');
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    cardTarget = null;
  }

  function saveCard() {
    if (!cardTarget) return;
    const id = cardTarget.id;
    const label = $('#cardLabel').value.trim();
    const follow = $('#cardFollow').checked;
    const button = $('#cardSave');
    button.dataset.busy = '1';
    $('#cardError').hidden = true;

    const json = (body) => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(body) });

    api('/api/assessments/' + encodeURIComponent(id) + '/label',
        json({ patient_label: label || null }))
      .then(() => api('/api/assessments/' + encodeURIComponent(id) + '/follow-up',
                      json({ follow_up: follow })))
      .then((saved) => {
        const i = PATIENTS.findIndex((x) => x.id === saved.public_id);
        if (i !== -1) PATIENTS[i] = toRow(saved);
        renderCounts();
        renderRecent();
        renderPatients();
        closeCard();
        return api('/api/clinic/stats?days=' + periodDays)
          .then((st) => { lastStats = st; fillStats(st); });
      })
      .catch((e) => {
        if (e.message === 'unauthorized' || !cardTarget) return;
        $('#cardError').textContent =
          T('Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.');
        $('#cardError').hidden = false;
      })
      .then(() => { button.dataset.busy = ''; });
  }

  /* ======================================================================
     Статистика за период
     ====================================================================== */

  let reportDays = 30;

  function loadReport() {
    api('/api/clinic/report?days=' + reportDays).then(renderReport).catch(() => {});
  }

  function renderReport(rep) {
    const share = (n) => (rep.total ? Math.round(n / rep.total * 100) + '%' : '—');
    $('#repTotal').textContent = String(rep.total);
    $('#repAvg').textContent = rep.avg_score === null
      ? T('нет данных')
      : T('средний риск {avg}%', { avg: rep.avg_score });
    $('#repHigh').textContent = String(rep.levels.high || 0);
    $('#repHighNote').textContent = share(rep.levels.high || 0) + ' ' + T('от всех оценок');
    $('#repExams').textContent = String(rep.doctor_exams);
    $('#repExamsNote').textContent = T('из {n} оценок', { n: rep.total });
    $('#repFollow').textContent = String(rep.follow_up);
    $('#repFollowNote').textContent = T('требуют контроля');

    $('#repFactors').innerHTML = rep.top_factors.length
      ? rep.top_factors.map((f) =>
          '<tr><td><span>' + esc(f.label) + '</span></td><td>' + f.n + '</td><td>' +
          share(f.n) + '</td></tr>').join('')
      : '<tr><td colspan="3" class="empty-row">Нет данных за период.</td></tr>';

    $('#repDegrees').innerHTML = rep.degrees.map((n, degree) =>
      '<tr><td><span>' + esc(T(DST_GROUP[degree])) + '</span></td><td>' + n + '</td><td>' +
      share(n) + '</td></tr>').join('');

    applyI18n($('section[data-view="stats"]'));
  }

  /* ======================================================================
     Осмотр по полной шкале ДСТ
     Родитель отмечает короткий список, и степень по нему предварительная.
     Врач заполняет полный осмотр — он заменяет предварительную степень.
     ====================================================================== */

  const DST = window.NdstDst;
  let examTarget = null;   // строка таблицы, чей осмотр открыт

  function checkHTML(kind, key, item) {
    return '<label class="exam-check">' +
      '<input type="checkbox" data-kind="' + kind + '" value="' + key + '">' +
      '<span class="exam-check__box"></span>' +
      '<span class="exam-check__text">' + esc(item.label) + '</span>' +
      '<span class="exam-check__w">' + item.w + '</span>' +
    '</label>';
  }

  function segHTML(kind, key, options) {
    return '<div class="seg">' + options.map((o) =>
      '<label class="seg__opt">' +
        '<input type="radio" name="' + kind + '-' + key + '" data-kind="' + kind + '" ' +
          'data-key="' + key + '" value="' + o.value + '">' +
        '<span>' + esc(o.label) + '</span>' +
      '</label>').join('') + '</div>';
  }

  function buildExamForm() {
    $('#examPhenotypes').innerHTML = Object.keys(DST.PHENOTYPES)
      .map((k) => checkHTML('phenotype', k, DST.PHENOTYPES[k])).join('');
    $('#examAnomalies').innerHTML = Object.keys(DST.ANOMALIES)
      .map((k) => checkHTML('anomaly', k, DST.ANOMALIES[k])).join('');

    $('#examComplex').innerHTML = Object.keys(DST.COMPLEX).map((k) => {
      const c = DST.COMPLEX[k];
      return '<div class="exam-grade">' +
        '<div class="exam-grade__name">' + esc(c.label) + '</div>' +
        segHTML('complex', k, c.options.map((o) => ({ value: o.w, label: o.label }))) +
      '</div>';
    }).join('');

    const testOptions = [{ value: 0, label: 'Отрицательный' }, { value: 1, label: 'Положительный' }];
    $('#examTests').innerHTML = Object.keys(DST.TESTS).map((k) => {
      const t = DST.TESTS[k];
      return '<div class="exam-grade">' +
        '<div><div class="exam-grade__name">' + esc(t.label) + '</div>' +
        '<div class="exam-grade__hint">' + esc(t.hint) + '</div></div>' +
        segHTML('test', k, testOptions) +
      '</div>';
    }).join('');

    applyI18n($('#examDialog'));
  }

  function readExam() {
    const exam = DST.emptyExam();
    $$('#examDialog input[data-kind]').forEach((input) => {
      if (!input.checked) return;
      const kind = input.dataset.kind;
      if (kind === 'phenotype') exam.phenotypes.push(input.value);
      else if (kind === 'anomaly') exam.anomalies.push(input.value);
      else if (kind === 'complex') exam.complex[input.dataset.key] = Number(input.value);
      else if (kind === 'test') exam.tests[input.dataset.key] = input.value === '1';
    });
    return DST.normalize(exam);
  }

  function fillExam(raw) {
    const exam = DST.normalize(raw);
    $$('#examDialog input[data-kind]').forEach((input) => {
      const kind = input.dataset.kind;
      const key = input.dataset.key;
      if (kind === 'phenotype') input.checked = exam.phenotypes.indexOf(input.value) !== -1;
      else if (kind === 'anomaly') input.checked = exam.anomalies.indexOf(input.value) !== -1;
      else if (kind === 'complex') input.checked = exam.complex[key] === Number(input.value);
      else if (kind === 'test') input.checked = (exam.tests[key] ? '1' : '0') === input.value;
    });
  }

  function updateExamSummary() {
    const s = DST.calculate(readExam());
    $('#examIndex').textContent = String(s.index);
    $('#examChosen').textContent = String(s.chosen);
    $('#examHeavy').textContent = String(s.heavy);
    $('#examAnomalyCount').textContent = String(s.anomalies);
    $('#examBadge').className = 'badge badge--' + DST_BADGE[s.degree];
    $('#examBadgeText').textContent = T(s.degreeLabel);

    const aw = DST.arachScore(s.exam.tests);
    const grade = DST.ARACH.filter((a) => a.w === aw)[0];
    $('#examArach').innerHTML = esc(T('Итог по арахнодактилии:')) + ' <b>' +
      esc(T(grade.label)) + ' · ' + aw + '</b>';
  }

  function fillExamHeader(p) {
    $('#examWho').textContent = T(p.name);
    $('#examSource').textContent = p.dstSource === 'doctor'
      ? T('сохранён осмотр врача')
      : T('предварительно, по ответам родителя');
  }

  function openExam(id) {
    const p = PATIENTS.filter((x) => x.id === id)[0];
    if (!p) return;
    examTarget = p;
    fillExam(p.raw.dst_exam);
    fillExamHeader(p);
    $('#examReset').hidden = p.dstSource !== 'doctor';
    $('#examError').hidden = true;
    updateExamSummary();

    const dialog = $('#examDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    $('.exam__body', dialog).scrollTop = 0;
  }

  function closeExam() {
    const dialog = $('#examDialog');
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    examTarget = null;
  }

  function sendExam(method, exam) {
    if (!examTarget) return;
    const buttons = [$('#examSave'), $('#examReset')];
    buttons.forEach((b) => { b.dataset.busy = '1'; });
    $('#examError').hidden = true;

    const options = { method: method };
    if (exam) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(exam);
    }

    api('/api/assessments/' + encodeURIComponent(examTarget.id) + '/dst', options)
      .then((saved) => {
        const i = PATIENTS.findIndex((x) => x.id === saved.public_id);
        if (i !== -1) PATIENTS[i] = toRow(saved);
        renderCounts();
        renderRecent();
        renderPatients();
        closeExam();
        // группы сравнения считает сервер — после осмотра их надо обновить
        return api('/api/clinic/stats?days=' + periodDays)
          .then((st) => { lastStats = st; fillStats(st); });
      })
      .catch((e) => {
        if (e.message === 'unauthorized') return;
        if (!examTarget) return;   // осмотр сохранён, не обновилась только сводка
        $('#examError').textContent =
          T('Не удалось сохранить осмотр. Проверьте соединение и попробуйте ещё раз.');
        $('#examError').hidden = false;
      })
      .then(() => { buttons.forEach((b) => { b.dataset.busy = ''; }); });
  }

  /** Оценка с сервера -> строка таблицы. Имени ребёнка мы не храним,
      поэтому подписью служит метка врача или короткий код оценки. */
  function toRow(a) {
    return {
      id: a.public_id,
      name: a.patient_label || (T('Оценка') + ' ' + a.public_id.slice(0, 6)),
      age: a.age,
      score: a.score,
      date: a.created_at.slice(0, 10),
      follow: a.follow_up,
      blood: BLOOD[a.blood_group] || '',
      factors: (a.factors || []).slice(0, 3).map((f) => f.label),
      dst: a.dst_index || 0,
      dstDegree: a.dst_degree || 0,
      dstSource: a.dst_source || 'parent',
      raw: a
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    Promise.all([
      api('/api/auth/me'),
      api('/api/clinic/stats'),
      loadAllAssessments()
    ])
      .then(([me, stats, list]) => {
        fillMe(me);
        lastStats = stats;
        fillStats(stats);
        PATIENTS = list.map(toRow);

        renderCounts();
        renderDonut();
        renderRecent();
        renderPatients();
        // поддержка старых ссылок вида /doctor#patients
        const legacy = location.hash.slice(1);
        if (legacy && SECTION_PATH[legacy]) {
          history.replaceState(null, '', SECTION_PATH[legacy]);
        }
        showView(viewFromPath(location.pathname), { silent: true });
      })
      .catch((e) => {
        if (e.message !== 'unauthorized') {
          const note = $('#dataNote');
          if (note) note.textContent = T('Не удалось загрузить данные с сервера.');
        }
      });

    /* ---- Осмотр по шкале ДСТ ------------------------------------------- */

    buildExamForm();
    $('#examDialog').addEventListener('change', updateExamSummary);
    $('#examDialog').addEventListener('close', () => { examTarget = null; });
    $('#cardClose').addEventListener('click', closeCard);
    $('#cardCancel').addEventListener('click', closeCard);
    $('#cardSave').addEventListener('click', saveCard);
    $('#cardDialog').addEventListener('close', () => { cardTarget = null; });
    $('#cardExam').addEventListener('click', () => {
      const id = cardTarget && cardTarget.id;
      closeCard();
      if (id) openExam(id);
    });
    loadReport();
    loadSettings();
    renderKnowledge();

    $('#passSave').addEventListener('click', changePassword);

    $('#codeCopy').addEventListener('click', () => {
      const code = $('#clinicCode').textContent.trim();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code)
          .then(() => showToast(T('Код скопирован')))
          .catch(() => showToast(code));
      } else {
        showToast(code);
      }
    });

    $('#codeNew').addEventListener('click', () => {
      api('/api/admin/code', { method: 'POST' })
        .then((s) => { renderSettings(s); showToast(T('Новый код клиники создан')); })
        .catch(settingsError);
    });

    $('#examClose').addEventListener('click', closeExam);
    $('#examCancel').addEventListener('click', closeExam);
    $('#examSave').addEventListener('click', () => sendExam('PUT', readExam()));
    $('#examReset').addEventListener('click', () => sendExam('DELETE', null));
    document.addEventListener('click', (e) => {
      const button = e.target.closest('[data-exam]');
      if (button) openExam(button.dataset.exam);
      const pdfButton = e.target.closest('[data-pdf]');
      if (pdfButton) downloadPdf(pdfButton);
      const cardButton = e.target.closest('[data-card]');
      if (cardButton) openCard(cardButton.dataset.card);

      const roleButton = e.target.closest('[data-role]');
      if (roleButton) {
        api('/api/admin/doctors/' + roleButton.dataset.role,
            jsonBody('PATCH', { role: roleButton.dataset.roleNext }))
          .then(renderSettings).catch(settingsError);
      }

      const resetButton = e.target.closest('[data-reset]');
      if (resetButton) {
        api('/api/admin/doctors/' + resetButton.dataset.reset + '/password', { method: 'POST' })
          .then((res) => {
            $('#resetWho').textContent = resetButton.dataset.name;
            $('#resetPass').textContent = res.password;
            $('#resetBox').hidden = false;
          })
          .catch(settingsError);
      }

      // убираем доступ в два нажатия: подтверждения диалогом тут лишние
      const removeButton = e.target.closest('[data-remove]');
      if (removeButton) {
        const id = removeButton.dataset.remove;
        if (removeAsked !== id) {
          removeAsked = id;
          removeButton.textContent = T('Точно убрать?');
          setTimeout(() => {
            if (removeAsked === id) { removeAsked = null; loadSettings(); }
          }, 5000);
          return;
        }
        removeAsked = null;
        api('/api/admin/doctors/' + id, { method: 'DELETE' })
          .then((s) => { renderSettings(s); showToast(T('Доступ убран')); })
          .catch(settingsError);
      }
    });

    /* ---- Панель разделов на телефоне ---------------------------------- */

    const side = $('#sideNav');
    const scrim = $('#sideScrim');
    const sideToggle = $('#sideToggle');

    function setSide(open) {
      side.classList.toggle('is-open', open);
      scrim.hidden = !open;
      sideToggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    }

    sideToggle.addEventListener('click', () => setSide(!side.classList.contains('is-open')));
    scrim.addEventListener('click', () => setSide(false));
    // переход в раздел закрывает панель, иначе она перекроет открытый экран
    side.addEventListener('click', (e) => { if (e.target.closest('a')) setSide(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSide(false); });
    window.addEventListener('resize', () => { if (window.innerWidth > 900) setSide(false); });

    [$('#logoutBtn'), $('#logoutBtnMobile')].forEach((btn) => btn.addEventListener('click', () => {
      api('/api/auth/logout', { method: 'POST' })
        .then(() => { location.href = '/'; })
        .catch(() => { location.href = '/'; });
    }));


    $('#bellLink').addEventListener('click', () => {
      state.filter = 'followup';
      state.page = 1;
      $$('.chip', $('#filters')).forEach((c) =>
        c.classList.toggle('is-active', c.dataset.filter === 'followup'));
      renderPatients();
    });

    $('#periodBtn').addEventListener('click', () => {
      periodDays = PERIODS[(PERIODS.indexOf(periodDays) + 1) % PERIODS.length];
      $('#periodLabel').textContent = periodText(periodDays);
      $('#statMonthLabel').textContent = T('За последние {n} дней', { n: periodDays });
      api('/api/clinic/stats?days=' + periodDays)
        .then((st) => { lastStats = st; fillStats(st); })
        .catch(() => {});
    });

    $('#exportOverview').addEventListener('click', () => {
      location.href = '/api/clinic/export.csv?days=' + periodDays;
    });
    $('#exportTable').addEventListener('click', () => { location.href = csvLink(); });
    $('#exportReport').addEventListener('click', () => {
      location.href = '/api/clinic/export.csv?days=' + reportDays;
    });

    $('#reportPeriod').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      $$('.chip', $('#reportPeriod')).forEach((c) => c.classList.toggle('is-active', c === chip));
      reportDays = Number(chip.dataset.days);
      loadReport();
    });

    $('#searchInput').addEventListener('input', (e) => {
      state.query = e.target.value.trim();
      state.page = 1;
      renderPatients();
      if (state.query && viewFromPath(location.pathname) !== 'assessments') {
        showView('assessments', { push: true, silent: true });
      }
    });

    $('#filters').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      $$('.chip', $('#filters')).forEach((c) => c.classList.toggle('is-active', c === chip));
      state.filter = chip.dataset.filter;
      state.page = 1;
      renderPatients();
    });

    $$('.table th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sort === key) state.dir *= -1;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        renderPatients();
      });
    });

    document.addEventListener('dia:langchange', () => {
      renderKnowledge();
      if (lastStats) {
        renderTrend(lastStats.months || []);
        renderCompare(lastStats);
      }
      // открытый осмотр только переводим: отмеченное, но не сохранённое не сбрасываем
      applyI18n($('#examDialog'));
      if (examTarget) {
        fillExamHeader(examTarget);
        updateExamSummary();
      }
      updateTitle(viewFromPath(location.pathname));
      renderCounts();
      renderDonut();
      renderRecent();
      renderPatients();
    });

    $('#pager').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-page]');
      if (!btn) return;
      state.page = Number(btn.dataset.page);
      renderPatients();
    });
  });
})();
