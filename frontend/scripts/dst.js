/* ==========================================================================
   NDST — шкала дисплазии соединительной ткани (ДСТ)
   Та же шкала, что в калькуляторе DST для детей. Степень дисплазии считается
   отдельно от риска диабета: так детей с ДСТ и без неё можно сравнивать,
   а сама шкала не подталкивает риск вверх.
   Серверная копия — backend/dst.py, совпадение проверяет тест паритета.
   ========================================================================== */

(function () {
  'use strict';

  // Фенотипические признаки и веса — по документу «Новые правила программы»
  const PHENOTYPES = {
    dolichocephaly:    { w: 3, label: 'Долихоцефалия' },
    septum:            { w: 1, label: 'Искривление носовой перегородки' },
    birdBeak:          { w: 2, label: 'Птичий клюв' },
    zygomatic:         { w: 2, label: 'Скуловая гипоплазия' },
    blueSclera:        { w: 4, label: 'Голубые склеры' },
    telorism:          { w: 2, label: 'Гипо-/гипертелоризм и/или телекант' },
    ptosis:            { w: 2, label: 'Птоз' },
    myopia:            { w: 4, label: 'Прогрессирующая миопия (>1 D/год)' },
    gothicPalate:      { w: 2, label: 'Высокое / готическое небо' },
    cleftPalate:       { w: 4, label: 'Незаращение твёрдого/мягкого неба' },
    teethEruption:     { w: 2, label: 'Нарушение сроков и последовательности прорезывания зубов' },
    bifidUvula:        { w: 4, label: 'Расщепление язычка' },
    malocclusion:      { w: 2, label: 'Неправильный прикус' },
    softEars:          { w: 4, label: 'Мягкость хрящевой ткани ушей' },
    drySkin:           { w: 3, label: 'Сухая, истончённая или преждевременно морщинистая кожа' },
    thinSkin:          { w: 3, label: 'Тонкая ранимая кожа' },
    scarring:          { w: 3, label: 'Патологическое рубцевание (атрофические и/или келоидные рубцы)' },
    vesselFragility:   { w: 4, label: 'Повышенная ломкость сосудов кожи (лёгкое образование экхимозов/гематом)' },
    striae:            { w: 4, label: 'Атрофические стрии, не связанные с ожирением, беременностью или быстрым ростом' },
    chest:             { w: 5, label: 'Деформация грудной клетки (воронкообразная или килевидная)' },
    scoliosis:         { w: 4, label: 'Сколиоз' },
    kyphosis:          { w: 4, label: 'Кифоз / лордоз' },
    subluxations:      { w: 5, label: 'Рецидивирующие подвывихи суставов' },
    brachydactyly:     { w: 2, label: 'Брахидактилия' },
    syndactyly:        { w: 2, label: 'Частичная синдактилия II–III пальцев стопы' },
    clinodactyly:      { w: 2, label: 'Клинодактилия' },
    varicose:          { w: 4, label: 'Варикозное расширение вен нижних конечностей' },
    flatfoot:          { w: 4, label: 'Плоскостопие' },
    legs:              { w: 3, label: 'Х-/О-образное искривление ног' },
    sandalGap:         { w: 3, label: 'Сандалевидная щель' },
    halluxValgus:      { w: 3, label: 'Hallux valgus' },
    clubfoot:          { w: 4, label: 'Косолапость' },
    calluses:          { w: 1, label: 'Натоптыши' },
    hair:              { w: 2, label: 'Структурные аномалии волос (ломкость, истончение)' },
    nails:             { w: 2, label: 'Дистрофические изменения ногтей (ломкость, продольная исчерченность, истончение ногтевой пластинки)' },
    narrowFace:        { w: 3, label: 'Узкий лицевой скелет' },
    dolichostenomelia: { w: 5, label: 'Долихостеномелия' },
    telangiectasia:    { w: 4, label: 'Телеангиэктазии' },
    valgusFeet:        { w: 3, label: 'Вальгусная установка стоп' },
    venousNet:         { w: 3, label: 'Видимая венозная сеть' },
    chin:              { w: 2, label: 'Скошенность подбородка' },
    posture:           { w: 2, label: 'Асимметрия стояния лопаток, «вялая осанка»' },
    abdominalHernia:   { w: 3, label: 'Грыжи передней брюшной стенки и/или диастаз прямых мышц живота' },
    hypoplasia:        { w: 4, label: 'Гипоплазия мышечной и/или подкожно-жировой ткани' }
  };

  // Признаки с градацией: нет — 0, умеренно — 3, выраженно — 5
  const COMPLEX = {
    skin: {
      label: 'Повышенная растяжимость кожи (на тыльной поверхности кисти)',
      options: [{ w: 0, label: 'Нет' }, { w: 3, label: 'Умеренная (<3 см)' }, { w: 5, label: 'Выраженная (≥3 см)' }]
    },
    hypotonia: {
      label: 'Мышечная гипотония',
      options: [{ w: 0, label: 'Нет' }, { w: 3, label: 'Умеренная' }, { w: 5, label: 'Выраженная' }]
    },
    beighton: {
      label: 'Гипермобильность суставов (по Бейтону)',
      options: [{ w: 0, label: 'Нет (0–3)' }, { w: 3, label: 'Умеренная (4–5)' }, { w: 5, label: 'Выраженная (6–9)' }]
    }
  };

  // Два теста вместе дают один признак арахнодактилии: 0 / 3 / 5
  const TESTS = {
    steinberg: {
      label: 'Симптом Штейнберга (большой палец)',
      hint: 'Большой палец, зажатый в кулак, выступает за ульнарный край ладони'
    },
    walker: {
      label: 'Симптом Уокера—Мёрдока (запястье)',
      hint: 'I и V пальцы перекрываются при охвате запястья противоположной руки'
    }
  };
  const ARACH_LABEL = 'Признаки арахнодактилии';
  const ARACH = [
    { w: 0, label: 'оба отрицательны' },
    { w: 3, label: 'положителен один из двух' },
    { w: 5, label: 'положительны оба' }
  ];

  // Ассоциированные аномалии: учитываются отдельным числом, в индекс не входят
  const ANOMALIES = {
    mitralProlapse:          { w: 5, label: 'Пролапс митрального клапана' },
    extraChords:             { w: 3, label: 'Дополнительные хорды' },
    arrhythmia:              { w: 3, label: 'Аритмии' },
    cardiomyopathy:          { w: 4, label: 'Кардиомиопатии' },
    aorticAneurysm:          { w: 5, label: 'Аневризма аорты' },
    angiodysplasia:          { w: 4, label: 'Ангиодисплазии' },
    asthma:                  { w: 4, label: 'Бронхиальная астма' },
    gallbladder:             { w: 3, label: 'Аномалия желчного пузыря' },
    biliaryDyskinesia:       { w: 3, label: 'Дискинезия ЖВП' },
    gallstones:              { w: 2, label: 'Желчекаменная болезнь' },
    gastroduodenitis:        { w: 2, label: 'Гастродуодениты' },
    gerd:                    { w: 4, label: 'Гастроэзофагальный рефлюкс' },
    diverticula:             { w: 4, label: 'Дивертикулы' },
    megacolon:               { w: 4, label: 'Мегаколон' },
    dolichosigma:            { w: 3, label: 'Долихосигма' },
    gastroAnomaly:           { w: 3, label: 'Аномалии развития органов пищеварения' },
    incontinence:            { w: 3, label: 'Недержание мочи' },
    ibs:                     { w: 3, label: 'Синдром раздраженного кишечника' },
    duplexKidney:            { w: 3, label: 'Удвоение ЧЛС' },
    nephroptosis:            { w: 3, label: 'Нефроптоз' },
    vesicoureteral:          { w: 3, label: 'Пузырно-мочеточниковый рефлюкс' },
    dysmetabolicNephropathy: { w: 3, label: 'Дисметаболическая нефропатия' },
    urogenitalAnomaly:       { w: 3, label: 'Аномалии развития мочеполовой системы' },
    delayedPuberty:          { w: 3, label: 'Задержка полового развития' },
    juvenileBleeding:        { w: 3, label: 'Ювенильные кровотечения / вялая мошонка' },
    dysmenorrhea:            { w: 4, label: 'Дисменорея / грыжи' },
    uterineHypoplasia:       { w: 4, label: 'Гипоплазия матки / варикоцеле' },
    hipDysplasia:            { w: 4, label: 'Дисплазия тазобедренных суставов' },
    visceroptosis:           { w: 4, label: 'Висцероптоз' },
    hiatalHernia:            { w: 5, label: 'Грыжа пищеводного отверстия' },
    duralEctasia:            { w: 5, label: 'Дуральная эктазия' }
  };

  // Шкала: 0–15 — недостаточно признаков · 16–25 — I · 26–35 — II · ≥36 — III
  const DEGREES = [
    { max: 15,   label: 'Недостаточно фенотипических признаков' },
    { max: 25,   label: 'I степень' },
    { max: 35,   label: 'II степень' },
    { max: null, label: 'III степень' }
  ];

  const HEAVY = 4;   // «значимые» признаки — с весом 4–5

  // Короткий список родителя -> пункты шкалы. Родитель не знает степень
  // гипермобильности по Бейтону, поэтому такие признаки берутся умеренными.
  const PARENT_MAP = {
    hypermobility: { complex: ['beighton', 3] },
    skinElastic:   { complex: ['skin', 3] },
    chest:         { phenotype: 'chest' },
    heartValve:    { anomaly: 'mitralProlapse' },
    spine:         { phenotype: 'scoliosis' },
    flatfoot:      { phenotype: 'flatfoot' },
    myopia:        { phenotype: 'myopia' },
    teeth:         { phenotype: 'malocclusion' },
    asthenic:      { test: 'steinberg' },
    bruising:      { phenotype: 'vesselFragility' },
    hernia:        { phenotype: 'abdominalHernia' }
  };

  // Что из шкалы показывается родителю на шаге 4. Заказчик просил взять
  // наиболее часто встречающиеся признаки и малые аномалии развития,
  // а полный список из 44 признаков оставить врачу на осмотре.
  const PARENT_GRADE = 3;   // родитель отмечает галочкой — берём умеренную степень
  const PARENT_FORM = [
    {
      title: 'Опорно-двигательный аппарат',
      kind: 'phenotype',
      keys: ['chest', 'scoliosis', 'kyphosis', 'posture', 'flatfoot',
             'valgusFeet', 'legs', 'dolichostenomelia']
    },
    {
      title: 'Кожа, зубы, глаза, уши',
      kind: 'phenotype',
      keys: ['thinSkin', 'striae', 'vesselFragility', 'blueSclera', 'myopia',
             'gothicPalate', 'malocclusion', 'teethEruption', 'softEars',
             'abdominalHernia', 'varicose']
    },
    {
      title: 'Суставы и кожа: признаки с градацией',
      kind: 'complex',
      hint: 'Родитель отмечает сам признак, степень уточняет врач на осмотре.',
      keys: ['beighton', 'skin']
    },
    {
      title: 'Внутренние органы: малые аномалии развития',
      kind: 'anomaly',
      hint: 'Обычно их находят на УЗИ. Учитываются отдельным числом и в сумму баллов не входят.',
      keys: ['mitralProlapse', 'visceroptosis', 'hiatalHernia',
             'biliaryDyskinesia', 'urogenitalAnomaly', 'gastroAnomaly']
    }
  ];

  function emptyExam() {
    const complex = {};
    Object.keys(COMPLEX).forEach((k) => { complex[k] = 0; });
    const tests = {};
    Object.keys(TESTS).forEach((k) => { tests[k] = false; });
    return { phenotypes: [], complex: complex, tests: tests, anomalies: [] };
  }

  /** Полная форма осмотра без неизвестных ключей — порядок как в справочнике */
  function normalize(exam) {
    const src = exam || {};
    const out = emptyExam();
    const ph = src.phenotypes || [];
    const an = src.anomalies || [];
    out.phenotypes = Object.keys(PHENOTYPES).filter((k) => ph.indexOf(k) !== -1);
    out.anomalies = Object.keys(ANOMALIES).filter((k) => an.indexOf(k) !== -1);
    Object.keys(COMPLEX).forEach((k) => {
      const v = (src.complex || {})[k];
      out.complex[k] = (v === 3 || v === 5) ? v : 0;
    });
    Object.keys(TESTS).forEach((k) => { out.tests[k] = Boolean((src.tests || {})[k]); });
    return out;
  }

  /** Осмотр, собранный из ответов родителя */
  function fromParent(dysplasia) {
    const exam = emptyExam();
    const marked = dysplasia || [];
    const ph = [];
    const an = [];
    Object.keys(PARENT_MAP).forEach((key) => {
      if (marked.indexOf(key) === -1) return;
      const t = PARENT_MAP[key];
      if (t.phenotype) ph.push(t.phenotype);
      if (t.anomaly) an.push(t.anomaly);
      if (t.complex) exam.complex[t.complex[0]] = Math.max(exam.complex[t.complex[0]], t.complex[1]);
      if (t.test) exam.tests[t.test] = true;
    });
    exam.phenotypes = Object.keys(PHENOTYPES).filter((k) => ph.indexOf(k) !== -1);
    exam.anomalies = Object.keys(ANOMALIES).filter((k) => an.indexOf(k) !== -1);
    return exam;
  }

  function arachScore(tests) {
    const n = Object.keys(TESTS).filter((k) => tests[k]).length;
    return ARACH[n].w;
  }

  function degreeOf(index) {
    for (let i = 0; i < DEGREES.length; i++) {
      if (DEGREES[i].max === null || index <= DEGREES[i].max) return i;
    }
    return DEGREES.length - 1;
  }

  function calculate(rawExam) {
    const exam = normalize(rawExam);
    const items = [];
    let index = 0, chosen = 0, heavy = 0;

    exam.phenotypes.forEach((key) => {
      const w = PHENOTYPES[key].w;
      index += w; chosen++;
      if (w >= HEAVY) heavy++;
      items.push({ key: key, label: PHENOTYPES[key].label, w: w });
    });

    Object.keys(COMPLEX).forEach((key) => {
      const w = exam.complex[key];
      if (!w) return;
      index += w; chosen++;
      if (w >= HEAVY) heavy++;
      const option = COMPLEX[key].options.find((o) => o.w === w);
      items.push({ key: key, label: COMPLEX[key].label, w: w, grade: option.label });
    });

    const aw = arachScore(exam.tests);
    if (aw) {
      index += aw; chosen++;
      if (aw >= HEAVY) heavy++;
      items.push({ key: 'arachnodactyly', label: ARACH_LABEL, w: aw,
                   grade: ARACH.find((a) => a.w === aw).label });
    }

    const anomalyItems = exam.anomalies.map((k) =>
      ({ key: k, label: ANOMALIES[k].label, w: ANOMALIES[k].w }));
    const degree = degreeOf(index);
    // Array.prototype.sort стабилен, как и sorted() в Python: порядок совпадёт
    items.sort((a, b) => b.w - a.w);

    return {
      index: index,
      chosen: chosen,
      heavy: heavy,
      degree: degree,
      degreeLabel: DEGREES[degree].label,
      anomalies: anomalyItems.length,
      anomalyPoints: anomalyItems.reduce((s, a) => s + a.w, 0),
      items: items,
      anomalyItems: anomalyItems,
      exam: exam
    };
  }

  window.NdstDst = {
    PHENOTYPES, COMPLEX, TESTS, ARACH, ARACH_LABEL, ANOMALIES, DEGREES, HEAVY,
    PARENT_MAP, PARENT_FORM, PARENT_GRADE,
    emptyExam, normalize, fromParent, arachScore, degreeOf, calculate
  };
})();
