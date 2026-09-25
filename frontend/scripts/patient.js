/* ==========================================================================
   NDST — кабинет пациента

   Показывает историю оценок ребёнка, её динамику и рекомендации.
   Все данные приходят с сервера и принадлежат вошедшему родителю:
   /api/patient/* отдаёт только его записи.
   ========================================================================== */

(function () {
  'use strict';

  var T = function (ru, vars) {
    return window.NdstI18n ? window.NdstI18n.t(ru, vars) : ru;
  };
  var applyI18n = function (el) {
    if (window.NdstI18n) window.NdstI18n.apply(el);
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const LEVELS = {
    low:  { key: 'low',  label: 'Низкий',    color: '#22C55E' },
    mod:  { key: 'mod',  label: 'Умеренный', color: '#F59E0B' },
    high: { key: 'high', label: 'Высокий',   color: '#EF4444' }
  };

  // Пороги те же, что в модели: 25 и 60. Здесь они нужны только для
  // разметки шкалы, балл и уровень считает сервер.
  const T_MOD = 25;
  const T_HIGH = 60;

  // Значения, которые анкета собирает, но в балл не включает. Без них
  // группа крови и характер питания нигде бы не показывались.
  const BLOOD = {
    O: 'Группа крови O (I)', A: 'Группа крови A (II)',
    B: 'Группа крови B (III)', AB: 'Группа крови AB (IV)'
  };
  const DIET = {
    balanced: 'Питание в целом сбалансированное',
    irregular: 'Нерегулярное питание, пропуски приёмов пищи',
    sweets: 'Много сладостей и выпечки каждый день',
    fastfood: 'Преобладают фастфуд и готовые продукты'
  };

  const state = {
    me: null,
    children: [],
    items: [],        // все оценки родителя, свежие первыми
    child: 'all'      // 'all' | 'none' | id ребёнка
  };

  /* ======================================================================
     Утилиты
     ====================================================================== */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function plural(n, forms) {
    if (window.NdstI18n) return window.NdstI18n.plural(n, forms);
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function months() {
    return window.NdstI18n ? window.NdstI18n.months()
      : ['янв', 'фев', 'мар', 'апр', 'мая', 'июн',
         'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  }

  /** Дата анкеты. Год добавляем, только если он не текущий: в истории
      за один год он повторялся бы в каждой строке без пользы. */
  function fmtDate(iso) {
    const d = new Date(iso.slice(0, 10) + 'T00:00:00');
    const out = d.getDate() + ' ' + months()[d.getMonth()];
    return d.getFullYear() === new Date().getFullYear()
      ? out : out + ' ' + d.getFullYear();
  }

  function levelOf(a) { return LEVELS[a.level] || LEVELS.low; }

  function initials(text) {
    const parts = String(text).replace('.', '. ').split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function childName(a) {
    return a.child_name || T('Без профиля');
  }

  /** Оценки с учётом выбора в верхней полосе. */
  function visible() {
    if (state.child === 'all') return state.items;
    if (state.child === 'none') return state.items.filter((a) => !a.child_id);
    return state.items.filter((a) => String(a.child_id) === String(state.child));
  }

  /* ======================================================================
     Обмен с сервером
     ====================================================================== */

  function api(path, options) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, options || {}))
      .then((r) => {
        if (r.status === 401) {
          location.href = '/patient/login?next=' + encodeURIComponent(location.pathname);
          throw new Error('unauthorized');
        }
        return r.json().catch(() => null).then((body) => {
          if (!r.ok) {
            const err = new Error(path + ' -> ' + r.status);
            err.detail = body && typeof body.detail === 'string' ? body.detail : null;
            throw err;
          }
          return body;
        });
      });
  }

  function send(path, method, body) {
    return api(path, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  /* ======================================================================
     Адреса разделов
     ====================================================================== */

  const SECTION_PATH = {
    overview: '/patient',
    history: '/patient/history',
    children: '/patient/children',
    recommendations: '/patient/recommendations'
  };

  function viewFromPath(pathname) {
    const found = Object.keys(SECTION_PATH)
      .find((k) => SECTION_PATH[k] === pathname.replace(/\/+$/, ''));
    return found || 'overview';
  }

  function updateTitle(view) {
    const link = $('.side__link[data-view="' + view + '"]');
    if (!link) return;
    const copy = link.cloneNode(true);
    $$('.count, svg', copy).forEach((n) => n.remove());
    const section = copy.textContent.trim();
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
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    showView(link.dataset.view, { push: true });
  });

  window.addEventListener('popstate', () => {
    showView(viewFromPath(location.pathname), { silent: true });
  });

  /* ======================================================================
     Сводка
     ====================================================================== */

  /** Предыдущая анкета того же ребёнка. Сравнивать балл с анкетой другого
      ребёнка бессмысленно, поэтому «изменение» всегда считается внутри
      одного профиля — даже когда показаны все дети. */
  function previousFor(a) {
    const list = visible();
    return list.slice(list.indexOf(a) + 1)
      .find((x) => String(x.child_id) === String(a.child_id)) || null;
  }

  function fillTiles() {
    const list = visible();
    const last = list[0] || null;
    const prev = last ? previousFor(last) : null;

    $('#lastScore').textContent = last ? last.score + '%' : '—';
    $('#lastLevel').textContent = last ? T(levelOf(last).label) + ' ' + T('риск') : T('анкет пока нет');
    $('#lastScore').className = 'tile__value' + (last ? ' is-' + last.level : '');

    const delta = $('#deltaValue');
    const note = $('#deltaNote');
    if (last && prev) {
      const d = last.score - prev.score;
      delta.textContent = (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d);
      // рост риска — плохо, поэтому знак и цвет здесь противоположны привычным
      delta.className = 'tile__value ' + (d > 0 ? 'is-high' : d < 0 ? 'is-low' : '');
      note.textContent = T('по сравнению с прошлой анкетой');
    } else {
      delta.textContent = '—';
      delta.className = 'tile__value';
      note.textContent = T('нужны хотя бы две анкеты одного ребёнка');
    }

    $('#totalValue').textContent = list.length;
    $('#totalNote').textContent = plural(list.length, ['оценка', 'оценки', 'оценок']) +
      ' ' + T('в кабинете');

    const follow = list.filter((a) => a.follow_up).length;
    $('#followValue').textContent = follow;
    $('#followNote').textContent = follow
      ? T('врач отметил повторный контроль')
      : T('повторный контроль не назначен');
  }

  // Цвета линий по детям. Уровень риска показывают точки, поэтому линии
  // отвечают только за то, чью историю мы видим.
  const SERIES_COLORS = ['#19D3E6', '#3B82F6', '#A78BFA', '#F59E0B'];

  /** Динамика балла по датам анкет. Шкала всегда 0–100: так видно не только
      направление, но и насколько результат близок к порогам модели.
      Оценки разных детей идут отдельными линиями — одна ломаная через них
      читалась бы как история одного ребёнка и вводила бы в заблуждение. */
  function renderTrend() {
    const svg = $('#trendChart');
    const legend = $('#trendLegend');
    const list = visible().slice().reverse();     // по возрастанию даты
    $('#trendEmpty').hidden = list.length > 0;
    legend.innerHTML = '';

    if (!list.length) { svg.innerHTML = ''; return; }

    // группируем по ребёнку, сохраняя порядок появления
    const groups = [];
    list.forEach((a) => {
      const key = a.child_id === null || a.child_id === undefined ? 'none' : String(a.child_id);
      let g = groups.find((x) => x.key === key);
      if (!g) { groups.push(g = { key: key, name: childName(a), items: [] }); }
      g.items.push(a);
    });

    const X0 = 44, X1 = 640, Y0 = 20, Y1 = 230;
    // общая ось времени: точка встаёт по своему месту среди всех дат
    const px = (a) => list.length < 2 ? (X0 + X1) / 2
      : X0 + list.indexOf(a) * (X1 - X0) / (list.length - 1);
    const py = (v) => Y1 - (v / 100) * (Y1 - Y0);

    const grid = [0, 25, 50, 75, 100].map((v) => {
      const y = py(v);
      return '<line x1="' + X0 + '" y1="' + y.toFixed(1) + '" x2="' + X1 + '" y2="' + y.toFixed(1) +
             '" stroke="#193149" stroke-width="1"/>' +
             '<text x="' + (X0 - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" ' +
             'fill="#71869A" font-family="Inter, sans-serif" font-size="11">' + v + '</text>';
    }).join('');

    // пороги уровней — пунктиром, чтобы не спорить с линиями данных
    const marks = [[T_MOD, LEVELS.mod.color], [T_HIGH, LEVELS.high.color]].map(([v, c]) =>
      '<line x1="' + X0 + '" y1="' + py(v).toFixed(1) + '" x2="' + X1 + '" y2="' + py(v).toFixed(1) +
      '" stroke="' + c + '" stroke-width="1" stroke-dasharray="4 5" opacity="0.5"/>').join('');

    const lines = groups.map((g, gi) => {
      const color = SERIES_COLORS[gi % SERIES_COLORS.length];
      g.color = color;
      if (g.items.length < 2) return '';
      const d = g.items.map((a, i) =>
        (i ? 'L' : 'M') + px(a).toFixed(1) + ' ' + py(a.score).toFixed(1)).join(' ');
      return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2.5" ' +
             'stroke-linecap="round" stroke-linejoin="round"/>';
    }).join('');

    const dots = list.map((a) =>
      '<circle cx="' + px(a).toFixed(1) + '" cy="' + py(a.score).toFixed(1) +
      '" r="5" fill="#0E2033" stroke="' + levelOf(a).color + '" stroke-width="2.5"/>').join('');

    // подписи дат прореживаем, иначе на узком экране они наезжают
    const step = Math.ceil(list.length / 7);
    const labels = list.map((a, i) => (i % step ? '' :
      '<text x="' + px(a).toFixed(1) + '" y="256" text-anchor="middle" ' +
      'fill="#71869A" font-family="Inter, sans-serif" font-size="11">' +
      esc(fmtDate(a.created_at)) + '</text>')).join('');

    svg.innerHTML = '<g>' + grid + '</g>' + marks + lines + dots +
                    '<g class="c-x">' + labels + '</g>';

    if (groups.length > 1) {
      legend.innerHTML = groups.map((g) =>
        '<span class="trend-legend__item">' +
          '<i style="background:' + g.color + '"></i>' + esc(g.name) +
        '</span>').join('');
    }
  }

  /** Шкала последней оценки: три зоны модели и метка текущего балла. */
  function renderGauge() {
    const box = $('#gauge');
    const last = visible()[0];
    if (!last) {
      box.innerHTML = '<p class="text-3 small">' + T('Пройдите анкету, чтобы увидеть результат.') + '</p>';
      $('#lastWhen').textContent = '—';
      return;
    }

    $('#lastWhen').textContent = fmtDate(last.created_at) + ' · ' + childName(last);

    const lv = levelOf(last);
    box.innerHTML =
      '<div class="gauge__value" style="color:' + lv.color + '">' + last.score + '%</div>' +
      '<div class="gauge__level">' + T(lv.label) + ' ' + T('риск') + '</div>' +
      '<div class="gauge__bar">' +
        '<span class="gauge__zone" style="flex:' + T_MOD + ';background:' + LEVELS.low.color + '"></span>' +
        '<span class="gauge__zone" style="flex:' + (T_HIGH - T_MOD) + ';background:' + LEVELS.mod.color + '"></span>' +
        '<span class="gauge__zone" style="flex:' + (100 - T_HIGH) + ';background:' + LEVELS.high.color + '"></span>' +
        '<span class="gauge__pin" style="left:' + last.score + '%"></span>' +
      '</div>' +
      '<div class="gauge__scale"><span>0</span><span>' + T_MOD + '</span>' +
        '<span>' + T_HIGH + '</span><span>100</span></div>';
    applyI18n(box);
  }

  function renderFactors() {
    const box = $('#lastFactors');
    const last = visible()[0];
    const found = last ? (last.factors || []) : [];

    if (!found.length) {
      box.innerHTML = '<p class="text-3 small">' +
        (last ? T('Значимых факторов не отмечено.') : '') + '</p>';
      return;
    }

    box.innerHTML = '<div class="factors__title">' + T('Что повлияло на результат') + '</div>' +
      found.slice(0, 6).map((f) =>
        '<div class="factors__row">' +
          '<span class="factors__label">' + esc(T(f.label)) + '</span>' +
          '<span class="factors__group">' + esc(T(f.group)) + '</span>' +
        '</div>').join('') + referenceHTML(last);
    applyI18n(box);
  }

  /** Данные анкеты, не входящие в балл: показываем отдельной строкой,
      чтобы было видно, что они собраны и не потерялись. */
  function referenceHTML(a) {
    if (!a) return '';
    const items = [];
    if (BLOOD[a.blood_group]) items.push(T(BLOOD[a.blood_group]));
    if (DIET[a.diet]) items.push(T(DIET[a.diet]));
    if (!items.length) return '';
    return '<p class="factors__ref">' + T('Справочно, на балл не влияет:') +
           ' ' + esc(items.join(' · ')) + '</p>';
  }

  /* ---- Ближайший шаг и рекомендации ------------------------------------ */

  // Что делать при каждом уровне. Тексты намеренно про действие родителя,
  // а не про диагноз: модель оценивает факторы риска, а не ставит его.
  const PLAN = {
    high: {
      title: 'Запишитесь к врачу в ближайшие дни',
      body: 'Результат показывает заметное сочетание факторов. Обратитесь к педиатру или ' +
            'детскому эндокринологу и покажите эту сводку — по ней врач поймёт, что именно ' +
            'вы отметили.',
      repeat: 'Повторите анкету после приёма или если появятся новые симптомы.'
    },
    mod: {
      title: 'Обсудите результат на ближайшем приёме',
      body: 'Срочности нет, но факторы стоит проговорить с педиатром — он решит, нужны ли ' +
            'анализы. Если симптомы усилятся, не ждите планового приёма.',
      repeat: 'Повторите анкету через 1–3 месяца или раньше при изменениях.'
    },
    low: {
      title: 'Достаточно планового наблюдения',
      body: 'Значимых сочетаний факторов сейчас не видно. Отдельно отметьте появление жажды, ' +
            'учащённого мочеиспускания и потери веса — это ключевая тройка признаков.',
      repeat: 'Повторите анкету через 6 месяцев или при первых симптомах.'
    }
  };

  // Советы даём только по тем факторам, на которые семья действительно
  // может повлиять. По остальным пунктам решение принимает врач.
  const CHANGEABLE = {
    lowActivity: 'Добавьте ребёнку регулярную нагрузку: подойдёт час активных игр или прогулки в день.',
    sugarDrinks: 'Замените сладкие напитки водой — это самая простая из перемен и заметная по эффекту.',
    'bmi:over': 'Обсудите с педиатром питание и вес: снижение даже небольшой части лишнего веса улучшает чувствительность к инсулину.',
    'bmi:obese': 'Попросите педиатра составить план по весу — самостоятельные диеты детям не подходят.'
  };

  // Степени шкалы ДСТ — те же, что в анкете и у врача (scripts/dst.js)
  const DST_DEGREE = {
    0: 'Недостаточно фенотипических признаков',
    1: 'I степень',
    2: 'II степень',
    3: 'III степень'
  };

  function planFor(a) { return PLAN[a.level] || PLAN.low; }

  function renderNextStep() {
    const box = $('#nextStep');
    const last = visible()[0];
    if (!last) {
      box.innerHTML = '<p class="text-3">' +
        T('Пройдите анкету — после неё здесь появится понятный следующий шаг.') +
        '</p><a class="btn btn-primary mt-4" href="/assessment">' +
        T('Пройти анкету') + '</a>';
      applyI18n(box);
      return;
    }
    const plan = planFor(last);
    const lv = levelOf(last);
    box.innerHTML =
      '<div class="next-step__mark" style="background:' + lv.color + '"></div>' +
      '<div><h3>' + T(plan.title) + '</h3><p>' + T(plan.body) + '</p></div>';
    applyI18n(box);
  }

  function renderRecommendations() {
    const box = $('#recBody');
    const last = visible()[0];

    if (!last) {
      box.innerHTML = '<div class="panel"><div class="panel__body"><p class="text-3">' +
        T('Рекомендации появятся после первой пройденной анкеты.') + '</p></div></div>';
      applyI18n(box);
      return;
    }

    const plan = planFor(last);
    const lv = levelOf(last);
    const found = last.factors || [];

    $('#recSub').textContent = T('По анкете от {date}', { date: fmtDate(last.created_at) }) +
      ' · ' + childName(last);

    const tips = found
      .map((f) => CHANGEABLE[f.key])
      .filter(Boolean);

    // Дисплазия — тема, ради которой проект и сделан. Её степень считает шкала
    // ДСТ отдельно от риска диабета; если степень набирается, об этом нужно
    // сказать прямо, а не прятать в общем списке.
    const dstDegree = last.dst_degree || 0;
    const byDoctor = last.dst_source === 'doctor';
    const dysNote = dstDegree >= 1
      ? (byDoctor
          ? 'Врач оценил признаки дисплазии соединительной ткани по шкале ДСТ. Это не ' +
            'болезнь сама по себе, но повод наблюдаться у педиатра вместе с ортопедом ' +
            'и кардиологом и не пропускать обследование углеводного обмена.'
          : 'По ответам анкеты набирается степень дисплазии соединительной ткани. ' +
            'Попросите педиатра провести осмотр по полной шкале ДСТ: на этом фоне ' +
            'нарушения обмена имеет смысл искать раньше.')
      : null;

    const talk = found.length
      ? found.map((f) =>
          '<li><span class="rec__factor">' + esc(T(f.label)) + '</span>' +
          '<span class="rec__group">' + esc(T(f.group)) + '</span></li>').join('')
      : '<li>' + T('Значимых факторов не отмечено — расскажите врачу об общем самочувствии ребёнка.') + '</li>';

    box.innerHTML =
      '<div class="panel"><div class="panel__body">' +
        '<div class="rec__head">' +
          '<span class="badge badge--' + lv.key + '"><span class="dot"></span>' +
            T(lv.label) + ' ' + T('риск') + '</span>' +
          '<span class="rec__score">' + last.score + '%</span>' +
        '</div>' +
        '<h2 class="rec__title">' + T(plan.title) + '</h2>' +
        '<p class="rec__body">' + T(plan.body) + '</p>' +
      '</div></div>' +

      '<div class="panel"><div class="panel__head"><div>' +
        '<h2>' + T('О чём рассказать врачу') + '</h2>' +
        '<p>' + T('Пункты, которые повлияли на результат') + '</p>' +
      '</div></div><div class="panel__body">' +
        '<ul class="rec__list">' + talk + '</ul>' +
      '</div></div>' +

      (dysNote
        ? '<div class="panel"><div class="panel__head"><div>' +
            '<h2>' + T('Соединительная ткань') + '</h2>' +
            '<p>' + esc(T(DST_DEGREE[dstDegree])) + ' · ' +
              esc(T('индекс {n}', { n: last.dst_index || 0 })) + ' · ' +
              esc(T(byDoctor ? 'осмотр врача' : 'предварительно, по ответам анкеты')) + '</p>' +
          '</div></div><div class="panel__body">' +
            '<p class="rec__body">' + T(dysNote) + '</p>' +
          '</div></div>'
        : '') +

      (tips.length
        ? '<div class="panel"><div class="panel__head"><div>' +
            '<h2>' + T('Что можно изменить самим') + '</h2>' +
            '<p>' + T('Только то, что зависит от семьи, а не от назначений') + '</p>' +
          '</div></div><div class="panel__body">' +
            '<ul class="rec__list rec__list--tips">' +
              tips.map((t) => '<li>' + T(t) + '</li>').join('') +
            '</ul>' +
          '</div></div>'
        : '') +

      '<div class="panel"><div class="panel__body">' +
        '<div class="rec__repeat"><i data-icon="calendar"></i><span>' +
          T(plan.repeat) + '</span></div>' +
      '</div></div>';

    if (window.NdstIcons) window.NdstIcons.renderIcons(box);
    applyI18n(box);
  }

  /* ======================================================================
     История
     ====================================================================== */

  function renderHistory() {
    const list = visible();
    const body = $('#historyBody');

    $('#historySub').textContent = list.length
      ? list.length + ' ' + plural(list.length, ['оценка', 'оценки', 'оценок'])
      : T('пока пусто');

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty-row">' +
        T('Здесь появятся пройденные анкеты. Уже есть код — привяжите его формой выше.') +
        '</td></tr>';
      applyI18n(body);
      return;
    }

    body.innerHTML = list.map((a) => {
      const lv = levelOf(a);
      const tags = (a.factors || []).length
        ? a.factors.slice(0, 3).map((f) => '<span class="pill">' + esc(T(f.label)) + '</span>').join(' ')
        : '<span class="text-3 small">' + T('не отмечены') + '</span>';

      return '<tr>' +
        '<td>' + esc(fmtDate(a.created_at)) + '<br>' +
          '<span class="patient__id">' + esc(a.public_id) + '</span></td>' +
        '<td>' + esc(childName(a)) + '</td>' +
        '<td>' + a.age + ' ' + plural(a.age, ['год', 'года', 'лет']) + '</td>' +
        '<td><div class="risk-cell">' +
          '<span class="risk-cell__score ' + lv.key + '">' + a.score + '%</span>' +
          '<span class="badge badge--' + lv.key + '"><span class="dot"></span>' + T(lv.label) + '</span>' +
        '</div></td>' +
        '<td><div class="row row-wrap" style="gap:6px">' + tags + '</div></td>' +
        '<td>' + (a.follow_up
          ? '<span class="status wait"><i data-icon="bell"></i>' + T('Нужен контроль') + '</span>'
          : '<span class="text-3 small">—</span>') + '</td>' +
      '</tr>';
    }).join('');

    if (window.NdstIcons) window.NdstIcons.renderIcons(body);
    applyI18n(body);
  }

  /* ======================================================================
     Дети
     ====================================================================== */

  function ageOf(kid) {
    if (!kid.birth_year) return null;
    return new Date().getFullYear() - kid.birth_year;
  }

  function renderChildren() {
    const grid = $('#kidGrid');

    if (!state.children.length) {
      grid.innerHTML = '<div class="panel"><div class="stub">' +
        '<i data-icon="users"></i><h2>' + T('Профилей пока нет') + '</h2>' +
        '<p>' + T('Добавьте ребёнка, чтобы история оценок не смешивалась. ' +
                  'Без профиля оценки тоже сохраняются.') + '</p>' +
        '</div></div>';
      if (window.NdstIcons) window.NdstIcons.renderIcons(grid);
      applyI18n(grid);
      return;
    }

    grid.innerHTML = state.children.map((k) => {
      const age = ageOf(k);
      const lv = k.last_level ? LEVELS[k.last_level] : null;
      return '<div class="kid">' +
        '<div class="kid__top">' +
          '<span class="kid__av">' + esc(initials(k.name)) + '</span>' +
          '<div class="kid__id">' +
            '<div class="kid__name">' + esc(k.name) + '</div>' +
            '<div class="kid__meta">' +
              (age !== null ? age + ' ' + plural(age, ['год', 'года', 'лет']) : T('возраст не указан')) +
              (k.sex ? ' · ' + T(k.sex === 'm' ? 'Мальчик' : 'Девочка') : '') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="kid__stats">' +
          '<div><span class="kid__num">' + k.assessments + '</span>' +
            '<span class="kid__cap">' + plural(k.assessments, ['оценка', 'оценки', 'оценок']) + '</span></div>' +
          '<div><span class="kid__num" ' + (lv ? 'style="color:' + lv.color + '"' : '') + '>' +
            (k.last_score === null ? '—' : k.last_score + '%') + '</span>' +
            '<span class="kid__cap">' + T('последний балл') + '</span></div>' +
        '</div>' +
        '<div class="kid__actions">' +
          '<button class="btn btn-secondary btn-sm" type="button" data-edit="' + k.id + '">' +
            '<i data-icon="sliders"></i> ' + T('Изменить') + '</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-del="' + k.id + '">' +
            T('Удалить') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    if (window.NdstIcons) window.NdstIcons.renderIcons(grid);
    applyI18n(grid);
  }

  /** Списки выбора ребёнка: в верхней полосе и в форме привязки кода. */
  function fillChildSelects() {
    const pick = $('#childPick');
    const link = $('#linkChild');
    const keep = state.child;

    const options = state.children.map((k) =>
      '<option value="' + k.id + '">' + esc(k.name) + '</option>').join('');

    pick.innerHTML = '<option value="all">' + T('Все дети') + '</option>' + options +
      (state.items.some((a) => !a.child_id)
        ? '<option value="none">' + T('Без профиля') + '</option>' : '');
    pick.value = $$('option', pick).some((o) => o.value === keep) ? keep : 'all';
    state.child = pick.value;

    link.innerHTML = '<option value="">' + T('Без привязки к ребёнку') + '</option>' + options;

    $('#cntChildren').textContent = state.children.length;
  }

  /* ======================================================================
     Перерисовка
     ====================================================================== */

  function renderAll() {
    $('#cntHistory').textContent = visible().length;
    fillTiles();
    renderTrend();
    renderGauge();
    renderFactors();
    renderNextStep();
    renderHistory();
    renderChildren();
    renderRecommendations();
  }

  function reload() {
    return Promise.all([
      api('/api/patient/children'),
      api('/api/patient/assessments')
    ]).then(([kids, items]) => {
      state.children = kids;
      state.items = items;
      fillChildSelects();
      renderAll();
    });
  }

  /* ======================================================================
     Запуск
     ====================================================================== */

  document.addEventListener('DOMContentLoaded', () => {
    api('/api/patient/me')
      .then((me) => {
        state.me = me;
        $('#meName').textContent = me.name;
        $('#meInitials').textContent = initials(me.name);
        return reload();
      })
      .then(() => {
        showView(viewFromPath(location.pathname), { silent: true });
      })
      .catch((e) => {
        if (e.message === 'unauthorized') return;
        const note = $('#dataNote');
        if (note) note.textContent = T('Не удалось загрузить данные с сервера.');
      });

    /* ---- Выбор ребёнка ------------------------------------------------ */

    $('#childPick').addEventListener('change', (e) => {
      state.child = e.target.value;
      renderAll();
    });

    /* ---- Привязка оценки по коду -------------------------------------- */

    const linkForm = $('#linkForm');
    const linkError = $('#linkError');
    const linkOk = $('#linkOk');

    linkForm.addEventListener('submit', (e) => {
      e.preventDefault();
      linkError.hidden = true;
      linkOk.hidden = true;

      const code = $('#linkCode').value.trim();
      if (code.length < 4) {
        linkError.textContent = T('Введите код с экрана результата.');
        linkError.hidden = false;
        return;
      }

      const childId = $('#linkChild').value;
      $('#linkBtn').dataset.busy = '1';

      send('/api/patient/assessments/link', 'POST', {
        code: code,
        child_id: childId ? Number(childId) : null
      })
        .then(() => {
          $('#linkCode').value = '';
          linkOk.hidden = false;
          return reload();
        })
        .catch((err) => {
          if (err.message === 'unauthorized') return;
          linkError.textContent = T(err.detail || 'Не удалось привязать оценку.');
          linkError.hidden = false;
        })
        .then(() => { $('#linkBtn').dataset.busy = ''; });
    });

    /* ---- Профили детей ------------------------------------------------ */

    const childForm = $('#childForm');
    const childError = $('#childError');

    function resetChildForm() {
      childForm.reset();
      $('#childId').value = '';
      $('#childFormTitle').textContent = T('Добавить ребёнка');
      $('#childSaveLabel').textContent = T('Добавить');
      $('#childCancel').hidden = true;
      childError.hidden = true;
    }

    childForm.addEventListener('submit', (e) => {
      e.preventDefault();
      childError.hidden = true;

      const name = $('#childName').value.trim();
      if (!name) {
        childError.textContent = T('Укажите имя ребёнка.');
        childError.hidden = false;
        return;
      }

      const year = $('#childYear').value.trim();
      const payload = {
        name: name,
        sex: $('#childSex').value || null,
        birth_year: year ? Number(year) : null
      };

      const id = $('#childId').value;
      $('#childSave').dataset.busy = '1';

      const request = id
        ? send('/api/patient/children/' + id, 'PATCH', payload)
        : send('/api/patient/children', 'POST', payload);

      request
        .then(() => { resetChildForm(); return reload(); })
        .catch((err) => {
          if (err.message === 'unauthorized') return;
          childError.textContent = T(err.detail || 'Не удалось сохранить профиль. Проверьте год рождения.');
          childError.hidden = false;
        })
        .then(() => { $('#childSave').dataset.busy = ''; });
    });

    $('#childCancel').addEventListener('click', resetChildForm);

    $('#kidGrid').addEventListener('click', (e) => {
      const edit = e.target.closest('[data-edit]');
      const del = e.target.closest('[data-del]');

      if (edit) {
        const kid = state.children.find((k) => String(k.id) === edit.dataset.edit);
        if (!kid) return;
        $('#childId').value = kid.id;
        $('#childName').value = kid.name;
        $('#childSex').value = kid.sex || '';
        $('#childYear').value = kid.birth_year || '';
        $('#childFormTitle').textContent = T('Изменить профиль');
        $('#childSaveLabel').textContent = T('Сохранить');
        $('#childCancel').hidden = false;
        $('#childName').focus();
        return;
      }

      if (del) {
        const kid = state.children.find((k) => String(k.id) === del.dataset.del);
        if (!kid) return;
        // Оценки остаются в кабинете, поэтому предупреждаем именно об этом
        if (!window.confirm(T('Удалить профиль «{name}»? Оценки останутся в кабинете, ' +
                              'но потеряют привязку к ребёнку.', { name: kid.name }))) return;
        api('/api/patient/children/' + kid.id, { method: 'DELETE' })
          .then(reload)
          .catch((err) => { if (err.message !== 'unauthorized') reload(); });
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
    side.addEventListener('click', (e) => { if (e.target.closest('a')) setSide(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSide(false); });
    window.addEventListener('resize', () => { if (window.innerWidth > 900) setSide(false); });

    [$('#logoutBtn'), $('#logoutBtnMobile')].forEach((btn) => btn.addEventListener('click', () => {
      fetch('/api/patient/logout', { method: 'POST', credentials: 'same-origin' })
        .then(() => { location.href = '/'; })
        .catch(() => { location.href = '/'; });
    }));

    document.addEventListener('dia:langchange', () => {
      updateTitle(viewFromPath(location.pathname));
      if (state.me) { fillChildSelects(); renderAll(); }
    });
  });
})();
