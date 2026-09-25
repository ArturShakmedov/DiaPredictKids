/* ==========================================================================
   NDST — движок оценки риска
   Прозрачная балльная модель: каждому признаку соответствует вес,
   сумма весов переводится в шкалу 0–100 и в один из уровней риска.
   Расчёт выполняется полностью в браузере.
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
     1. Справочник факторов
     ====================================================================== */

  // Классические симптомы. Вес отражает клиническую значимость признака.
  const SYMPTOMS = {
    thirst:     { w: 18, label: 'Сильная жажда',            key: true },
    urination:  { w: 16, label: 'Частое мочеиспускание',    key: true },
    weightLoss: { w: 16, label: 'Потеря веса',              key: true },
    enuresis:   { w: 12, label: 'Ночное недержание',        key: true },
    fatigue:    { w: 10, label: 'Утомляемость и вялость' },
    hunger:     { w:  8, label: 'Постоянный голод' },
    vision:     { w:  8, label: 'Нечёткое зрение' },
    nausea:     { w:  8, label: 'Тошнота, боль в животе' },
    itching:    { w:  9, label: 'Упорный зуд кожи или в области промежности' },
    healing:    { w:  7, label: 'Долгое заживление ранок' },
    skin:       { w:  6, label: 'Сухость кожи' },
    sleepNight: { w:  5, label: 'Нарушения ночного сна' }
  };

  // Семейный анамнез собирается по каждому родителю отдельно: заказчик просил
  // различать диабет у отца, матери и сиблингов, а бабушек и дедушек убрать.
  // Аутоиммунные болезни родителей перечислены поимённо — все они связаны
  // с общей наследственной предрасположенностью к диабету 1 типа.
  const RISKS = {
    t1dFather:       { w: 14, label: 'Сахарный диабет 1 типа у отца' },
    t1dMother:       { w: 14, label: 'Сахарный диабет 1 типа у матери' },
    t1dSibling:      { w: 14, label: 'Сахарный диабет 1 типа у брата или сестры' },
    t2dFamily:       { w: 10, label: 'Диабет 2 типа у родителя, брата или сестры' },
    acanthosis:      { w: 10, label: 'Тёмные бархатистые участки кожи' },
    autoimmuneChild: { w:  9, label: 'Аутоиммунное заболевание у ребёнка' },
    gdm:             { w:  8, label: 'Гестационный диабет у матери' },
    viralInfection:  { w:  6, label: 'Перенесённые вирусные инфекции: энтеровирусы, аденовирусы' },
    hashimoto:       { w:  5, label: 'Аутоиммунный тиреоидит (тиреоидит Хашимото) у родителей' },
    graves:          { w:  5, label: 'Болезнь Грейвса у родителей' },
    vitiligo:        { w:  5, label: 'Витилиго у родителей' },
    celiacParent:    { w:  5, label: 'Целиакия у родителей' },
    rheumatoid:      { w:  5, label: 'Ревматоидный артрит у родителей' },
    addison:         { w:  5, label: 'Болезнь Аддисона у родителей' },
    birthWeight:     { w:  5, label: 'Отклонение веса при рождении' },
    lowActivity:     { w:  5, label: 'Низкая физическая активность' },
    enzymeFamily:    { w:  5, label: 'Ферментопатии или нарушения обмена у родителей' },
    perinatal:       { w:  4, label: 'Осложнения беременности или родов' },
    sugarDrinks:     { w:  4, label: 'Сладкие напитки почти каждый день' },
    familyStress:    { w:  4, label: 'Длительная стрессовая обстановка в семье' },
    infection:       { w:  3, label: 'Частые инфекции в последние месяцы' },
    lowIncome:       { w:  3, label: 'Ограниченные материальные возможности семьи' }
  };

  // Пункты, снятые из анкеты, но встречающиеся в уже сохранённых анкетах
  const RISKS_LEGACY = {
    t1dFamily:        { w: 14, label: 'Диабет 1 типа у родителя, брата или сестры' },
    t1dGrand:         { w:  7, label: 'Диабет 1 типа у бабушки или дедушки' },
    t2dGrand:         { w:  6, label: 'Диабет 2 типа у бабушки или дедушки' },
    autoimmuneFamily: { w:  5, label: 'Аутоиммунные заболевания в семье' }
  };

  const ALL_RISKS = Object.assign({}, RISKS, RISKS_LEGACY);

  // Диабет 1 типа у первой линии родства: любой из пунктов закрывает вопрос
  const T1D_FIRST_LINE = ['t1dFather', 't1dMother', 't1dSibling', 't1dFamily'];

  const DURATION = {
    none:  { w: 0, label: 'Симптомов нет' },
    lt2w:  { w: 2, label: 'Симптомы менее 2 недель' },
    '2to8w': { w: 6, label: 'Симптомы от 2 недель до 2 месяцев' },
    gt8w:  { w: 9, label: 'Симптомы более 2 месяцев' }
  };

  // Характер питания — один преобладающий вариант, а не набор галочек:
  // родителю проще выбрать, на что похож рацион в целом.
  const DIET = {
    unknown:   { w: 0, label: 'Характер питания не указан' },
    balanced:  { w: 0, label: 'Питание в целом сбалансированное' },
    irregular: { w: 4, label: 'Нерегулярное питание, пропуски приёмов пищи' },
    sweets:    { w: 5, label: 'Много сладостей и выпечки каждый день' },
    fastfood:  { w: 6, label: 'Преобладают фастфуд и готовые продукты' }
  };

  // Доля углеводов в рационе. Точной цифры родитель не знает, поэтому
  // спрашиваем долями тарелки, а не процентами.
  const CARBS = {
    unknown:  { w: 0, label: 'Долю углеводов оценить не удалось' },
    low:      { w: 0, label: 'Углеводы — меньше трети рациона' },
    normal:   { w: 0, label: 'Углеводы — около половины рациона' },
    high:     { w: 4, label: 'Углеводы — больше половины рациона' },
    veryHigh: { w: 7, label: 'Углеводы — основная часть рациона' }
  };

  // Группа крови собирается как справочная величина для врача.
  // Веса у неё нет: связь системы AB0 с риском диабета в исследованиях
  // противоречива, и превращать её в баллы было бы натяжкой.
  const BLOOD = {
    unknown: 'Группа крови не указана',
    O:       'Группа крови O (I)',
    A:       'Группа крови A (II)',
    B:       'Группа крови B (III)',
    AB:      'Группа крови AB (IV)'
  };

  // Короткий список признаков дисплазии соединительной ткани для родителя.
  // В риск диабета они не входят: степень дисплазии считает шкала ДСТ
  // (scripts/dst.js), чтобы детей с ДСТ и без неё можно было сравнивать.
  const DYSPLASIA = {
    hypermobility: { label: 'Повышенная подвижность суставов' },
    skinElastic:   { label: 'Тонкая растяжимая кожа, стрии, атрофические рубцы' },
    chest:         { label: 'Деформация грудной клетки' },
    heartValve:    { label: 'Пролапс митрального клапана или малая аномалия сердца' },
    spine:         { label: 'Сколиоз или выраженное нарушение осанки' },
    flatfoot:      { label: 'Плоскостопие' },
    myopia:        { label: 'Близорукость' },
    teeth:         { label: 'Аномалии прикуса, скученность зубов, высокое нёбо' },
    asthenic:      { label: 'Астеническое телосложение, длинные тонкие пальцы' },
    bruising:      { label: 'Лёгкое образование синяков, кровоточивость дёсен' },
    hernia:        { label: 'Грыжи, варикоз, опущение органов' }
  };

  /* ======================================================================
     2. ИМТ: ориентировочные перцентильные границы по возрасту и полу
     Значения приближены к референсным кривым CDC (5-й / 85-й / 95-й перцентиль).
     Используются только как ориентир, а не как точная оценка нутритивного статуса.
     ====================================================================== */

  const BMI_REF = {
    m: {
      //     age:  [p5,   p85,  p95]
      2:  [14.7, 18.2, 19.3], 3:  [14.3, 17.4, 18.3], 4:  [14.0, 16.9, 17.8],
      5:  [13.8, 16.8, 17.9], 6:  [13.7, 17.0, 18.4], 7:  [13.7, 17.4, 19.2],
      8:  [13.8, 18.0, 20.0], 9:  [14.0, 18.6, 21.1], 10: [14.2, 19.4, 22.1],
      11: [14.5, 20.2, 23.2], 12: [15.0, 21.0, 24.2], 13: [15.4, 21.8, 25.1],
      14: [16.0, 22.6, 26.0], 15: [16.5, 23.4, 26.8], 16: [17.1, 24.2, 27.5],
      17: [17.6, 24.9, 28.2]
    },
    f: {
      2:  [14.4, 18.0, 19.1], 3:  [14.0, 17.2, 18.3], 4:  [13.7, 16.8, 18.0],
      5:  [13.5, 16.8, 18.3], 6:  [13.4, 17.1, 19.0], 7:  [13.4, 17.6, 19.8],
      8:  [13.5, 18.3, 20.8], 9:  [13.7, 19.1, 21.8], 10: [14.0, 20.0, 22.9],
      11: [14.4, 20.9, 24.0], 12: [14.8, 21.7, 25.0], 13: [15.3, 22.6, 25.9],
      14: [15.8, 23.3, 26.7], 15: [16.3, 24.0, 27.4], 16: [16.7, 24.6, 28.1],
      17: [17.1, 25.2, 28.7]
    }
  };

  function classifyBMI(bmi, age, sex) {
    const table = BMI_REF[sex] || BMI_REF.m;
    const a = Math.min(17, Math.max(2, Math.round(age)));
    const ref = table[a];

    if (!ref) {
      return { code: 'unknown', label: 'Нет возрастной нормы', w: 0,
               note: 'Для этого возраста ориентир не рассчитывается' };
    }
    if (bmi < ref[0]) {
      return { code: 'under', label: 'Дефицит массы тела', w: 6,
               note: 'ИМТ ниже возрастного ориентира' };
    }
    if (bmi >= ref[2]) {
      return { code: 'obese', label: 'Ожирение', w: 12,
               note: 'ИМТ выше 95-го перцентиля для возраста' };
    }
    if (bmi >= ref[1]) {
      return { code: 'over', label: 'Избыточная масса тела', w: 8,
               note: 'ИМТ между 85-м и 95-м перцентилем' };
    }
    return { code: 'normal', label: 'Норма', w: 0,
             note: 'ИМТ в пределах возрастного ориентира' };
  }

  /* ======================================================================
     3. Расчёт итоговой оценки
     ====================================================================== */

  const LEVELS = {
    low:  {
      key: 'low', label: 'Низкий риск диабета', cls: 'low', color: '#22C55E',
      title: 'Тревожных признаков не выявлено',
      text: 'Сейчас данных, указывающих на высокий риск сахарного диабета, нет. ' +
            'Это не отменяет плановых осмотров у педиатра.',
      recs: [
        'Продолжайте плановые профилактические осмотры у педиатра.',
        'Сохраняйте привычный уровень активности и питания ребёнка.',
        'Пройдите оценку повторно, если появятся жажда, частое мочеиспускание, ' +
        'потеря веса или необъяснимая утомляемость.'
      ]
    },
    mod: {
      key: 'mod', label: 'Умеренный риск диабета', cls: 'mod', color: '#F59E0B',
      title: 'Рекомендуется консультация педиатра',
      text: 'Часть отмеченных признаков заслуживает внимания врача. ' +
            'Это не диагноз, но повод не откладывать приём.',
      recs: [
        'Запишитесь к педиатру в ближайшие дни и покажите эту сводку.',
        'Обсудите с врачом анализ глюкозы крови натощак и, при необходимости, HbA1c.',
        'Записывайте, как часто ребёнок пьёт и ходит в туалет, — это поможет врачу.',
        'Немедленно обратитесь за помощью, если появятся рвота, боль в животе ' +
        'или запах ацетона изо рта.'
      ]
    },
    high: {
      key: 'high', label: 'Высокий риск диабета', cls: 'high', color: '#EF4444',
      title: 'Нужна консультация врача в ближайшее время',
      text: 'Сочетание отмеченных признаков характерно для нарушения углеводного обмена. ' +
            'Обследование откладывать не стоит.',
      recs: [
        'Обратитесь к педиатру или детскому эндокринологу в ближайшие 1–2 дня.',
        'Попросите измерить уровень глюкозы крови — это быстрый и доступный тест.',
        'Возьмите на приём распечатку этой сводки с перечнем симптомов.',
        'При появлении рвоты, боли в животе, запаха ацетона или сонливости — ' +
        'вызывайте неотложную помощь, не дожидаясь приёма.'
      ]
    }
  };

  function calculate(data) {
    const found = [];
    const absent = [];
    let total = 0;

    // --- симптомы ---
    Object.keys(SYMPTOMS).forEach((id) => {
      const s = SYMPTOMS[id];
      if (data.symptoms.indexOf(id) !== -1) {
        total += s.w;
        found.push({ label: s.label, w: s.w, group: 'Симптом' });
      } else if (s.key) {
        absent.push({ label: s.label });
      }
    });

    // --- длительность симптомов ---
    const dur = DURATION[data.duration] || DURATION.none;
    if (dur.w && data.symptoms.length) {
      total += dur.w;
      found.push({ label: dur.label, w: dur.w, group: 'Длительность' });
    }

    // --- факторы риска ---
    Object.keys(ALL_RISKS).forEach((id) => {
      const r = ALL_RISKS[id];
      if (data.risks.indexOf(id) !== -1) {
        total += r.w;
        found.push({ label: r.label, w: r.w, group: 'Фактор риска' });
      }
    });
    if (!T1D_FIRST_LINE.some((id) => data.risks.indexOf(id) !== -1)) {
      absent.push({ label: 'Диабет 1 типа у ближайших родственников' });
    }
    if (data.risks.indexOf('acanthosis') === -1) absent.push({ label: 'Тёмные участки кожи на шее и в складках' });

    // --- характер питания ---
    const diet = DIET[data.diet] || DIET.unknown;
    if (diet.w) {
      total += diet.w;
      found.push({ label: diet.label, w: diet.w, group: 'Питание' });
    }

    // --- доля углеводов ---
    const carbs = CARBS[data.carbs] || CARBS.unknown;
    if (carbs.w) {
      total += carbs.w;
      found.push({ label: carbs.label, w: carbs.w, group: 'Питание' });
    }

    // Признаки дисплазии в сумму не входят — их оценивает шкала ДСТ отдельно
    const dys = Object.keys(DYSPLASIA).filter((id) => (data.dysplasia || []).indexOf(id) !== -1);

    // --- ИМТ ---
    const bmiClass = classifyBMI(data.bmi, data.age, data.sex);
    if (bmiClass.w) {
      total += bmiClass.w;
      found.push({ label: 'ИМТ: ' + bmiClass.label.toLowerCase(), w: bmiClass.w, group: 'Антропометрия' });
    } else if (bmiClass.code === 'normal') {
      absent.push({ label: 'Отклонение ИМТ от возрастной нормы' });
    }

    // --- перевод суммы баллов в шкалу 0–100 ---
    // Насыщающая кривая: первые значимые признаки дают наибольший прирост.
    let score = Math.round(100 * (1 - Math.exp(-total / 62)));

    // --- клинические правила поверх баллов ---
    const has = (id) => data.symptoms.indexOf(id) !== -1;
    const triad = has('thirst') && has('urination') && (has('weightLoss') || has('enuresis'));

    if (triad) score = Math.max(score, 70);        // классическая триада — красный флаг

    score = Math.min(97, score);

    let level = LEVELS.low;
    if (score >= 60) level = LEVELS.high;
    else if (score >= 25) level = LEVELS.mod;

    // Сортируем найденные факторы по убыванию вклада
    found.sort((a, b) => b.w - a.w);

    return {
      score: score,
      total: total,
      level: level,
      triad: triad,
      bmiClass: bmiClass,
      // группа крови баллов не даёт, но врачу её показываем
      blood: BLOOD[data.blood] ? data.blood : 'unknown',
      dysplasiaCount: dys.length,
      found: found,
      absent: absent
    };
  }

  /* ======================================================================
     4. Управление шагами
     ====================================================================== */

  // Экспорт до работы с DOM: модель нужна тестам паритета с сервером
  window.NdstModel = {
    SYMPTOMS, RISKS, RISKS_LEGACY, DURATION, DIET, CARBS, BLOOD, DYSPLASIA,
    classifyBMI, calculate
  };

  const form = document.getElementById('assessForm');
  if (!form) return;

  const panels = Array.from(document.querySelectorAll('.step-panel'));
  const psteps = Array.from(document.querySelectorAll('.pstep'));
  const progressFill = document.getElementById('progressFill');
  const progressLabel = document.getElementById('progressLabel');
  const analysing = document.getElementById('analysing');
  const resultEl = document.getElementById('result');

  // Шагов столько, сколько отметок в прогрессе (последняя — экран результата).
  // Иначе добавление шага требовало бы правки процентов в двух местах.
  const STEP_COUNT = psteps.length;

  let current = 1;
  let lastRender = null;   // последний отрисованный результат

  /* ---- Шаг 4: признаки ДСТ ---------------------------------------------
     Список рисуется из шкалы (scripts/dst.js): подписи и баллы живут в одном
     месте и совпадают с осмотром врача в кабинете. */

  function renderDysplasiaStep() {
    const host = document.getElementById('dysCards');
    if (!host || !window.NdstDst) return;
    const D = window.NdstDst;

    host.innerHTML = D.PARENT_FORM.map((group) => {
      const items = group.keys.map((key) => {
        const item = group.kind === 'anomaly' ? D.ANOMALIES[key]
          : group.kind === 'complex' ? D.COMPLEX[key] : D.PHENOTYPES[key];
        const points = group.kind === 'complex' ? D.PARENT_GRADE : item.w;
        return '<label class="check">' +
          '<input type="checkbox" name="dys" data-kind="' + group.kind + '" value="' + key + '">' +
          '<span class="check__box"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>' +
          '<span class="check__text"><span class="check__title">' + esc(item.label) + '</span></span>' +
          (group.kind === 'anomaly' ? '' : '<span class="check__w">+' + points + '</span>') +
        '</label>';
      }).join('');

      return '<div class="form-card">' +
        '<div class="form-card__title">' + esc(group.title) + '</div>' +
        (group.hint ? '<p class="small text-3 form-card__hint">' + esc(group.hint) + '</p>' : '') +
        '<div class="check-list">' + items + '</div></div>';
    }).join('');
    applyI18n(host);
  }

  /** Отмеченное на шаге 4 в виде осмотра по шкале ДСТ */
  function collectDst() {
    const D = window.NdstDst;
    if (!D) return null;
    const exam = D.emptyExam();
    form.querySelectorAll('[name="dys"]:checked').forEach((input) => {
      const kind = input.dataset.kind;
      if (kind === 'anomaly') exam.anomalies.push(input.value);
      else if (kind === 'complex') exam.complex[input.value] = D.PARENT_GRADE;
      else exam.phenotypes.push(input.value);
    });
    return D.normalize(exam);
  }

  renderDysplasiaStep();

  function showStep(n) {
    current = n;
    panels.forEach((p) => p.classList.toggle('is-current', Number(p.dataset.panel) === n));
    psteps.forEach((s) => {
      const i = Number(s.dataset.step);
      s.classList.toggle('is-active', i === n);
      s.classList.toggle('is-done', i < n);
      const num = s.querySelector('.pstep__num');
      if (!num) return;
      // галочка — инлайн-SVG, а не типографский символ
      num.innerHTML = i < n
        ? '<svg class="icon icon-xs" viewBox="0 0 24 24" aria-hidden="true">' +
          window.NdstIcons.ICONS['check'] + '</svg> 0' + i
        : '0' + i;
    });
    progressFill.style.width = (n * 100 / STEP_COUNT) + '%';
    progressLabel.textContent = T('Шаг {n} из {total}', { n: n, total: STEP_COUNT });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---- Валидация шага 1 ---------------------------------------------- */

  function validateStep1() {
    const checks = [
      { el: document.getElementById('age'), min: 1, max: 17 },
      { el: document.getElementById('height'), min: 50, max: 210 },
      { el: document.getElementById('weight'), min: 5, max: 150 }
    ];

    let ok = true;
    checks.forEach((c) => {
      const v = parseFloat(c.el.value);
      const bad = isNaN(v) || v < c.min || v > c.max;
      c.el.closest('.field').classList.toggle('has-error', bad);
      c.el.setAttribute('aria-invalid', String(bad));
      if (bad && ok) { c.el.focus(); ok = false; }
    });
    return ok;
  }

  /* ---- Живой расчёт ИМТ ----------------------------------------------- */

  const bmiLive = document.getElementById('bmiLive');
  const bmiValue = document.getElementById('bmiValue');
  const bmiText = document.getElementById('bmiText');

  function currentBMI() {
    const h = parseFloat(document.getElementById('height').value) / 100;
    const w = parseFloat(document.getElementById('weight').value);
    if (!h || !w || h <= 0) return null;
    return w / (h * h);
  }

  function updateBMI() {
    const bmi = currentBMI();
    const age = parseFloat(document.getElementById('age').value);
    if (!bmi || isNaN(age)) { bmiLive.hidden = true; return; }

    const sex = form.querySelector('input[name="sex"]:checked').value;
    const c = classifyBMI(bmi, age, sex);

    bmiLive.hidden = false;
    bmiValue.textContent = bmi.toFixed(1);
    bmiText.innerHTML = '<b>' + T(c.label) + '</b> — ' + T(c.note) + '. ' +
      T('Показатель ориентировочный: точную оценку даёт врач по центильным таблицам.');
  }

  ['age', 'height', 'weight'].forEach((id) => {
    document.getElementById(id).addEventListener('input', updateBMI);
  });
  form.querySelectorAll('input[name="sex"]').forEach((r) => r.addEventListener('change', updateBMI));

  /* ---- Кнопки навигации ------------------------------------------------ */

  form.querySelectorAll('[data-next]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (current === 1 && !validateStep1()) return;
      showStep(current + 1);
    });
  });

  form.querySelectorAll('[data-prev]').forEach((btn) => {
    btn.addEventListener('click', () => showStep(current - 1));
  });

  form.addEventListener('submit', (e) => e.preventDefault());

  /* ======================================================================
     5. Сбор данных и запуск расчёта
     ====================================================================== */

  function collect() {
    const val = (n) => (form.querySelector('[name="' + n + '"]:checked') || {}).value;
    const many = (n) => Array.from(form.querySelectorAll('[name="' + n + '"]:checked')).map((i) => i.value);

    const age = parseFloat(document.getElementById('age').value);
    const height = parseFloat(document.getElementById('height').value);
    const weight = parseFloat(document.getElementById('weight').value);

    return {
      age: age,
      sex: val('sex') || 'm',
      height: height,
      weight: weight,
      bmi: weight / Math.pow(height / 100, 2),
      symptoms: many('sym'),
      risks: many('risk'),
      dst: collectDst(),
      dysplasia: [],
      duration: document.getElementById('duration').value,
      // Кто заполняет анкету: медработник помечает запись как заполненную
      // в клинике. Раньше этот ответ собирался формой и никуда не уходил.
      source: document.getElementById('relation').value === 'doctor'
        ? 'clinic' : 'parent',
      diet: document.getElementById('diet').value,
      carbs: document.getElementById('carbs').value,
      blood: document.getElementById('blood').value
    };
  }

  document.getElementById('submitBtn').addEventListener('click', () => {
    if (!validateStep1()) { showStep(1); return; }

    const data = collect();
    const res = calculate(data);

    // Экран обработки
    form.style.display = 'none';
    analysing.classList.add('is-current');
    showStep(STEP_COUNT);

    const logItems = Array.from(document.querySelectorAll('#analysingLog li'));
    logItems.forEach((li, i) => setTimeout(() => li.classList.add('is-done'), 260 + i * 340));

    setTimeout(() => {
      analysing.classList.remove('is-current');
      renderResult(data, res);
    }, 260 + logItems.length * 340 + 260);
  });

  /* ======================================================================
     6. Отрисовка результата
     ====================================================================== */

  function renderResult(data, res, options) {
    const level = res.level;
    // instant — без анимаций: так страницу рисует сервер, когда готовит PDF
    const instant = Boolean(options && options.instant);

    resultEl.classList.add('is-current');

    // Дата для шапки распечатки. Числами — так её не нужно переводить.
    // Сводка сохранённой оценки из кабинета врача несёт дату прохождения
    // анкеты и метку пациента — печатаем их, а не сегодняшний день.
    const printDate = document.getElementById('printDate');
    if (printDate) {
      const pad = (n) => String(n).padStart(2, '0');
      const saved = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data.date || '');
      const now = new Date();
      printDate.textContent = saved
        ? saved[3] + '.' + saved[2] + '.' + saved[1]
        : pad(now.getDate()) + '.' + pad(now.getMonth() + 1) + '.' + now.getFullYear();
    }
    const printPatient = document.getElementById('printPatient');
    if (printPatient) {
      printPatient.textContent = data.label || '';
      printPatient.hidden = !data.label;
    }
    document.getElementById('resultHero').className = 'result__hero level-' + level.cls;

    // Бейдж и тексты
    const badge = document.getElementById('resultBadge');
    badge.className = 'badge badge--' + level.cls;
    document.getElementById('resultBadgeText').textContent = level.label;
    document.getElementById('resultTitle').textContent = level.title;
    document.getElementById('resultText').textContent = level.text;

    // Шкала
    const bar = document.getElementById('resultBar');
    bar.className = 'bar__fill bar__fill--' + level.cls;

    // Круговой индикатор
    const arc = document.getElementById('gaugeArc');
    const num = document.getElementById('gaugeNum');
    const C = 2 * Math.PI * 82;
    arc.setAttribute('stroke-dasharray', String(C));
    arc.setAttribute('stroke-dashoffset', String(C));
    arc.setAttribute('stroke', level.color);

    const fillGauge = () => {
      arc.setAttribute('stroke-dashoffset', String(C * (1 - res.score / 100)));
      bar.style.width = res.score + '%';
    };
    if (instant) fillGauge();
    else requestAnimationFrame(fillGauge);

    // Анимация числа. Главное здесь — итоговое значение, а не движение:
    // если кадры не идут (фоновая вкладка, отключённая анимация), число
    // обязано оказаться верным, а не застыть на нуле.
    const dur = 1100;
    const calm = instant || (window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    if (calm) {
      num.textContent = res.score + '%';
    } else {
      let t0 = null;
      let frames = 0;
      // Итог пишут двое — последний кадр анимации и страховочный таймер.
      // Без флага запоздалый кадр со старым временем кадра перезаписывал уже
      // проставленный итог обратно на ноль: так на распечатке выходило «0%».
      let done = false;
      const finish = function () {
        done = true;
        num.textContent = res.score + '%';
      };
      num.textContent = '0%';
      requestAnimationFrame(function tick(now) {
        if (done) return;
        if (t0 === null) t0 = now;
        frames++;
        const p = Math.max(0, Math.min(1, (now - t0) / dur));
        num.textContent = Math.round(res.score * (1 - Math.pow(1 - p, 3))) + '%';

        // Ограничение по кадрам, а не только по времени: если часы кадров
        // стоят на месте (фоновая вкладка, снимок в headless), условие p < 1
        // никогда не выполнится и на экране навсегда останется ноль.
        if (p < 1 && frames < 120) requestAnimationFrame(tick);
        else finish();
      });

      // Кадры могут вообще перестать приходить — например, во вкладке,
      // которую увели в фон. Тогда на экране навсегда остался бы ноль,
      // поэтому по таймеру проставляем итоговое значение принудительно.
      setTimeout(finish, dur + 150);
    }

    const scale = renderDst(data);

    // Профиль ребёнка
    const sexLabel = data.sex === 'f' ? 'Девочка' : 'Мальчик';
    document.getElementById('profileRow').innerHTML = [
      cell(T('Ребёнок'), T(sexLabel) + ', ' + data.age + ' ' + plural(data.age, ['год', 'года', 'лет']), ''),
      cell(T('Рост и вес'), T('{h} см · {w} кг', { h: data.height, w: data.weight }), ''),
      cell(T('ИМТ'), data.bmi.toFixed(1), T(res.bmiClass.label)),
      // считаем все отмечаемые признаки, включая соединительную ткань
      cell(T('Отмечено признаков'),
           String(data.symptoms.length + data.risks.length +
                  (scale ? scale.chosen + scale.anomalies : 0)),
           T('из {n} возможных', { n: Object.keys(SYMPTOMS).length +
                                     Object.keys(RISKS).length + dysplasiaItems() }))
    ].join('');

    // Факторы
    const foundEl = document.getElementById('factorsFound');
    foundEl.innerHTML = res.found.length
      ? res.found.map((f) =>
          '<li class="factor-item"><i data-icon="check"></i>' +
          '<span class="factor-item__name">' + esc(f.label) + '</span>' +
          '<span class="factor-item__w">+' + f.w + '</span></li>').join('')
      : '<li class="factor-empty">Значимых факторов не отмечено.</li>';

    // Группа крови баллов не даёт, но врачу она нужна — показываем отдельно
    const refLine = document.getElementById('refLine');
    if (refLine) {
      refLine.hidden = !res.blood || res.blood === 'unknown';
      document.getElementById('refBlood').textContent = T(BLOOD[res.blood] || '');
    }


    const absentEl = document.getElementById('factorsAbsent');
    absentEl.innerHTML = res.absent.length
      ? res.absent.map((f) =>
          '<li class="factor-item"><i data-icon="minus-circle"></i>' +
          '<span class="factor-item__name">' + esc(f.label) + '</span></li>').join('')
      : '<li class="factor-empty">Отмечены все значимые признаки из списка.</li>';

    // Рекомендации
    const recs = level.recs.slice();
    if (res.triad) {
      recs.unshift('Вы отметили сочетание жажды, частого мочеиспускания и ' +
                   'потери веса или ночного недержания — это классический набор признаков, ' +
                   'при котором измерение глюкозы крови нужно сделать в ближайшее время.');
    }
    if (res.bmiClass.code === 'obese' || res.bmiClass.code === 'over') {
      recs.push('Обсудите с педиатром питание и физическую активность: снижение ' +
                'избыточного веса уменьшает риск диабета 2 типа.');
    }
    if (scale && scale.degree >= 1) {
      recs.push(scale.byDoctor
        ? 'Врач определил степень дисплазии соединительной ткани по полной шкале ДСТ: ' +
          'на этом фоне нарушения углеводного обмена имеет смысл искать раньше.'
        : 'По ответам набирается степень дисплазии соединительной ткани. ' +
          'Попросите педиатра провести осмотр по полной шкале ДСТ: на этом фоне ' +
          'нарушения углеводного обмена имеет смысл искать раньше.');
    }
    document.getElementById('recsList').innerHTML =
      recs.map((r) => '<li>' + esc(r) + '</li>').join('');

    document.getElementById('resultTag').textContent =
      T('Оценка построена на {n} учтённых факторах', { n: res.found.length });

    window.NdstIcons.renderIcons(resultEl);
    applyI18n(resultEl);
    lastRender = { data: data, res: res };
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* Шкала ДСТ по ответам анкеты. Отдельный результат: в процент риска
     диабета не входит, чтобы детей с дисплазией и без неё можно было
     сравнивать. Возвращает расчёт — по нему добавляется рекомендация. */
  const DST_BADGE = ['low', 'mod', 'high', 'high'];

  function renderDst(data) {
    const box = document.getElementById('dstBox');
    if (!box || !window.NdstDst) return null;
    // осмотр врача приходит только в сводку, которую печатает кабинет врача
    const byDoctor = data.dst_source === 'doctor' && Boolean(data.dst_exam);
    // осмотр врача -> ответы анкеты -> короткий список старых анкет
    const exam = byDoctor ? data.dst_exam
      : (data.dst || window.NdstDst.fromParent(data.dysplasia));
    const scale = window.NdstDst.calculate(exam);
    scale.byDoctor = byDoctor;
    document.getElementById('dstNoteParent').hidden = byDoctor;
    document.getElementById('dstNoteDoctor').hidden = !byDoctor;

    document.getElementById('dstBadge').className = 'badge badge--' + DST_BADGE[scale.degree];
    document.getElementById('dstBadgeText').textContent = scale.degreeLabel;
    document.getElementById('dstIndex').textContent = String(scale.index);
    document.getElementById('dstChosen').textContent = String(scale.chosen);
    document.getElementById('dstHeavy').textContent = String(scale.heavy);
    document.getElementById('dstAnomalies').textContent = String(scale.anomalies);

    const items = scale.items.map((i) =>
      '<li class="dst-item"><i data-icon="check"></i>' +
        '<span class="dst-item__name">' +
          '<span>' + esc(i.label) + '</span>' +
          (i.grade ? ' <span class="dst-item__grade">' + esc(i.grade) + '</span>' : '') +
        '</span>' +
        '<span class="dst-item__w">+' + i.w + '</span></li>');
    // аномалии органов — отдельной строкой: в индекс они не входят
    const anomalies = scale.anomalyItems.map((a) =>
      '<li class="dst-item dst-item--anomaly"><i data-icon="info"></i>' +
        '<span class="dst-item__name"><span>' + esc(a.label) + '</span> ' +
          '<span class="dst-item__grade">аномалия, в индекс не входит</span></span></li>');

    document.getElementById('dstList').innerHTML = items.length || anomalies.length
      ? items.concat(anomalies).join('')
      : '<li class="factor-empty">Признаки дисплазии не отмечены.</li>';
    return scale;
  }

  /** Сколько признаков ДСТ показано родителю на шаге 4 */
  function dysplasiaItems() {
    if (!window.NdstDst) return 0;
    return window.NdstDst.PARENT_FORM.reduce((n, group) => n + group.keys.length, 0);
  }

  function cell(label, value, note) {
    return '<div class="profile-cell">' +
      '<div class="profile-cell__l">' + esc(label) + '</div>' +
      '<div class="profile-cell__v">' + esc(value) + '</div>' +
      (note ? '<div class="profile-cell__n">' + esc(note) + '</div>' : '') +
    '</div>';
  }

  function plural(n, forms) {
    if (window.NdstI18n) return window.NdstI18n.plural(n, forms);
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ======================================================================
     7. Действия на экране результата
     ====================================================================== */

  document.getElementById('printBtn').addEventListener('click', () => window.print());

  /** Ответы анкеты в том виде, в каком их принимает сервер. Один источник
      и для сохранения, и для PDF. Раньше сохранение перечисляло поля вручную,
      не отправляло питание, группу крови и признаки дисплазии — и сервер
      пересчитывал балл ниже, чем показывал экран. */
  function answersPayload(d) {
    return {
      age: d.age, sex: d.sex, height: d.height, weight: d.weight,
      symptoms: d.symptoms, risks: d.risks, dst: d.dst || null,
      dysplasia: d.dysplasia || [], duration: d.duration,
      diet: d.diet || 'unknown', carbs: d.carbs || 'unknown',
      blood: d.blood || 'unknown', source: d.source || 'parent'
    };
  }

  /* ---- Скачать PDF ------------------------------------------------------
     Файл готовит сервер: открывает эту же страницу в браузере без окна и
     сохраняет её печатью, поэтому скачанный PDF совпадает с распечаткой. */
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadError = document.getElementById('downloadError');

  downloadBtn.addEventListener('click', () => {
    if (!lastRender) return;
    downloadError.hidden = true;
    downloadBtn.dataset.busy = '1';

    const payload = answersPayload(lastRender.data);
    payload.lang = window.NdstI18n ? window.NdstI18n.lang : 'ru';
    if (!document.getElementById('shareDone').hidden) {
      payload.code = document.getElementById('shareCode').textContent.trim();
    }

    fetch('/api/assessments/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    })
      .then((r) => {
        if (!r.ok) throw new Error('pdf ' + r.status);
        // Имя файла сервер отдаёт в заголовке, но прокси и CDN его порой
        // срезают — тогда собираем то же имя с датой сами.
        const match = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '');
        const today = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const fallback = 'NDST-svodka-' + today.getFullYear() + '-' +
          pad(today.getMonth() + 1) + '-' + pad(today.getDate()) + '.pdf';
        return r.blob().then((blob) => ({ blob: blob, name: match ? match[1] : fallback }));
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
      })
      .catch(() => {
        downloadError.textContent = T('Не удалось подготовить PDF. Нажмите «Распечатать сводку» и выберите «Сохранить как PDF».');
        downloadError.hidden = false;
      })
      .then(() => { downloadBtn.dataset.busy = ''; });
  });

  /* ---- Отправка результата врачу: только по явному нажатию ------------ */

  /* Вошедший родитель может сразу записать оценку в историю ребёнка.
     Гостю этот выбор не показываем: 401 здесь — обычное дело, не ошибка. */
  const shareChild = document.getElementById('shareChild');

  function childId() {
    const v = shareChild && shareChild.value;
    return v ? Number(v) : null;
  }

  fetch('/api/patient/children', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((kids) => {
      if (!kids || !kids.length) return;
      kids.forEach((k) => {
        const opt = document.createElement('option');
        opt.value = k.id;
        opt.textContent = k.name;
        shareChild.appendChild(opt);
      });
      if (kids.length === 1) shareChild.value = kids[0].id;
      document.getElementById('shareChildField').hidden = false;
    })
    .catch(() => { /* нет сети или нет входа — просто не предлагаем выбор */ });

  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      if (!lastRender) return;
      const d = lastRender.data;
      const errorBox = document.getElementById('shareError');
      errorBox.hidden = true;
      shareBtn.dataset.busy = '1';

      fetch('/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(Object.assign(answersPayload(d), { child_id: childId() }))
      })
        .then((r) => r.json().then((body) => ({ ok: r.ok, body: body })))
        .then((res) => {
          if (!res.ok) throw new Error('save failed');
          document.getElementById('shareCode').textContent = res.body.public_id;
          document.getElementById('shareDone').hidden = false;
          document.getElementById('shareActions').hidden = true;
          document.getElementById('shareChildField').hidden = true;
          // сервер сам решает, попала ли оценка в кабинет: он видит cookie
          document.getElementById(res.body.in_cabinet ? 'shareCabinet' : 'shareOffer')
            .hidden = false;
        })
        .catch(() => {
          errorBox.textContent = T('Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.');
          errorBox.hidden = false;
          shareBtn.dataset.busy = '';
        });
    });
  }

  document.getElementById('restartBtn').addEventListener('click', () => {
    form.reset();
    form.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
    const done = document.getElementById('shareDone');
    if (done) {
      done.hidden = true;
      document.getElementById('shareCabinet').hidden = true;
      document.getElementById('shareOffer').hidden = true;
      document.getElementById('shareChildField').hidden = !shareChild.options.length ||
        shareChild.options.length < 2;
      document.getElementById('shareActions').hidden = false;
      document.getElementById('shareBtn').dataset.busy = '';
      document.getElementById('shareError').hidden = true;
    }
    downloadError.hidden = true;
    form.style.display = '';
    resultEl.classList.remove('is-current');
    document.querySelectorAll('#analysingLog li').forEach((li) => li.classList.remove('is-done'));
    bmiLive.hidden = true;
    showStep(1);
  });

  /* ---- Смена языка: строки с числами перерисовываем ------------------ */

  document.addEventListener('dia:langchange', () => {
    progressLabel.textContent = T('Шаг {n} из {total}', { n: current, total: STEP_COUNT });
    if (!bmiLive.hidden) updateBMI();
    if (lastRender) renderResult(lastRender.data, lastRender.res);
  });

  /* ======================================================================
     8. Режим печати для сервера: /assessment?print=<ответы>
     Сервер открывает страницу с ответами в адресе и сохраняет её в PDF.
     Результат рисуем сразу — без шагов, экрана обработки и анимаций.
     ====================================================================== */

  const printToken = new URLSearchParams(location.search).get('print');
  if (printToken) {
    try {
      const b64 = printToken.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '==='.slice((b64.length + 3) % 4);
      const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      const p = JSON.parse(new TextDecoder().decode(bytes));

      if (window.NdstI18n && p.lang) window.NdstI18n.setLang(p.lang, true);

      const data = Object.assign({}, p, { bmi: p.weight / Math.pow(p.height / 100, 2) });
      form.style.display = 'none';
      showStep(STEP_COUNT);
      renderResult(data, calculate(data), { instant: true });

      if (p.code) {
        document.getElementById('shareCode').textContent = p.code;
        document.getElementById('shareDone').hidden = false;
        // Сводку сохранённой оценки печатает кабинет врача (у неё есть дата
        // анкеты) — подсказка «назовите код врачу» в ней обращена не к тому.
        const hint = document.querySelector('#shareDone > p.small:not([id])');
        if (hint && p.date) hint.hidden = true;
      }
      document.documentElement.dataset.printReady = '1';
    } catch (e) {
      document.documentElement.dataset.printReady = 'error';
    }
  }
})();
