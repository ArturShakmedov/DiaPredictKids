/* ==========================================================================
   NDST — три языка: русский, узбекский, английский

   Ключом служит сам русский текст: разметку размечать не нужно, движок
   обходит текстовые узлы и переводимые атрибуты. Русский остаётся
   в HTML как исходник и как запасной вариант, если перевода нет.

   Динамические блоки (результат анкеты, таблица кабинета) после отрисовки
   вызывают NdstI18n.apply(контейнер), а собранные из кусков строки —
   NdstI18n.t('Шаг {n} из 4', { n: 2 }).
   ========================================================================== */

(function () {
  'use strict';

  var LANGS = [
    { code: 'ru', label: 'RU', name: 'Русский' },
    { code: 'uz', label: 'UZ', name: "Oʻzbekcha" },
    { code: 'en', label: 'EN', name: 'English' }
  ];

  var STORE_KEY = 'ndst.lang';
  var D = { uz: {}, en: {} };
  var lang = 'ru';

  /* ======================================================================
     Движок
     ====================================================================== */

  function norm(t) {
    return String(t).replace(/\s+/g, ' ').trim();
  }

  function lookup(ru) {
    if (lang === 'ru') return null;
    var table = D[lang];
    return table && Object.prototype.hasOwnProperty.call(table, ru) ? table[ru] : null;
  }

  /** Перевод строки из JS. Поддерживает подстановки: t('Шаг {n} из 4', {n: 2}) */
  function t(ru, vars) {
    var out = lookup(norm(ru));
    out = out === null ? ru : out;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return out;
  }

  /* Формы числа и месяцы — обходом текста их не перевести */

  var PLURALS = {
    'год|года|лет': { uz: 'yosh', en: function (n) { return n === 1 ? 'year' : 'years'; } },
    'записи|записей|записей': { uz: 'yozuv', en: 'records' },
    'пациент|пациента|пациентов': { uz: 'bemor', en: 'patients' },
    'оценка|оценки|оценок': {
      uz: 'baho',
      en: function (n) { return n === 1 ? 'assessment' : 'assessments'; }
    }
  };

  function plural(n, forms) {
    if (lang !== 'ru') {
      var alt = PLURALS[forms.join('|')];
      var v = alt && alt[lang];
      if (typeof v === 'function') return v(n);
      if (v) return v;
      return forms[2];
    }
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  var MONTHS = {
    ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
    uz: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'],
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  };

  function months() { return MONTHS[lang] || MONTHS.ru; }

  var ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

  function translateAttrs(el) {
    ATTRS.forEach(function (a) {
      if (!el.hasAttribute(a)) return;
      if (!el.__i18nAttr) el.__i18nAttr = {};
      if (el.__i18nAttr[a] === undefined) el.__i18nAttr[a] = el.getAttribute(a);
      var src = el.__i18nAttr[a];
      var val = lookup(norm(src));
      el.setAttribute(a, val === null ? src : val);
    });
  }

  function translateText(node) {
    if (node.__i18nRu === undefined) node.__i18nRu = node.nodeValue;
    var src = node.__i18nRu;
    var val = lookup(norm(src));
    if (val === null) {
      node.nodeValue = src;                       // русский или нет перевода
      return;
    }
    var lead = src.match(/^\s*/)[0];
    var trail = src.match(/\s*$/)[0];
    node.nodeValue = lead + val + trail;          // отступы разметки сохраняем
  }

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1 };

  function apply(root) {
    var scope = root || document.body;
    if (!scope) return;

    if (scope.querySelectorAll) {
      scope.querySelectorAll('[placeholder],[aria-label],[title],[alt]').forEach(translateAttrs);
      if (scope.matches && scope.matches('[placeholder],[aria-label],[title],[alt]')) {
        translateAttrs(scope);
      }
    }

    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!p || SKIP_TAGS[p.nodeName]) return NodeFilter.FILTER_REJECT;
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        // translate="no" ставится ради браузерных переводчиков, но смысл
        // тот же — этот текст трогать нельзя, в том числе и нам
        if (p.closest && p.closest('[data-no-i18n], [translate="no"]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var node;
    while ((node = walker.nextNode())) translateText(node);
  }

  function applyHead() {
    var title = document.querySelector('title');
    if (title) translateText(title.firstChild || title.appendChild(document.createTextNode('')));
    var meta = document.querySelector('meta[name="description"]');
    if (meta) {
      if (meta.__i18nRu === undefined) meta.__i18nRu = meta.getAttribute('content');
      var v = lookup(norm(meta.__i18nRu));
      meta.setAttribute('content', v === null ? meta.__i18nRu : v);
    }
  }

  function setLang(code, silent) {
    if (!LANGS.some(function (l) { return l.code === code; })) code = 'ru';
    lang = code;
    try { localStorage.setItem(STORE_KEY, code); } catch (e) { /* приватный режим */ }
    document.documentElement.lang = code;
    applyHead();
    apply(document.body);
    syncSwitchers();
    if (!silent) document.dispatchEvent(new CustomEvent('dia:langchange', { detail: code }));
  }

  function detect() {
    var saved;
    try { saved = localStorage.getItem(STORE_KEY); } catch (e) { saved = null; }
    if (saved && LANGS.some(function (l) { return l.code === saved; })) return saved;
    var nav = (navigator.language || 'ru').slice(0, 2).toLowerCase();
    if (nav === 'uz') return 'uz';
    if (nav === 'en') return 'en';
    return 'ru';
  }

  /* ======================================================================
     Переключатель
     ====================================================================== */

  function buildSwitcher(extraClass) {
    var box = document.createElement('div');
    box.className = 'lang-switch' + (extraClass ? ' ' + extraClass : '');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Язык интерфейса');
    box.setAttribute('data-no-i18n', '');
    LANGS.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lang-switch__btn';
      b.dataset.lang = l.code;
      b.textContent = l.label;
      b.title = l.name;
      b.addEventListener('click', function () { setLang(l.code); });
      box.appendChild(b);
    });
    return box;
  }

  function syncSwitchers() {
    document.querySelectorAll('.lang-switch__btn').forEach(function (b) {
      var on = b.dataset.lang === lang;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function mountSwitchers() {
    var mounted = 0;

    var header = document.querySelector('.header__actions');
    if (header) { header.insertBefore(buildSwitcher(), header.firstChild); mounted++; }

    var topbar = document.querySelector('.topbar__actions');
    if (topbar) { topbar.insertBefore(buildSwitcher(), topbar.firstChild); mounted++; }

    var menu = document.querySelector('.mobile-menu__cta');
    if (menu) { menu.insertBefore(buildSwitcher('lang-switch--wide'), menu.firstChild); mounted++; }

    // произвольная точка монтирования: <div data-lang-mount></div>
    var slots = document.querySelectorAll('[data-lang-mount]');
    for (var i = 0; i < slots.length; i++) {
      slots[i].appendChild(buildSwitcher('lang-switch--wide'));
      mounted++;
    }

    // страницы без шапки — вход и 404
    var card = document.querySelector('.auth__card');
    if (!mounted && card) {
      var box = document.createElement('div');
      box.className = 'auth__lang';
      box.appendChild(buildSwitcher());
      card.appendChild(box);
    }
  }

  /* ======================================================================
     Словарь
     ====================================================================== */

  /* ---------------------------- Лендинг ------------------------------- */

  Object.assign(D.uz, {
    'NDST — раннее выявление риска сахарного диабета у детей':
      'NDST — bolalarda qandli diabet xavfini erta aniqlash',
    'NDST — платформа для ранней оценки факторов риска сахарного диабета у детей. Структурированный скрининг за несколько минут с понятным объяснением результата.':
      'NDST — bolalarda qandli diabet xavf omillarini erta baholash platformasi. Bir necha daqiqada tuzilgan skrining va natijaning tushunarli izohi.',
    'NDST — на главную': 'NDST — bosh sahifaga',
    'Основная навигация': 'Asosiy navigatsiya',
    'Меню': 'Menyu',
    'Мобильная навигация': 'Mobil navigatsiya',
    'О проекте': 'Loyiha haqida',
    'Симптомы': 'Alomatlar',
    'Как это работает': 'Bu qanday ishlaydi',
    'Для врачей': 'Shifokorlar uchun',
    'Оценить риск': 'Xavfni baholash',
    'Разделы': "Boʻlimlar",
    'Инструменты': 'Vositalar',
    'Оценка риска': 'Xavfni baholash',
    'Кабинет врача': 'Shifokor kabineti',
    'Занимает около пяти минут · без регистрации': "Taxminan besh daqiqa · roʻyxatdan oʻtmasdan",
    'Скрининговая платформа': 'Skrining platformasi',
    /* H1 состоит из трёх кусков: [1] <span>[2]</span> [3].
       В узбекском естественный порядок слов другой, поэтому значения смещены:
       вместе они читаются «Bolalarda qandli diabetni erta aniqlash texnologiyasi». */
    'NDST собирает симптомы и факторы риска ребёнка в единую структурированную оценку и показывает, какие именно признаки повлияли на результат — чтобы вы вовремя обратились к врачу, а не заметили проблему по факту.':
      "NDST bolaning alomatlari va xavf omillarini yagona tuzilgan baholashga jamlaydi va aynan qaysi belgilar natijaga ta'sir qilganini koʻrsatadi — shifokorga oʻz vaqtida murojaat qilishingiz uchun.",
    'минут': 'daqiqa',
    'занимает прохождение анкеты': "soʻrovnomani toʻldirishga ketadi",
    'признаков': 'belgi',
    'симптомы, анамнез и образ жизни': 'alomatlar, anamnez va turmush tarzi',
    'Локально': 'Qurilmada',
    'расчёт в браузере, ничего не отправляется': "hisob brauzerda, hech narsa yuborilmaydi",
    'Глюкоза': 'Glyukoza',
    'ммоль/л': 'mmol/l',
    'ИМТ': 'TVI',
    'Норма': 'Meʼyor',
    'Пример интерфейса. Фото: модель, показатели демонстрационные.':
      "Interfeys namunasi. Surat: model, koʻrsatkichlar namoyish uchun.",
    'Диабет у детей часто выявляют слишком поздно':
      "Bolalarda diabet koʻpincha juda kech aniqlanadi",
    'Первые признаки — жажда, частое мочеиспускание, потеря веса, утомляемость — легко принять за переходный возраст, стресс или простуду. NDST помогает родителю собрать эти наблюдения в одну картину и понять, нужен ли визит к врачу сейчас.':
      "Dastlabki belgilar — chanqash, tez-tez siydik ajratish, vazn yoʻqotish, holsizlik — oʻsmirlik davri, stress yoki shamollash deb oʻylanishi mumkin. NDST ota-onaga bu kuzatuvlarni bitta manzaraga jamlashga va shifokorga hozir borish kerakmi degan savolga javob topishga yordam beradi.",
    'Принципы системы': 'Tizim tamoyillari',
    '04 позиции': '04 ta band',
    'Точность': 'Aniqlik',
    'Оценка строится на признанных клинических факторах риска, а не на общих ощущениях.':
      "Baholash umumiy taassurotga emas, tan olingan klinik xavf omillariga asoslanadi.",
    '20 признаков · веса по значимости': '20 belgi · ahamiyat boʻyicha vaznlar',
    'Безопасность': 'Xavfsizlik',
    'Ответы обрабатываются локально в браузере и никуда не отправляются.':
      'Javoblar brauzerda lokal qayta ishlanadi va hech qayerga yuborilmaydi.',
    '0 запросов на сервер': "0 ta soʻrov serverga",
    'Скорость': 'Tezlik',
    'Полная анкета занимает около пяти минут — четыре коротких шага.':
      "Toʻliq soʻrovnoma taxminan besh daqiqa — toʻrtta qisqa qadam.",
    '4 шага · ~5 минут': '4 qadam · ~5 daqiqa',
    'Научный подход': 'Ilmiy yondashuv',
    'Веса факторов опираются на клинические рекомендации по диагностике СД у детей.':
      "Omillar vazni bolalarda qandli diabet tashxisi boʻyicha klinik tavsiyalarga asoslanadi.",
    'ИМТ по перцентилям CDC': 'TVI CDC pertsentillari boʻyicha',
    'На что обратить внимание у ребёнка': "Bolada nimaga e'tibor berish kerak",
    'Классические признаки развиваются постепенно и по отдельности выглядят безобидно. Значение имеет их сочетание и то, что раньше такого не было.':
      "Klassik belgilar asta-sekin rivojlanadi va alohida-alohida zararsiz koʻrinadi. Ularning birgalikda uchrashi va ilgari bunday boʻlmagani muhim.",
    'Классические признаки': 'Klassik belgilar',
    '08 позиций · шаг 02 анкеты': "08 ta band · soʻrovnomaning 02-qadami",
    'Сильная жажда': 'Kuchli chanqash',
    'Ребёнок пьёт заметно больше обычного, в том числе ночью.':
      "Bola odatdagidan ancha koʻp suv ichadi, kechasi ham.",
    'Частое мочеиспускание': 'Tez-tez siydik ajratish',
    'Учащённые походы в туалет, большие объёмы мочи.':
      "Hojatxonaga tez-tez borish, siydik miqdorining koʻpayishi.",
    'Ночное недержание': 'Tunda siyib qoʻyish',
    'Появилось снова у ребёнка, который уже давно сухой ночью.':
      "Uzoq vaqt quruq uxlagan bolada yana paydo boʻldi.",
    'Потеря веса': 'Vazn yoʻqotish',
    'Вес снижается при обычном или даже повышенном аппетите.':
      'Ishtaha odatdagidek yoki hatto oshgan holda vazn kamaymoqda.',
    'Утомляемость': 'Holsizlik',
    'Вялость, сонливость, снижение активности и успеваемости.':
      "Lanjlik, uyquchanlik, faollik va oʻzlashtirishning pasayishi.",
    'Нечёткое зрение': 'Xira koʻrish',
    'Жалобы на «размытость», трудно рассмотреть доску или текст.':
      "«Xiralik»dan shikoyat, doska yoki matnni koʻrish qiyin.",
    'Долгое заживление': 'Yaralarning sekin bitishi',
    'Ранки и царапины заживают дольше обычного, повторяются инфекции.':
      'Jarohat va tirnalgan joylar odatdagidan sekin bitadi, infeksiyalar takrorlanadi.',
    'Изменение аппетита': 'Ishtahaning oʻzgarishi',
    'Постоянное чувство голода или, наоборот, отказ от еды и тошнота.':
      "Doimiy ochlik hissi yoki aksincha, ovqatdan bosh tortish va koʻngil aynishi.",
    'Когда нельзя ждать и нужна срочная помощь':
      'Qachon kutib boʻlmaydi va shoshilinch yordam kerak',
    'Немедленно обратитесь за медицинской помощью, если у ребёнка появились:':
      'Bolada quyidagilar paydo boʻlsa, zudlik bilan tibbiy yordamga murojaat qiling:',
    'частое и глубокое дыхание, запах ацетона изо рта;':
      'tez va chuqur nafas olish, ogʻizdan atseton hidi;',
    'многократная рвота, боль в животе, выраженная слабость;':
      'takroriy qusish, qorin ogʻrigʻi, kuchli holsizlik;',
    'спутанность сознания, сонливость, которую трудно прервать;':
      'ongning chalkashishi, uygʻotish qiyin boʻlgan uyquchanlik;',
    'признаки обезвоживания на фоне сильной жажды.':
      'kuchli chanqash fonida suvsizlanish belgilari.',
    'Это возможные признаки диабетического кетоацидоза — состояния, требующего неотложной помощи.':
      "Bu diabetik ketoatsidozning mumkin boʻlgan belgilari — shoshilinch yordam talab qiladigan holat.",
    'Четыре шага от анкеты до понятного результата':
      "Soʻrovnomadan tushunarli natijagacha toʻrt qadam",
    'Маршрут оценки': 'Baholash yoʻli',
    '~5 минут': '~5 daqiqa',
    'О ребёнке': 'Bola haqida',
    'Возраст, пол, рост и вес. Система рассчитывает ИМТ и сравнивает его с возрастной нормой.':
      "Yosh, jins, boʻy va vazn. Tizim TVIni hisoblab, yosh me'yori bilan solishtiradi.",
    'возраст · пол · рост · вес': 'yosh · jins · boʻy · vazn',
    'Отмечаете признаки, которые наблюдали в последнее время, и их длительность.':
      'Soʻnggi paytda kuzatilgan belgilarni va ular qancha davom etganini belgilaysiz.',
    '10 признаков · длительность': '10 belgi · davomiylik',
    'Факторы риска': 'Xavf omillari',
    'Семейный анамнез, течение беременности и родов, образ жизни ребёнка.':
      'Oilaviy anamnez, homiladorlik va tugʻruq kechishi, bolaning turmush tarzi.',
    '10 факторов · анамнез': '10 omil · anamnez',
    'Результат': 'Natija',
    'Уровень риска, перечень повлиявших факторов и конкретные рекомендации по действиям.':
      "Xavf darajasi, ta'sir qilgan omillar roʻyxati va aniq tavsiyalar.",
    'оценка 0–100 · 3 уровня': 'baho 0–100 · 3 daraja',
    'Важно:': 'Muhim:',
    'результат является оценкой факторов риска и не является медицинским диагнозом. Для постановки диагноза необходимо обратиться к врачу.':
      'natija xavf omillarining bahosi boʻlib, tibbiy tashxis emas. Tashxis qoʻyish uchun shifokorga murojaat qilish kerak.',
    'Прозрачность оценки': 'Baholashning shaffofligi',
    'Вы видите не только цифру, но и её причину':
      'Siz nafaqat raqamni, balki uning sababini ham koʻrasiz',
    'Голый процент ничего не объясняет и только пугает. NDST показывает, какие именно ответы повысили оценку, а какие настораживающие признаки отсутствуют.':
      'Yalangʻoch foiz hech narsani tushuntirmaydi va faqat qoʻrqitadi. NDST qaysi javoblar bahoni oshirganini va qaysi xavotirli belgilar yoʻqligini koʻrsatadi.',
    'Разбор по факторам': 'Omillar boʻyicha tahlil',
    'Каждый учтённый признак — с его вкладом в итоговую оценку.':
      'Har bir hisobga olingan belgi — yakuniy bahoga qoʻshgan hissasi bilan.',
    'Что не обнаружено': 'Nima aniqlanmadi',
    'Отсутствующие тревожные признаки перечисляются отдельно — это тоже информация.':
      'Yoʻq boʻlgan xavotirli belgilar alohida sanab oʻtiladi — bu ham axborot.',
    'Сводка для врача': 'Shifokor uchun xulosa',
    'Результат можно распечатать или сохранить и взять с собой на приём.':
      'Natijani chop etish yoki saqlab, qabulga olib borish mumkin.',
    'Результат оценки': 'Baholash natijasi',
    'Анализ завершён': 'Tahlil yakunlandi',
    'Умеренный риск': 'Oʻrtacha xavf',
    'Рекомендована консультация педиатра': 'Pediatr maslahati tavsiya etiladi',
    'Обратитесь к врачу в ближайшие дни и обсудите обследование.':
      'Yaqin kunlarda shifokorga murojaat qiling va tekshiruvni muhokama qiling.',
    'Повышенная жажда': 'Kuchaygan chanqash',
    'Семейный анамнез': 'Oilaviy anamnez',
    'Потеря веса не отмечена': 'Vazn yoʻqotish qayd etilmagan',
    'Пример интерфейса. Данные демонстрационные.':
      'Interfeys namunasi. Maʼlumotlar namoyish uchun.',
    'Контекст задачи': 'Masala konteksti',
    'Почему ранний скрининг важен': 'Nega erta skrining muhim',
    '1,5 млн+': '1,5 mln+',
    'детей и подростков в мире живут с сахарным диабетом 1 типа':
      'dunyoda bola va oʻsmir 1-tur qandli diabet bilan yashaydi',
    'По данным IDF Diabetes Atlas': 'IDF Diabetes Atlas maʼlumotlariga koʻra',
    'детей на момент постановки диагноза поступают с кетоацидозом — то есть болезнь выявляют уже на поздней стадии':
      'bolalar tashxis qoʻyilgan paytda ketoatsidoz bilan keladi — yaʼni kasallik kech bosqichda aniqlanadi',
    'Доля заметно различается между странами и регионами':
      'Bu ulush mamlakat va mintaqalarga qarab sezilarli farq qiladi',
    'Как баллы превращаются в оценку': 'Ballar bahoga qanday aylanadi',
    'Реальная кривая расчёта: первые значимые признаки дают наибольший прирост, дальше рост замедляется.':
      'Haqiqiy hisob egri chizigʻi: dastlabki muhim belgilar eng katta oʻsish beradi, keyin oʻsish sekinlashadi.',
    'Кабинет врача: скрининг превращается в рабочий инструмент':
      'Shifokor kabineti: skrining ish quroliga aylanadi',
    'Педиатр или эндокринолог видит поток оценок по своим пациентам, может отфильтровать группу высокого риска и не потерять ребёнка, которому нужно повторное наблюдение.':
      'Pediatr yoki endokrinolog oʻz bemorlari boʻyicha baholar oqimini koʻradi, yuqori xavf guruhini ajratib olishi va takroriy kuzatuv kerak boʻlgan bolani qoʻldan chiqarmasligi mumkin.',
    'Единый список пациентов и история их оценок':
      'Yagona bemorlar roʻyxati va ularning baholar tarixi',
    'Сводная статистика по распределению риска':
      'Xavf taqsimoti boʻyicha umumiy statistika',
    'Отметка пациентов, требующих повторного контроля':
      'Takroriy nazorat talab qiladigan bemorlarni belgilash',
    'Выгрузка результатов в медицинскую документацию':
      'Natijalarni tibbiy hujjatlarga yuklab olish',
    'Посмотреть демо кабинета': 'Kabinet demosini koʻrish',
    'Пациентов': 'Bemorlar',
    'Оценок': 'Baholar',
    'Высокий риск': 'Yuqori xavf',
    'На контроле': 'Nazoratda',
    'Пациент': 'Bemor',
    'Возраст': 'Yosh',
    'Риск': 'Xavf',
    'Оценка': 'Baho',
    '9 лет': '9 yosh',
    'Высокий': 'Yuqori',
    '6 лет': '6 yosh',
    'Умеренный': 'Oʻrtacha',
    '13 лет': '13 yosh',
    'Низкий': 'Past',
    'Пример интерфейса. Пациенты вымышленные.':
      'Interfeys namunasi. Bemorlar toʻqib chiqarilgan.',
    'Вопросы': 'Savollar',
    'Частые вопросы': 'Koʻp beriladigan savollar',
    'Это заменяет визит к врачу?': 'Bu shifokorga borishni almashtiradimi?',
    'Нет. NDST — скрининговый инструмент. Он помогает структурировать наблюдения и понять, насколько срочно нужен приём. Диагноз ставит только врач на основании осмотра и лабораторных исследований.':
      'Yoʻq. NDST — skrining vositasi. U kuzatuvlarni tartibga solishga va qabul qanchalik shoshilinch kerakligini tushunishga yordam beradi. Tashxisni faqat shifokor koʻrik va laboratoriya tekshiruvlari asosida qoʻyadi.',
    'Куда попадают ответы из анкеты?': 'Soʻrovnoma javoblari qayerga tushadi?',
    'Никуда. Расчёт выполняется в вашем браузере, ответы не отправляются на сервер и не сохраняются после закрытия вкладки. Регистрация не требуется.':
      'Hech qayerga. Hisob sizning brauzeringizda bajariladi, javoblar serverga yuborilmaydi va oyna yopilgach saqlanmaydi. Roʻyxatdan oʻtish talab etilmaydi.',
    'Как считается оценка риска?': 'Xavf bahosi qanday hisoblanadi?',
    'Каждому ответу соответствует вес, отражающий клиническую значимость признака: классические симптомы весят больше, чем факторы образа жизни. Сумма весов переводится в шкалу 0–100 и в один из трёх уровней риска. Все учтённые факторы с их вкладом показываются на экране результата.':
      'Har bir javobga belgining klinik ahamiyatini aks ettiruvchi vazn mos keladi: klassik alomatlar turmush tarzi omillaridan koʻra ogʻirroq. Vaznlar yigʻindisi 0–100 shkalasiga va uchta xavf darajasidan biriga oʻtkaziladi. Barcha hisobga olingan omillar hissasi bilan natija ekranida koʻrsatiladi.',
    'Для какого возраста подходит анкета?': 'Soʻrovnoma qaysi yosh uchun mos?',
    'Анкета рассчитана на детей и подростков от 1 года до 17 лет. Для детей до года оценка не проводится — при любых тревожных симптомах у младенца нужно сразу обращаться к педиатру.':
      'Soʻrovnoma 1 yoshdan 17 yoshgacha boʻlgan bolalar va oʻsmirlar uchun. Bir yoshgacha boʻlgan chaqaloqlar uchun baholash oʻtkazilmaydi — har qanday xavotirli alomatda darhol pediatrga murojaat qilish kerak.',
    'Что делать с результатом?': 'Natija bilan nima qilish kerak?',
    'Сохраните или распечатайте сводку и покажите её педиатру. В ней перечислены отмеченные симптомы и факторы риска — это экономит время на приёме и снижает вероятность, что важная деталь будет забыта.':
      'Xulosani saqlang yoki chop eting va pediatrga koʻrsating. Unda belgilangan alomatlar va xavf omillari sanab oʻtilgan — bu qabulda vaqtni tejaydi va muhim tafsilot unutilish ehtimolini kamaytiradi.',
    'Бесплатно · без регистрации': 'Bepul · roʻyxatdan oʻtmasdan',
    'Оцените риск у своего ребёнка за пять минут':
      'Farzandingizdagi xavfni besh daqiqada baholang',
    'Четыре шага, понятный результат и конкретные рекомендации по дальнейшим действиям.':
      'Toʻrt qadam, tushunarli natija va keyingi harakatlar boʻyicha aniq tavsiyalar.',
    'Начать оценку': 'Baholashni boshlash',
    'Изучить симптомы': 'Alomatlarni oʻrganish',
    'Платформа ранней оценки факторов риска сахарного диабета у детей. Создана, чтобы родитель и врач заметили проблему вовремя.':
      'Bolalarda qandli diabet xavf omillarini erta baholash platformasi. Ota-ona va shifokor muammoni oʻz vaqtida payqashi uchun yaratilgan.',
    'Продукт': 'Mahsulot',
    'Информация': 'Axborot',
    'Вопросы и ответы': 'Savol va javoblar',
    'Контакты': 'Aloqa',
    'Сотрудничество с клиниками': 'Klinikalar bilan hamkorlik',
    'материалы сайта и результат оценки носят информационный характер, не являются медицинским диагнозом и не заменяют консультацию врача. При появлении тревожных симптомов у ребёнка обратитесь к педиатру или эндокринологу.':
      'sayt materiallari va baholash natijasi axborot xarakteriga ega, tibbiy tashxis emas va shifokor maslahatini almashtirmaydi. Bolada xavotirli alomatlar paydo boʻlsa, pediatr yoki endokrinologga murojaat qiling.',
    '© 2026 NDST': '© 2026 NDST',
    'Фото: Jennifer Kalenberg / Unsplash · Сделано для раннего выявления диабета у детей':
      'Surat: Jennifer Kalenberg / Unsplash · Bolalarda diabetni erta aniqlash uchun yaratilgan'
  });

  Object.assign(D.en, {
    'NDST — раннее выявление риска сахарного диабета у детей':
      'NDST — early detection of diabetes risk in children',
    'NDST — платформа для ранней оценки факторов риска сахарного диабета у детей. Структурированный скрининг за несколько минут с понятным объяснением результата.':
      'NDST is a platform for early assessment of diabetes risk factors in children. A structured screening in a few minutes, with a clear explanation of the result.',
    'NDST — на главную': 'NDST — home',
    'Основная навигация': 'Main navigation',
    'Меню': 'Menu',
    'Мобильная навигация': 'Mobile navigation',
    'О проекте': 'About',
    'Симптомы': 'Symptoms',
    'Как это работает': 'How it works',
    'Для врачей': 'For clinicians',
    'Оценить риск': 'Check the risk',
    'Разделы': 'Sections',
    'Инструменты': 'Tools',
    'Оценка риска': 'Risk assessment',
    'Кабинет врача': 'Clinician dashboard',
    'Занимает около пяти минут · без регистрации': 'About five minutes · no sign-up',
    'Скрининговая платформа': 'Screening platform',
    'NDST собирает симптомы и факторы риска ребёнка в единую структурированную оценку и показывает, какие именно признаки повлияли на результат — чтобы вы вовремя обратились к врачу, а не заметили проблему по факту.':
      'NDST gathers a child’s symptoms and risk factors into one structured assessment and shows exactly which signs shaped the result — so you see a doctor in time instead of noticing the problem after the fact.',
    'минут': 'minutes',
    'занимает прохождение анкеты': 'to complete the questionnaire',
    'признаков': 'signs',
    'симптомы, анамнез и образ жизни': 'symptoms, history and lifestyle',
    'Локально': 'On-device',
    'расчёт в браузере, ничего не отправляется': 'computed in your browser, nothing is sent',
    'Глюкоза': 'Glucose',
    'ммоль/л': 'mmol/L',
    'ИМТ': 'BMI',
    'Норма': 'Normal',
    'Пример интерфейса. Фото: модель, показатели демонстрационные.':
      'Interface example. Photo: model; figures are illustrative.',
    'Диабет у детей часто выявляют слишком поздно':
      'Diabetes in children is too often caught late',
    'Первые признаки — жажда, частое мочеиспускание, потеря веса, утомляемость — легко принять за переходный возраст, стресс или простуду. NDST помогает родителю собрать эти наблюдения в одну картину и понять, нужен ли визит к врачу сейчас.':
      'The first signs — thirst, frequent urination, weight loss, fatigue — are easily mistaken for growing pains, stress or a cold. NDST helps a parent put these observations together and judge whether a doctor’s visit is needed now.',
    'Принципы системы': 'System principles',
    '04 позиции': '04 items',
    'Точность': 'Accuracy',
    'Оценка строится на признанных клинических факторах риска, а не на общих ощущениях.':
      'The assessment is built on recognised clinical risk factors, not on general impressions.',
    '20 признаков · веса по значимости': '20 signs · weighted by significance',
    'Безопасность': 'Privacy',
    'Ответы обрабатываются локально в браузере и никуда не отправляются.':
      'Answers are processed locally in your browser and are never sent anywhere.',
    '0 запросов на сервер': '0 server requests',
    'Скорость': 'Speed',
    'Полная анкета занимает около пяти минут — четыре коротких шага.':
      'The full questionnaire takes about five minutes — four short steps.',
    '4 шага · ~5 минут': '4 steps · ~5 minutes',
    'Научный подход': 'Evidence-based',
    'Веса факторов опираются на клинические рекомендации по диагностике СД у детей.':
      'Factor weights follow clinical guidance on diagnosing diabetes in children.',
    'ИМТ по перцентилям CDC': 'BMI by CDC percentiles',
    'На что обратить внимание у ребёнка': 'What to watch for in your child',
    'Классические признаки развиваются постепенно и по отдельности выглядят безобидно. Значение имеет их сочетание и то, что раньше такого не было.':
      'The classic signs develop gradually and look harmless on their own. What matters is their combination — and that they were not there before.',
    'Классические признаки': 'Classic signs',
    '08 позиций · шаг 02 анкеты': '08 items · step 02 of the questionnaire',
    'Сильная жажда': 'Intense thirst',
    'Ребёнок пьёт заметно больше обычного, в том числе ночью.':
      'The child drinks noticeably more than usual, including at night.',
    'Частое мочеиспускание': 'Frequent urination',
    'Учащённые походы в туалет, большие объёмы мочи.':
      'More frequent trips to the toilet, larger volumes of urine.',
    'Ночное недержание': 'Bedwetting',
    'Появилось снова у ребёнка, который уже давно сухой ночью.':
      'Returned in a child who has long been dry at night.',
    'Потеря веса': 'Weight loss',
    'Вес снижается при обычном или даже повышенном аппетите.':
      'Weight is dropping despite a normal or even increased appetite.',
    'Утомляемость': 'Fatigue',
    'Вялость, сонливость, снижение активности и успеваемости.':
      'Lethargy, sleepiness, less activity and slipping school performance.',
    'Нечёткое зрение': 'Blurred vision',
    'Жалобы на «размытость», трудно рассмотреть доску или текст.':
      'Complaints of blurriness; trouble reading the board or text.',
    'Долгое заживление': 'Slow healing',
    'Ранки и царапины заживают дольше обычного, повторяются инфекции.':
      'Cuts and scratches heal more slowly than usual; infections recur.',
    'Изменение аппетита': 'Appetite changes',
    'Постоянное чувство голода или, наоборот, отказ от еды и тошнота.':
      'Constant hunger or, conversely, refusing food and feeling nauseous.',
    'Когда нельзя ждать и нужна срочная помощь':
      'When not to wait — seek urgent care',
    'Немедленно обратитесь за медицинской помощью, если у ребёнка появились:':
      'Seek medical help immediately if your child develops:',
    'частое и глубокое дыхание, запах ацетона изо рта;':
      'rapid, deep breathing and an acetone smell on the breath;',
    'многократная рвота, боль в животе, выраженная слабость;':
      'repeated vomiting, abdominal pain, marked weakness;',
    'спутанность сознания, сонливость, которую трудно прервать;':
      'confusion, or drowsiness that is hard to rouse them from;',
    'признаки обезвоживания на фоне сильной жажды.':
      'signs of dehydration alongside intense thirst.',
    'Это возможные признаки диабетического кетоацидоза — состояния, требующего неотложной помощи.':
      'These may be signs of diabetic ketoacidosis — a condition requiring emergency care.',
    'Четыре шага от анкеты до понятного результата':
      'Four steps from questionnaire to a result you can act on',
    'Маршрут оценки': 'Assessment path',
    '~5 минут': '~5 minutes',
    'О ребёнке': 'About the child',
    'Возраст, пол, рост и вес. Система рассчитывает ИМТ и сравнивает его с возрастной нормой.':
      'Age, sex, height and weight. The system computes BMI and compares it with the age reference.',
    'возраст · пол · рост · вес': 'age · sex · height · weight',
    'Отмечаете признаки, которые наблюдали в последнее время, и их длительность.':
      'You tick the signs you have noticed recently and how long they have lasted.',
    '10 признаков · длительность': '10 signs · duration',
    'Факторы риска': 'Risk factors',
    'Семейный анамнез, течение беременности и родов, образ жизни ребёнка.':
      'Family history, pregnancy and birth, the child’s lifestyle.',
    '10 факторов · анамнез': '10 factors · history',
    'Результат': 'Result',
    'Уровень риска, перечень повлиявших факторов и конкретные рекомендации по действиям.':
      'The risk level, the factors that shaped it, and concrete next steps.',
    'оценка 0–100 · 3 уровня': 'score 0–100 · 3 levels',
    'Важно:': 'Important:',
    'результат является оценкой факторов риска и не является медицинским диагнозом. Для постановки диагноза необходимо обратиться к врачу.':
      'the result is an assessment of risk factors, not a medical diagnosis. A diagnosis can only be made by a doctor.',
    'Прозрачность оценки': 'A transparent score',
    'Вы видите не только цифру, но и её причину':
      'You see not just a number, but the reason behind it',
    'Голый процент ничего не объясняет и только пугает. NDST показывает, какие именно ответы повысили оценку, а какие настораживающие признаки отсутствуют.':
      'A bare percentage explains nothing and only frightens. NDST shows exactly which answers raised the score — and which warning signs are absent.',
    'Разбор по факторам': 'Factor breakdown',
    'Каждый учтённый признак — с его вкладом в итоговую оценку.':
      'Every sign counted, with its contribution to the final score.',
    'Что не обнаружено': 'What was not found',
    'Отсутствующие тревожные признаки перечисляются отдельно — это тоже информация.':
      'Absent warning signs are listed separately — that is information too.',
    'Сводка для врача': 'A summary for the doctor',
    'Результат можно распечатать или сохранить и взять с собой на приём.':
      'The result can be printed or saved and brought to the appointment.',
    'Результат оценки': 'Assessment result',
    'Анализ завершён': 'Analysis complete',
    'Умеренный риск': 'Moderate risk',
    'Рекомендована консультация педиатра': 'A paediatric consultation is advised',
    'Обратитесь к врачу в ближайшие дни и обсудите обследование.':
      'See a doctor in the next few days and discuss testing.',
    'Повышенная жажда': 'Increased thirst',
    'Семейный анамнез': 'Family history',
    'Потеря веса не отмечена': 'No weight loss reported',
    'Пример интерфейса. Данные демонстрационные.':
      'Interface example. Data is illustrative.',
    'Контекст задачи': 'Why it matters',
    'Почему ранний скрининг важен': 'Why early screening matters',
    '1,5 млн+': '1.5M+',
    'детей и подростков в мире живут с сахарным диабетом 1 типа':
      'children and adolescents worldwide live with type 1 diabetes',
    'По данным IDF Diabetes Atlas': 'Source: IDF Diabetes Atlas',
    'детей на момент постановки диагноза поступают с кетоацидозом — то есть болезнь выявляют уже на поздней стадии':
      'of children present with ketoacidosis at diagnosis — meaning the disease is caught late',
    'Доля заметно различается между странами и регионами':
      'The share varies considerably between countries and regions',
    'Как баллы превращаются в оценку': 'How points become a score',
    'Реальная кривая расчёта: первые значимые признаки дают наибольший прирост, дальше рост замедляется.':
      'The actual calculation curve: the first significant signs add the most, then growth slows.',
    'Кабинет врача: скрининг превращается в рабочий инструмент':
      'Clinician dashboard: screening becomes a working tool',
    'Педиатр или эндокринолог видит поток оценок по своим пациентам, может отфильтровать группу высокого риска и не потерять ребёнка, которому нужно повторное наблюдение.':
      'A paediatrician or endocrinologist sees the flow of assessments for their patients, can filter the high-risk group, and will not lose track of a child who needs follow-up.',
    'Единый список пациентов и история их оценок':
      'One patient list with the history of their assessments',
    'Сводная статистика по распределению риска':
      'Summary statistics on risk distribution',
    'Отметка пациентов, требующих повторного контроля':
      'Flagging patients who need follow-up',
    'Выгрузка результатов в медицинскую документацию':
      'Exporting results into medical records',
    'Посмотреть демо кабинета': 'See the dashboard demo',
    'Пациентов': 'Patients',
    'Оценок': 'Assessments',
    'Высокий риск': 'High risk',
    'На контроле': 'Follow-up',
    'Пациент': 'Patient',
    'Возраст': 'Age',
    'Риск': 'Risk',
    'Оценка': 'Assessed',
    '9 лет': '9 yrs',
    'Высокий': 'High',
    '6 лет': '6 yrs',
    'Умеренный': 'Moderate',
    '13 лет': '13 yrs',
    'Низкий': 'Low',
    'Пример интерфейса. Пациенты вымышленные.':
      'Interface example. Patients are fictional.',
    'Вопросы': 'Questions',
    'Частые вопросы': 'Frequently asked questions',
    'Это заменяет визит к врачу?': 'Does this replace seeing a doctor?',
    'Нет. NDST — скрининговый инструмент. Он помогает структурировать наблюдения и понять, насколько срочно нужен приём. Диагноз ставит только врач на основании осмотра и лабораторных исследований.':
      'No. NDST is a screening tool. It helps structure your observations and judge how urgently an appointment is needed. Only a doctor can diagnose, based on examination and laboratory tests.',
    'Куда попадают ответы из анкеты?': 'Where do the questionnaire answers go?',
    'Никуда. Расчёт выполняется в вашем браузере, ответы не отправляются на сервер и не сохраняются после закрытия вкладки. Регистрация не требуется.':
      'Nowhere. The calculation runs in your browser; answers are not sent to a server and are not kept after you close the tab. No sign-up is required.',
    'Как считается оценка риска?': 'How is the risk score calculated?',
    'Каждому ответу соответствует вес, отражающий клиническую значимость признака: классические симптомы весят больше, чем факторы образа жизни. Сумма весов переводится в шкалу 0–100 и в один из трёх уровней риска. Все учтённые факторы с их вкладом показываются на экране результата.':
      'Each answer carries a weight reflecting the clinical significance of that sign: classic symptoms weigh more than lifestyle factors. The sum of weights maps onto a 0–100 scale and one of three risk levels. Every factor counted is shown with its contribution on the result screen.',
    'Для какого возраста подходит анкета?': 'What ages is the questionnaire for?',
    'Анкета рассчитана на детей и подростков от 1 года до 17 лет. Для детей до года оценка не проводится — при любых тревожных симптомах у младенца нужно сразу обращаться к педиатру.':
      'The questionnaire is designed for children and adolescents aged 1 to 17. It is not used for infants under one year — with any worrying symptom in a baby, see a paediatrician straight away.',
    'Что делать с результатом?': 'What should I do with the result?',
    'Сохраните или распечатайте сводку и покажите её педиатру. В ней перечислены отмеченные симптомы и факторы риска — это экономит время на приёме и снижает вероятность, что важная деталь будет забыта.':
      'Save or print the summary and show it to your paediatrician. It lists the symptoms and risk factors you marked — saving time at the appointment and making it less likely that an important detail is forgotten.',
    'Бесплатно · без регистрации': 'Free · no sign-up',
    'Оцените риск у своего ребёнка за пять минут':
      'Check your child’s risk in five minutes',
    'Четыре шага, понятный результат и конкретные рекомендации по дальнейшим действиям.':
      'Four steps, a clear result, and concrete recommendations on what to do next.',
    'Начать оценку': 'Start the assessment',
    'Изучить симптомы': 'Read about the symptoms',
    'Платформа ранней оценки факторов риска сахарного диабета у детей. Создана, чтобы родитель и врач заметили проблему вовремя.':
      'A platform for the early assessment of diabetes risk factors in children. Built so that parents and doctors notice the problem in time.',
    'Продукт': 'Product',
    'Информация': 'Information',
    'Вопросы и ответы': 'Questions and answers',
    'Контакты': 'Contact',
    'Сотрудничество с клиниками': 'Partnering with clinics',
    'материалы сайта и результат оценки носят информационный характер, не являются медицинским диагнозом и не заменяют консультацию врача. При появлении тревожных симптомов у ребёнка обратитесь к педиатру или эндокринологу.':
      'the content of this site and the assessment result are informational only. They are not a medical diagnosis and do not replace a doctor’s advice. If your child develops worrying symptoms, see a paediatrician or endocrinologist.',
    '© 2026 NDST': '© 2026 NDST',
    'Фото: Jennifer Kalenberg / Unsplash · Сделано для раннего выявления диабета у детей':
      'Photo: Jennifer Kalenberg / Unsplash · Built for the early detection of diabetes in children'
  });

  /* ---------------------------- Анкета -------------------------------- */

  Object.assign(D.uz, {
    'Оценка риска — NDST': 'Xavfni baholash — NDST',
    'Четыре шага: данные о ребёнке, симптомы, факторы риска и понятный результат с разбором повлиявших факторов.':
      'Toʻrt qadam: bola haqida maʼlumot, alomatlar, xavf omillari va taʼsir qilgan omillar tahlili bilan tushunarli natija.',
    'например, 8': 'masalan, 8',
    'например, 130': 'masalan, 130',
    'например, 27': 'masalan, 27',
    'На главную': 'Bosh sahifaga',
    'Шаг 1 из 4': '4 qadamdan 1-qadam',
    'Данные не отправляются на сервер': 'Maʼlumotlar serverga yuborilmaydi',
    'Расскажите о ребёнке': 'Bola haqida maʼlumot bering',
    'Эти данные нужны, чтобы рассчитать индекс массы тела и корректно интерпретировать симптомы с учётом возраста.':
      'Bu maʼlumotlar tana vazni indeksini hisoblash va alomatlarni yoshga qarab toʻgʻri talqin qilish uchun kerak.',
    'Основные данные': 'Asosiy maʼlumotlar',
    'Пол ребёнка': 'Bolaning jinsi',
    'Мальчик': 'Oʻgʻil bola',
    'Девочка': 'Qiz bola',
    'Возраст, полных лет': 'Yosh, toʻliq yil',
    'Укажите возраст от 1 до 17 лет': '1 dan 17 yoshgacha boʻlgan yoshni kiriting',
    'Рост, см': 'Boʻy, sm',
    'Укажите рост от 50 до 210 см': '50 dan 210 sm gacha boʻyni kiriting',
    'Вес, кг': 'Vazn, kg',
    'Укажите вес от 5 до 150 кг': '5 dan 150 kg gacha vaznni kiriting',
    'Кто заполняет анкету': 'Soʻrovnomani kim toʻldirmoqda',
    'Родитель или опекун': 'Ota-ona yoki vasiy',
    'Медицинский работник': 'Tibbiyot xodimi',
    'Сам подросток': 'Oʻsmirning oʻzi',
    'Ответы обрабатываются в браузере и не передаются на сервер. Имя ребёнка мы не спрашиваем намеренно.':
      'Javoblar brauzerda qayta ishlanadi va serverga uzatilmaydi. Bolaning ismini ataylab soʻramaymiz.',
    'Отмена': 'Bekor qilish',
    'Далее: симптомы': 'Keyingisi: alomatlar',
    'Какие симптомы вы замечали': 'Qanday alomatlarni sezdingiz',
    'Отметьте всё, что появилось у ребёнка в последнее время и раньше было нехарактерно. Если ничего из списка нет — просто идите дальше.':
      'Bolada soʻnggi paytda paydo boʻlgan va ilgari xos boʻlmagan hamma narsani belgilang. Roʻyxatdan hech narsa boʻlmasa — shunchaki davom eting.',
    'Пьёт заметно больше обычного, просит воду ночью':
      'Odatdagidan ancha koʻp ichadi, kechasi suv soʻraydi',
    'Учащённые походы в туалет, в том числе ночью':
      'Hojatxonaga tez-tez borish, kechasi ham',
    'Вес снижается без диеты, аппетит при этом сохранён':
      'Parhezsiz vazn kamaymoqda, ishtaha esa saqlangan',
    'Вернулось у ребёнка, который уже был сухим ночью':
      'Kechasi allaqachon quruq boʻlgan bolada yana qaytdi',
    'Утомляемость и вялость': 'Holsizlik va lanjlik',
    'Стал менее активным, быстро устаёт, хочет спать днём':
      'Kamroq faol boʻlib qoldi, tez charchaydi, kunduzi uxlagisi keladi',
    'Постоянный голод': 'Doimiy ochlik',
    'Ест больше обычного и всё равно голоден':
      'Odatdagidan koʻp yeydi, baribir och',
    'Жалуется на «размытость», хуже видит доску или текст':
      '«Xiralik»dan shikoyat qiladi, doska yoki matnni yomonroq koʻradi',
    'Ранки заживают медленно, часто повторяются инфекции':
      'Yaralar sekin bitadi, infeksiyalar tez-tez takrorlanadi',
    'Сухость и зуд кожи': 'Teri qurishi va qichishi',
    'Сухость слизистых, зуд, у девочек — молочница':
      'Shilliq qavatlar qurishi, qichishish, qizlarda — moluznitsa',
    'Тошнота, боль в животе': 'Koʻngil aynishi, qorin ogʻrigʻi',
    'Эпизоды тошноты или дискомфорта в животе':
      'Koʻngil aynishi yoki qorindagi noqulaylik holatlari',
    'Как давно наблюдаются эти симптомы': 'Bu alomatlar qachondan beri kuzatilmoqda',
    'Симптомов нет': 'Alomatlar yoʻq',
    'Менее 2 недель': '2 haftadan kam',
    'От 2 недель до 2 месяцев': '2 haftadan 2 oygacha',
    'Более 2 месяцев': '2 oydan ortiq',
    'Длительность классических симптомов влияет на срочность обращения к врачу.':
      'Klassik alomatlarning davomiyligi shifokorga murojaat shoshilinchligiga taʼsir qiladi.',
    'Неотложные признаки': 'Shoshilinch belgilar',
    'Отметьте, если это есть прямо сейчас. При таких признаках оценка риска вторична — нужна немедленная медицинская помощь.':
      'Agar bu hozir boʻlsa, belgilang. Bunday belgilarda xavf bahosi ikkinchi darajali — zudlik bilan tibbiy yordam kerak.',
    'Запах ацетона изо рта, частое глубокое дыхание':
      'Ogʻizdan atseton hidi, tez chuqur nafas olish',
    'Многократная рвота, сильная боль в животе, обезвоживание':
      'Takroriy qusish, kuchli qorin ogʻrigʻi, suvsizlanish',
    'Спутанность сознания, выраженная сонливость, заторможенность':
      'Ongning chalkashishi, kuchli uyquchanlik, sustlik',
    'Назад': 'Orqaga',
    'Далее: факторы риска': 'Keyingisi: xavf omillari',
    'Наследственность, особенности беременности и образ жизни ребёнка. Если о каком-то пункте вы не знаете — оставьте его не отмеченным.':
      'Irsiyat, homiladorlik xususiyatlari va bolaning turmush tarzi. Biror band haqida bilmasangiz — uni belgilamay qoldiring.',
    'Диабет 1 типа у родителя, брата или сестры':
      'Ota-ona, aka yoki opada 1-tur diabet',
    'Наиболее значимый наследственный фактор': 'Eng muhim irsiy omil',
    'Диабет 2 типа у близких родственников':
      'Yaqin qarindoshlarda 2-tur diabet',
    'Родители, братья и сёстры, бабушки и дедушки':
      'Ota-ona, aka-uka va opa-singillar, buvi va bobolar',
    'Аутоиммунные заболевания в семье': 'Oilada autoimmun kasalliklar',
    'Болезни щитовидной железы, целиакия, витилиго':
      'Qalqonsimon bez kasalliklari, tseliakiya, vitiligo',
    'Здоровье ребёнка': 'Bolaning sogʻligʻi',
    'У ребёнка есть аутоиммунное заболевание': 'Bolada autoimmun kasallik bor',
    'Например, аутоиммунный тиреоидит или целиакия':
      'Masalan, autoimmun tireoidit yoki tseliakiya',
    'Тёмные бархатистые участки кожи': 'Terining toʻq, baxmal kabi joylari',
    'На шее, в подмышках или паху — возможный признак инсулинорезистентности':
      'Boʻyinda, qoʻltiq ostida yoki chov sohasida — insulin rezistentligining mumkin boʻlgan belgisi',
    'Частые инфекции в последние месяцы': 'Soʻnggi oylarda tez-tez infeksiyalar',
    'Повторяющиеся вирусные или грибковые инфекции':
      'Takrorlanuvchi virusli yoki zamburugʻli infeksiyalar',
    'Беременность и роды': 'Homiladorlik va tugʻruq',
    'Гестационный диабет у матери': 'Onada gestatsion diabet',
    'Повышение сахара во время беременности этим ребёнком':
      'Shu bolaga homiladorlik davrida qand koʻtarilgan',
    'Вес при рождении более 4 кг': 'Tugʻilgandagi vazn 4 kg dan ortiq',
    'Или менее 2,5 кг при доношенной беременности':
      'Yoki muddatida tugʻilganda 2,5 kg dan kam',
    'Образ жизни': 'Turmush tarzi',
    'Низкая физическая активность': 'Past jismoniy faollik',
    'Менее часа активного движения в день': 'Kuniga bir soatdan kam faol harakat',
    'Сладкие напитки почти каждый день': 'Shirin ichimliklar deyarli har kuni',
    'Газировка, соки, сладкий чай на постоянной основе':
      'Gazlangan suv, sharbat, shirin choy doimiy ravishda',
    'Показать результат': 'Natijani koʻrsatish',
    'Обрабатываем ответы': 'Javoblarni qayta ishlayapmiz',
    'Сопоставляем отмеченные признаки с весами факторов риска':
      'Belgilangan alomatlarni xavf omillari vaznlari bilan solishtiryapmiz',
    'Проверка антропометрии и расчёт ИМТ': 'Antropometriyani tekshirish va TVIni hisoblash',
    'Оценка симптомов и их длительности': 'Alomatlar va ularning davomiyligini baholash',
    'Учёт семейного анамнеза': 'Oilaviy anamnezni hisobga olish',
    'Формирование итоговой оценки': 'Yakuniy bahoni shakllantirish',
    '0 · низкий': '0 · past',
    '100 · высокий': '100 · yuqori',
    'Факторы, повлиявшие на оценку': 'Bahoga taʼsir qilgan omillar',
    'Отмеченные признаки и их вклад в итоговый балл':
      'Belgilangan alomatlar va ularning yakuniy ballga hissasi',
    'Не обнаружено': 'Aniqlanmadi',
    'Значимые признаки, которых вы не отметили':
      'Siz belgilamagan muhim belgilar',
    'Что делать дальше': 'Keyin nima qilish kerak',
    'результат является оценкой факторов риска и не является медицинским диагнозом. Для постановки диагноза необходимо обратиться к врачу. Оценка ИМТ ориентировочная и не заменяет осмотр педиатра.':
      'natija xavf omillarining bahosi boʻlib, tibbiy tashxis emas. Tashxis qoʻyish uchun shifokorga murojaat qilish kerak. TVI bahosi taxminiy va pediatr koʻrigini almashtirmaydi.',
    'Распечатать сводку': 'Xulosani chop etish',
    'Пройти заново': 'Qaytadan oʻtish'
  });

  Object.assign(D.en, {
    'Оценка риска — NDST': 'Risk assessment — NDST',
    'Четыре шага: данные о ребёнке, симптомы, факторы риска и понятный результат с разбором повлиявших факторов.':
      'Four steps: details about the child, symptoms, risk factors, and a clear result with a breakdown of what shaped it.',
    'например, 8': 'e.g. 8',
    'например, 130': 'e.g. 130',
    'например, 27': 'e.g. 27',
    'На главную': 'Home',
    'Шаг 1 из 4': 'Step 1 of 4',
    'Данные не отправляются на сервер': 'Nothing is sent to a server',
    'Расскажите о ребёнке': 'Tell us about the child',
    'Эти данные нужны, чтобы рассчитать индекс массы тела и корректно интерпретировать симптомы с учётом возраста.':
      'We need this to calculate body mass index and interpret the symptoms correctly for the child’s age.',
    'Основные данные': 'Basic details',
    'Пол ребёнка': 'Sex',
    'Мальчик': 'Boy',
    'Девочка': 'Girl',
    'Возраст, полных лет': 'Age, full years',
    'Укажите возраст от 1 до 17 лет': 'Enter an age between 1 and 17',
    'Рост, см': 'Height, cm',
    'Укажите рост от 50 до 210 см': 'Enter a height between 50 and 210 cm',
    'Вес, кг': 'Weight, kg',
    'Укажите вес от 5 до 150 кг': 'Enter a weight between 5 and 150 kg',
    'Кто заполняет анкету': 'Who is filling this in',
    'Родитель или опекун': 'Parent or guardian',
    'Медицинский работник': 'Healthcare professional',
    'Сам подросток': 'The teenager themselves',
    'Ответы обрабатываются в браузере и не передаются на сервер. Имя ребёнка мы не спрашиваем намеренно.':
      'Answers are processed in your browser and never sent to a server. We deliberately do not ask for the child’s name.',
    'Отмена': 'Cancel',
    'Далее: симптомы': 'Next: symptoms',
    'Какие симптомы вы замечали': 'Which symptoms have you noticed',
    'Отметьте всё, что появилось у ребёнка в последнее время и раньше было нехарактерно. Если ничего из списка нет — просто идите дальше.':
      'Tick everything that has appeared recently and was not typical before. If none of these apply, just continue.',
    'Пьёт заметно больше обычного, просит воду ночью':
      'Drinks noticeably more than usual, asks for water at night',
    'Учащённые походы в туалет, в том числе ночью':
      'More frequent trips to the toilet, including at night',
    'Вес снижается без диеты, аппетит при этом сохранён':
      'Losing weight without dieting, while appetite is unchanged',
    'Вернулось у ребёнка, который уже был сухим ночью':
      'Returned in a child who had already been dry at night',
    'Утомляемость и вялость': 'Fatigue and lethargy',
    'Стал менее активным, быстро устаёт, хочет спать днём':
      'Less active, tires quickly, wants to sleep during the day',
    'Постоянный голод': 'Constant hunger',
    'Ест больше обычного и всё равно голоден':
      'Eats more than usual and is still hungry',
    'Жалуется на «размытость», хуже видит доску или текст':
      'Complains of blurriness, sees the board or text less clearly',
    'Ранки заживают медленно, часто повторяются инфекции':
      'Cuts heal slowly, infections keep coming back',
    'Сухость и зуд кожи': 'Dry, itchy skin',
    'Сухость слизистых, зуд, у девочек — молочница':
      'Dry mucous membranes, itching; thrush in girls',
    'Тошнота, боль в животе': 'Nausea, abdominal pain',
    'Эпизоды тошноты или дискомфорта в животе':
      'Episodes of nausea or discomfort in the abdomen',
    'Как давно наблюдаются эти симптомы': 'How long have these symptoms lasted',
    'Симптомов нет': 'No symptoms',
    'Менее 2 недель': 'Less than 2 weeks',
    'От 2 недель до 2 месяцев': 'From 2 weeks to 2 months',
    'Более 2 месяцев': 'More than 2 months',
    'Длительность классических симптомов влияет на срочность обращения к врачу.':
      'How long the classic symptoms have lasted affects how urgently a doctor is needed.',
    'Неотложные признаки': 'Emergency signs',
    'Отметьте, если это есть прямо сейчас. При таких признаках оценка риска вторична — нужна немедленная медицинская помощь.':
      'Tick these only if they are present right now. With such signs the risk score is secondary — immediate medical care is needed.',
    'Запах ацетона изо рта, частое глубокое дыхание':
      'Acetone smell on the breath, rapid deep breathing',
    'Многократная рвота, сильная боль в животе, обезвоживание':
      'Repeated vomiting, severe abdominal pain, dehydration',
    'Спутанность сознания, выраженная сонливость, заторможенность':
      'Confusion, marked drowsiness, sluggishness',
    'Назад': 'Back',
    'Далее: факторы риска': 'Next: risk factors',
    'Наследственность, особенности беременности и образ жизни ребёнка. Если о каком-то пункте вы не знаете — оставьте его не отмеченным.':
      'Heredity, pregnancy details and the child’s lifestyle. If you are unsure about an item, leave it unticked.',
    'Диабет 1 типа у родителя, брата или сестры':
      'Type 1 diabetes in a parent or sibling',
    'Наиболее значимый наследственный фактор': 'The most significant hereditary factor',
    'Диабет 2 типа у близких родственников':
      'Type 2 diabetes in close relatives',
    'Родители, братья и сёстры, бабушки и дедушки':
      'Parents, siblings, grandparents',
    'Аутоиммунные заболевания в семье': 'Autoimmune disease in the family',
    'Болезни щитовидной железы, целиакия, витилиго':
      'Thyroid disease, coeliac disease, vitiligo',
    'Здоровье ребёнка': 'The child’s health',
    'У ребёнка есть аутоиммунное заболевание': 'The child has an autoimmune condition',
    'Например, аутоиммунный тиреоидит или целиакия':
      'For example autoimmune thyroiditis or coeliac disease',
    'Тёмные бархатистые участки кожи': 'Dark, velvety patches of skin',
    'На шее, в подмышках или паху — возможный признак инсулинорезистентности':
      'On the neck, armpits or groin — a possible sign of insulin resistance',
    'Частые инфекции в последние месяцы': 'Frequent infections in recent months',
    'Повторяющиеся вирусные или грибковые инфекции':
      'Recurring viral or fungal infections',
    'Беременность и роды': 'Pregnancy and birth',
    'Гестационный диабет у матери': 'Gestational diabetes in the mother',
    'Повышение сахара во время беременности этим ребёнком':
      'Raised blood sugar during the pregnancy with this child',
    'Вес при рождении более 4 кг': 'Birth weight over 4 kg',
    'Или менее 2,5 кг при доношенной беременности':
      'Or under 2.5 kg at full term',
    'Образ жизни': 'Lifestyle',
    'Низкая физическая активность': 'Low physical activity',
    'Менее часа активного движения в день': 'Less than an hour of active movement a day',
    'Сладкие напитки почти каждый день': 'Sugary drinks on most days',
    'Газировка, соки, сладкий чай на постоянной основе':
      'Fizzy drinks, juice, sweet tea on a regular basis',
    'Показать результат': 'Show the result',
    'Обрабатываем ответы': 'Processing your answers',
    'Сопоставляем отмеченные признаки с весами факторов риска':
      'Matching the signs you marked against the risk factor weights',
    'Проверка антропометрии и расчёт ИМТ': 'Checking measurements and computing BMI',
    'Оценка симптомов и их длительности': 'Assessing symptoms and their duration',
    'Учёт семейного анамнеза': 'Accounting for family history',
    'Формирование итоговой оценки': 'Forming the final score',
    '0 · низкий': '0 · low',
    '100 · высокий': '100 · high',
    'Факторы, повлиявшие на оценку': 'Factors that shaped the score',
    'Отмеченные признаки и их вклад в итоговый балл':
      'The signs you marked and their contribution to the total',
    'Не обнаружено': 'Not found',
    'Значимые признаки, которых вы не отметили':
      'Significant signs you did not mark',
    'Что делать дальше': 'What to do next',
    'результат является оценкой факторов риска и не является медицинским диагнозом. Для постановки диагноза необходимо обратиться к врачу. Оценка ИМТ ориентировочная и не заменяет осмотр педиатра.':
      'the result is an assessment of risk factors, not a medical diagnosis. A diagnosis can only be made by a doctor. The BMI estimate is approximate and does not replace a paediatric examination.',
    'Распечатать сводку': 'Print the summary',
    'Пройти заново': 'Start over'
  });

  /* ------------------------- Кабинет врача ---------------------------- */

  Object.assign(D.uz, {
    'Кабинет врача — NDST': 'Shifokor kabineti — NDST',
    'Демонстрационный кабинет врача NDST: список пациентов, распределение риска и история оценок.':
      'NDST shifokor kabineti demosi: bemorlar roʻyxati, xavf taqsimoti va baholar tarixi.',
    'Поиск по пациенту или ID': 'Bemor yoki ID boʻyicha qidiruv',
    'Поиск пациента': 'Bemorni qidirish',
    'Уведомления': 'Bildirishnomalar',
    'Обзор': 'Umumiy',
    'Сводка': 'Xulosa',
    'Пациенты': 'Bemorlar',
    'Оценки': 'Baholar',
    'Анализ риска': 'Xavf tahlili',
    'Статистика': 'Statistika',
    'Прочее': 'Boshqa',
    'База знаний': 'Bilimlar bazasi',
    'Настройки': 'Sozlamalar',
    'Е. Ковалёва': 'E. Kovalyova',
    'Педиатр · демо-доступ': 'Pediatr · demo kirish',
    'Выйти из демо': 'Demodan chiqish',
    'Демонстрационный режим. Все пациенты и оценки вымышленные, данные хранятся только в этой вкладке.':
      'Namoyish rejimi. Barcha bemorlar va baholar toʻqib chiqarilgan, maʼlumotlar faqat shu oynada saqlanadi.',
    'Ключевые показатели по скринингу за последние 30 дней':
      'Soʻnggi 30 kundagi skrining boʻyicha asosiy koʻrsatkichlar',
    '30 дней': '30 kun',
    'Выгрузить': 'Yuklab olish',
    '+64 за месяц': 'oyiga +64',
    'Проведено оценок': 'Oʻtkazilgan baholar',
    '+212 за месяц': 'oyiga +212',
    '6,8% от всех оценок': 'barcha baholarning 6,8%',
    'На повторном контроле': 'Takroriy nazoratda',
    '28 назначено на неделю': 'shu haftaga 28 ta belgilangan',
    'Динамика оценок': 'Baholar dinamikasi',
    'Количество пройденных анкет по месяцам': 'Oylar boʻyicha toʻldirilgan soʻrovnomalar soni',
    'Все оценки': 'Barcha baholar',
    'Распределение риска': 'Xavf taqsimoti',
    'По 24 последним оценкам': 'Soʻnggi 24 ta baho boʻyicha',
    'Последние оценки': 'Soʻnggi baholar',
    'Шесть самых свежих результатов': 'Eng yangi oltita natija',
    'Все пациенты': 'Barcha bemorlar',
    'Ключевые факторы': 'Asosiy omillar',
    'Дата': 'Sana',
    'Экспорт CSV': 'CSV eksport',
    'Добавить пациента': 'Bemor qoʻshish',
    'Все': 'Hammasi',
    'Последняя оценка': 'Oxirgi baho',
    'Статус': 'Holat',
    'История всех пройденных анкет': 'Barcha toʻldirilgan soʻrovnomalar tarixi',
    'Раздел в разработке': 'Boʻlim ishlab chiqilmoqda',
    'Здесь появится полная история оценок с фильтрами по дате, врачу и уровню риска.':
      'Bu yerda sana, shifokor va xavf darajasi boʻyicha filtrlar bilan toʻliq baholar tarixi paydo boʻladi.',
    'Разбор вклада факторов по когорте': 'Kogorta boʻyicha omillar hissasi tahlili',
    'Здесь будет анализ того, какие факторы чаще всего определяют высокий риск в вашей когорте пациентов.':
      'Bu yerda sizning bemorlar kogortangizda yuqori xavfni koʻpincha qaysi omillar belgilashi tahlil qilinadi.',
    'Отчёты и выгрузки': 'Hisobotlar va yuklamalar',
    'Здесь появятся отчёты по периодам и выгрузка данных для медицинской документации.':
      'Bu yerda davrlar boʻyicha hisobotlar va tibbiy hujjatlar uchun maʼlumotlarni yuklab olish paydo boʻladi.',
    'Методология и клинические источники': 'Metodologiya va klinik manbalar',
    'Здесь будет описание модели расчёта, веса факторов и ссылки на клинические рекомендации.':
      'Bu yerda hisoblash modeli tavsifi, omillar vazni va klinik tavsiyalarga havolalar boʻladi.',
    'Профиль и параметры кабинета': 'Profil va kabinet parametrlari',
    'Здесь появятся настройки профиля врача, уведомлений и доступа коллег.':
      'Bu yerda shifokor profili, bildirishnomalar va hamkasblar kirishi sozlamalari paydo boʻladi.'
  });

  Object.assign(D.en, {
    'Кабинет врача — NDST': 'Clinician dashboard — NDST',
    'Демонстрационный кабинет врача NDST: список пациентов, распределение риска и история оценок.':
      'NDST clinician dashboard demo: patient list, risk distribution and assessment history.',
    'Поиск по пациенту или ID': 'Search by patient or ID',
    'Поиск пациента': 'Search patients',
    'Уведомления': 'Notifications',
    'Обзор': 'Overview',
    'Сводка': 'Summary',
    'Пациенты': 'Patients',
    'Оценки': 'Assessments',
    'Анализ риска': 'Risk analysis',
    'Статистика': 'Statistics',
    'Прочее': 'Other',
    'База знаний': 'Knowledge base',
    'Настройки': 'Settings',
    'Е. Ковалёва': 'E. Kovaleva',
    'Педиатр · демо-доступ': 'Paediatrician · demo access',
    'Выйти из демо': 'Exit demo',
    'Демонстрационный режим. Все пациенты и оценки вымышленные, данные хранятся только в этой вкладке.':
      'Demo mode. All patients and assessments are fictional; data lives only in this tab.',
    'Ключевые показатели по скринингу за последние 30 дней':
      'Key screening metrics for the last 30 days',
    '30 дней': '30 days',
    'Выгрузить': 'Export',
    '+64 за месяц': '+64 this month',
    'Проведено оценок': 'Assessments completed',
    '+212 за месяц': '+212 this month',
    '6,8% от всех оценок': '6.8% of all assessments',
    'На повторном контроле': 'In follow-up',
    '28 назначено на неделю': '28 scheduled this week',
    'Динамика оценок': 'Assessments over time',
    'Количество пройденных анкет по месяцам': 'Questionnaires completed by month',
    'Все оценки': 'All assessments',
    'Распределение риска': 'Risk distribution',
    'По 24 последним оценкам': 'Across the last 24 assessments',
    'Последние оценки': 'Latest assessments',
    'Шесть самых свежих результатов': 'The six most recent results',
    'Все пациенты': 'All patients',
    'Ключевые факторы': 'Key factors',
    'Дата': 'Date',
    'Экспорт CSV': 'Export CSV',
    'Добавить пациента': 'Add patient',
    'Все': 'All',
    'Последняя оценка': 'Last assessment',
    'Статус': 'Status',
    'История всех пройденных анкет': 'History of every completed questionnaire',
    'Раздел в разработке': 'Section in development',
    'Здесь появится полная история оценок с фильтрами по дате, врачу и уровню риска.':
      'This will hold the full assessment history with filters by date, clinician and risk level.',
    'Разбор вклада факторов по когорте': 'Factor contribution across the cohort',
    'Здесь будет анализ того, какие факторы чаще всего определяют высокий риск в вашей когорте пациентов.':
      'This will analyse which factors most often drive high risk in your patient cohort.',
    'Отчёты и выгрузки': 'Reports and exports',
    'Здесь появятся отчёты по периодам и выгрузка данных для медицинской документации.':
      'This will hold period reports and data exports for medical records.',
    'Методология и клинические источники': 'Methodology and clinical sources',
    'Здесь будет описание модели расчёта, веса факторов и ссылки на клинические рекомендации.':
      'This will describe the scoring model, the factor weights and links to clinical guidance.',
    'Профиль и параметры кабинета': 'Profile and dashboard settings',
    'Здесь появятся настройки профиля врача, уведомлений и доступа коллег.':
      'This will hold the clinician profile, notification and colleague-access settings.'
  });

  /* --------------- Строки, которые собирает JavaScript ---------------- */

  Object.assign(D.uz, {
    /* модель оценки */
    'Долгое заживление ранок': 'Yaralarning sekin bitishi',
    'Аутоиммунное заболевание у ребёнка': 'Bolada autoimmun kasallik',
    'Отклонение веса при рождении': 'Tugʻilgandagi vazn meʼyordan chetlanishi',
    'Симптомы менее 2 недель': 'Alomatlar 2 haftadan kam',
    'Симптомы от 2 недель до 2 месяцев': 'Alomatlar 2 haftadan 2 oygacha',
    'Симптомы более 2 месяцев': 'Alomatlar 2 oydan ortiq',
    'Многократная рвота, сильная боль в животе': 'Takroriy qusish, kuchli qorin ogʻrigʻi',
    'Спутанность сознания, выраженная сонливость': 'Ongning chalkashishi, kuchli uyquchanlik',
    'Нет возрастной нормы': 'Yosh meʼyori yoʻq',
    'Для этого возраста ориентир не рассчитывается': 'Bu yosh uchun moʻljal hisoblanmaydi',
    'Дефицит массы тела': 'Tana vazni yetishmovchiligi',
    'ИМТ ниже возрастного ориентира': 'TVI yosh moʻljalidan past',
    'Ожирение': 'Semizlik',
    'ИМТ выше 95-го перцентиля для возраста': 'TVI yosh uchun 95-pertsentildan yuqori',
    'Избыточная масса тела': 'Ortiqcha tana vazni',
    'ИМТ между 85-м и 95-м перцентилем': 'TVI 85 va 95-pertsentil orasida',
    'ИМТ в пределах возрастного ориентира': 'TVI yosh moʻljali doirasida',

    /* уровни риска */
    'Низкий риск': 'Past xavf',
    'Тревожных признаков не выявлено': 'Xavotirli belgilar aniqlanmadi',
    'Сейчас данных, указывающих на высокий риск сахарного диабета, нет. Это не отменяет плановых осмотров у педиатра.':
      'Hozircha qandli diabetning yuqori xavfini koʻrsatuvchi maʼlumot yoʻq. Bu pediatrdagi rejali koʻriklarni bekor qilmaydi.',
    'Продолжайте плановые профилактические осмотры у педиатра.':
      'Pediatrdagi rejali profilaktik koʻriklarni davom ettiring.',
    'Сохраняйте привычный уровень активности и питания ребёнка.':
      'Bolaning odatdagi faollik darajasi va ovqatlanishini saqlang.',
    'Пройдите оценку повторно, если появятся жажда, частое мочеиспускание, потеря веса или необъяснимая утомляемость.':
      'Chanqash, tez-tez siydik ajratish, vazn yoʻqotish yoki sababsiz holsizlik paydo boʻlsa, baholashni qayta oʻting.',
    'Рекомендуется консультация педиатра': 'Pediatr maslahati tavsiya etiladi',
    'Часть отмеченных признаков заслуживает внимания врача. Это не диагноз, но повод не откладывать приём.':
      'Belgilangan alomatlarning bir qismi shifokor eʼtiboriga loyiq. Bu tashxis emas, lekin qabulni kechiktirmaslik uchun asos.',
    'Запишитесь к педиатру в ближайшие дни и покажите эту сводку.':
      'Yaqin kunlarda pediatrga yoziling va ushbu xulosani koʻrsating.',
    'Обсудите с врачом анализ глюкозы крови натощак и, при необходимости, HbA1c.':
      'Shifokor bilan och qoringa qon glyukozasi tahlilini va zarur boʻlsa HbA1c ni muhokama qiling.',
    'Записывайте, как часто ребёнок пьёт и ходит в туалет, — это поможет врачу.':
      'Bola qanchalik tez-tez suv ichishi va hojatxonaga borishini yozib boring — bu shifokorga yordam beradi.',
    'Немедленно обратитесь за помощью, если появятся рвота, боль в животе или запах ацетона изо рта.':
      'Qusish, qorin ogʻrigʻi yoki ogʻizdan atseton hidi paydo boʻlsa, zudlik bilan yordamga murojaat qiling.',
    'Нужна консультация врача в ближайшее время': 'Yaqin vaqt ichida shifokor maslahati kerak',
    'Сочетание отмеченных признаков характерно для нарушения углеводного обмена. Обследование откладывать не стоит.':
      'Belgilangan alomatlarning birgalikda uchrashi uglevod almashinuvi buzilishiga xos. Tekshiruvni kechiktirmaslik kerak.',
    'Обратитесь к педиатру или детскому эндокринологу в ближайшие 1–2 дня.':
      'Yaqin 1–2 kun ichida pediatr yoki bolalar endokrinologiga murojaat qiling.',
    'Попросите измерить уровень глюкозы крови — это быстрый и доступный тест.':
      'Qon glyukozasi darajasini oʻlchashni soʻrang — bu tez va arzon tahlil.',
    'Возьмите на приём распечатку этой сводки с перечнем симптомов.':
      'Qabulga alomatlar roʻyxati bilan ushbu xulosaning chop etilgan nusxasini olib boring.',
    'При появлении рвоты, боли в животе, запаха ацетона или сонливости — вызывайте неотложную помощь, не дожидаясь приёма.':
      'Qusish, qorin ogʻrigʻi, atseton hidi yoki uyquchanlik paydo boʻlsa — qabulni kutmasdan tez yordam chaqiring.',
    'Вы отметили сочетание жажды, частого мочеиспускания и потери веса или ночного недержания — это классический набор признаков, при котором измерение глюкозы крови нужно сделать в ближайшее время.':
      'Siz chanqash, tez-tez siydik ajratish va vazn yoʻqotish yoki tunda siyib qoʻyish birgalikda uchrashini belgiladingiz — bu klassik belgilar toʻplami boʻlib, qon glyukozasini yaqin vaqtda oʻlchash kerak.',
    'Обсудите с педиатром питание и физическую активность: снижение избыточного веса уменьшает риск диабета 2 типа.':
      'Pediatr bilan ovqatlanish va jismoniy faollikni muhokama qiling: ortiqcha vaznni kamaytirish 2-tur diabet xavfini pasaytiradi.',

    /* результат */
    'Симптом': 'Alomat',
    'Длительность': 'Davomiylik',
    'Фактор риска': 'Xavf omili',
    'Антропометрия': 'Antropometriya',
    'Диабет 1 типа у ближайших родственников': 'Yaqin qarindoshlarda 1-tur diabet',
    'Тёмные участки кожи на шее и в складках': 'Boʻyin va burmalarda terining toʻq joylari',
    'Отклонение ИМТ от возрастной нормы': 'TVIning yosh meʼyoridan chetlanishi',
    /* Метка ИМТ склеивается из двух частей в модели, поэтому переводится целиком */
    'ИМТ: дефицит массы тела': 'TVI: tana vazni yetishmovchiligi',
    'ИМТ: избыточная масса тела': 'TVI: ortiqcha tana vazni',
    'ИМТ: ожирение': 'TVI: semizlik',
    'Шаг {n} из 4': '4 qadamdan {n}-qadam',
    'Показатель ориентировочный: точную оценку даёт врач по центильным таблицам.':
      'Koʻrsatkich taxminiy: aniq bahoni shifokor sentil jadvallari boʻyicha beradi.',
    'Нужна неотложная помощь': 'Shoshilinch yordam kerak',
    'Вы отметили признаки, которые могут указывать на диабетический кетоацидоз:':
      'Siz diabetik ketoatsidozdan darak berishi mumkin boʻlgan belgilarni qayd etdingiz:',
    'Не ждите планового приёма — обратитесь в скорую или неотложную помощь сейчас.':
      'Rejali qabulni kutmang — hozir tez yordamga murojaat qiling.',
    'Ребёнок': 'Bola',
    'Рост и вес': 'Boʻy va vazn',
    'Отмечено признаков': 'Belgilangan belgilar',
    'из {n} возможных': 'mumkin boʻlgan {n} tadan',
    '{h} см · {w} кг': '{h} sm · {w} kg',
    'ИМТ: {label}': 'TVI: {label}',
    'Значимых факторов не отмечено.': 'Muhim omillar belgilanmagan.',
    'Отмечены все значимые признаки из списка.': 'Roʻyxatdagi barcha muhim belgilar belgilangan.',
    'Оценка построена на {n} учтённых факторах': 'Baho hisobga olingan {n} ta omilga asoslangan',

    /* кабинет врача */
    'Жажда': 'Chanqash',
    'Полиурия': 'Poliuriya',
    'ИМТ выше нормы': 'TVI meʼyordan yuqori',
    'Низкая активность': 'Past faollik',
    'СД1 у матери': 'Onada 1-tur QD',
    'Акантоз': 'Akantoz',
    'СД2 в семье': 'Oilada 2-tur QD',
    'Частые инфекции': 'Tez-tez infeksiyalar',
    'Сладкие напитки': 'Shirin ichimliklar',
    'Гестационный диабет': 'Gestatsion diabet',
    'Триада симптомов': 'Alomatlar triadasi',
    'СД1 у брата': 'Akasida 1-tur QD',
    'Голод': 'Ochlik',
    'не отмечены': 'belgilanmagan',
    'Нужен контроль': 'Nazorat kerak',
    'Наблюдение': 'Kuzatuv',
    'ОЦЕНОК': 'BAHOLAR',
    'риск': 'xavf',
    'Ничего не найдено. Измените фильтр или запрос.':
      'Hech narsa topilmadi. Filtr yoki soʻrovni oʻzgartiring.',
    'Показано {a}–{b} из {n}': '{n} tadan {a}–{b} koʻrsatilmoqda',
    'Нет записей': 'Yozuvlar yoʻq',
    'Показаны {n} последних {word} из 1 284 · {m} на повторном контроле':
      '1 284 tadan soʻnggi {n} ta {word} koʻrsatilmoqda · {m} tasi takroriy nazoratda'
  });

  Object.assign(D.en, {
    /* модель оценки */
    'Долгое заживление ранок': 'Slow-healing cuts',
    'Аутоиммунное заболевание у ребёнка': 'Autoimmune condition in the child',
    'Отклонение веса при рождении': 'Unusual birth weight',
    'Симптомы менее 2 недель': 'Symptoms for less than 2 weeks',
    'Симптомы от 2 недель до 2 месяцев': 'Symptoms for 2 weeks to 2 months',
    'Симптомы более 2 месяцев': 'Symptoms for more than 2 months',
    'Многократная рвота, сильная боль в животе': 'Repeated vomiting, severe abdominal pain',
    'Спутанность сознания, выраженная сонливость': 'Confusion, marked drowsiness',
    'Нет возрастной нормы': 'No age reference',
    'Для этого возраста ориентир не рассчитывается': 'No reference is calculated for this age',
    'Дефицит массы тела': 'Underweight',
    'ИМТ ниже возрастного ориентира': 'BMI below the age reference',
    'Ожирение': 'Obesity',
    'ИМТ выше 95-го перцентиля для возраста': 'BMI above the 95th percentile for age',
    'Избыточная масса тела': 'Overweight',
    'ИМТ между 85-м и 95-м перцентилем': 'BMI between the 85th and 95th percentile',
    'ИМТ в пределах возрастного ориентира': 'BMI within the age reference',

    /* уровни риска */
    'Низкий риск': 'Low risk',
    'Тревожных признаков не выявлено': 'No warning signs found',
    'Сейчас данных, указывающих на высокий риск сахарного диабета, нет. Это не отменяет плановых осмотров у педиатра.':
      'There is currently nothing pointing to a high risk of diabetes. This does not replace routine paediatric check-ups.',
    'Продолжайте плановые профилактические осмотры у педиатра.':
      'Continue routine preventive check-ups with your paediatrician.',
    'Сохраняйте привычный уровень активности и питания ребёнка.':
      'Keep the child’s usual level of activity and diet.',
    'Пройдите оценку повторно, если появятся жажда, частое мочеиспускание, потеря веса или необъяснимая утомляемость.':
      'Take the assessment again if thirst, frequent urination, weight loss or unexplained fatigue appear.',
    'Рекомендуется консультация педиатра': 'A paediatric consultation is recommended',
    'Часть отмеченных признаков заслуживает внимания врача. Это не диагноз, но повод не откладывать приём.':
      'Some of the signs you marked deserve a doctor’s attention. This is not a diagnosis, but a reason not to delay an appointment.',
    'Запишитесь к педиатру в ближайшие дни и покажите эту сводку.':
      'Book a paediatric appointment in the next few days and show this summary.',
    'Обсудите с врачом анализ глюкозы крови натощак и, при необходимости, HbA1c.':
      'Discuss a fasting blood glucose test with the doctor, and HbA1c if needed.',
    'Записывайте, как часто ребёнок пьёт и ходит в туалет, — это поможет врачу.':
      'Keep a note of how often the child drinks and uses the toilet — it will help the doctor.',
    'Немедленно обратитесь за помощью, если появятся рвота, боль в животе или запах ацетона изо рта.':
      'Seek help immediately if vomiting, abdominal pain or an acetone smell on the breath appear.',
    'Нужна консультация врача в ближайшее время': 'A doctor’s consultation is needed soon',
    'Сочетание отмеченных признаков характерно для нарушения углеводного обмена. Обследование откладывать не стоит.':
      'The combination of signs you marked is typical of disturbed carbohydrate metabolism. Testing should not be postponed.',
    'Обратитесь к педиатру или детскому эндокринологу в ближайшие 1–2 дня.':
      'See a paediatrician or paediatric endocrinologist within the next 1–2 days.',
    'Попросите измерить уровень глюкозы крови — это быстрый и доступный тест.':
      'Ask for a blood glucose measurement — it is a quick and widely available test.',
    'Возьмите на приём распечатку этой сводки с перечнем симптомов.':
      'Bring a printout of this summary with the list of symptoms to the appointment.',
    'При появлении рвоты, боли в животе, запаха ацетона или сонливости — вызывайте неотложную помощь, не дожидаясь приёма.':
      'If vomiting, abdominal pain, an acetone smell or drowsiness appear, call emergency services without waiting for the appointment.',
    'Вы отметили сочетание жажды, частого мочеиспускания и потери веса или ночного недержания — это классический набор признаков, при котором измерение глюкозы крови нужно сделать в ближайшее время.':
      'You marked thirst together with frequent urination and either weight loss or bedwetting — this is the classic combination for which blood glucose should be measured soon.',
    'Обсудите с педиатром питание и физическую активность: снижение избыточного веса уменьшает риск диабета 2 типа.':
      'Discuss diet and physical activity with your paediatrician: reducing excess weight lowers the risk of type 2 diabetes.',

    /* результат */
    'Симптом': 'Symptom',
    'Длительность': 'Duration',
    'Фактор риска': 'Risk factor',
    'Антропометрия': 'Measurements',
    'Диабет 1 типа у ближайших родственников': 'Type 1 diabetes in close relatives',
    'Тёмные участки кожи на шее и в складках': 'Dark skin patches on the neck and in folds',
    'Отклонение ИМТ от возрастной нормы': 'BMI outside the age reference',
    'ИМТ: дефицит массы тела': 'BMI: underweight',
    'ИМТ: избыточная масса тела': 'BMI: overweight',
    'ИМТ: ожирение': 'BMI: obesity',
    'Шаг {n} из 4': 'Step {n} of 4',
    'Показатель ориентировочный: точную оценку даёт врач по центильным таблицам.':
      'This is approximate: a doctor gives the precise assessment using percentile charts.',
    'Нужна неотложная помощь': 'Emergency care needed',
    'Вы отметили признаки, которые могут указывать на диабетический кетоацидоз:':
      'You marked signs that may indicate diabetic ketoacidosis:',
    'Не ждите планового приёма — обратитесь в скорую или неотложную помощь сейчас.':
      'Do not wait for a scheduled appointment — seek emergency care now.',
    'Ребёнок': 'Child',
    'Рост и вес': 'Height and weight',
    'Отмечено признаков': 'Signs marked',
    'из {n} возможных': 'of {n} possible',
    '{h} см · {w} кг': '{h} cm · {w} kg',
    'ИМТ: {label}': 'BMI: {label}',
    'Значимых факторов не отмечено.': 'No significant factors marked.',
    'Отмечены все значимые признаки из списка.': 'Every significant sign on the list was marked.',
    'Оценка построена на {n} учтённых факторах': 'Score built from {n} factors',

    /* кабинет врача */
    'Жажда': 'Thirst',
    'Полиурия': 'Polyuria',
    'ИМТ выше нормы': 'BMI above normal',
    'Низкая активность': 'Low activity',
    'СД1 у матери': 'T1D in mother',
    'Акантоз': 'Acanthosis',
    'СД2 в семье': 'T2D in family',
    'Частые инфекции': 'Frequent infections',
    'Сладкие напитки': 'Sugary drinks',
    'Гестационный диабет': 'Gestational diabetes',
    'Триада симптомов': 'Symptom triad',
    'СД1 у брата': 'T1D in sibling',
    'Голод': 'Hunger',
    'не отмечены': 'none marked',
    'Нужен контроль': 'Follow-up needed',
    'Наблюдение': 'Monitoring',
    'ОЦЕНОК': 'ASSESSED',
    'риск': 'risk',
    'Ничего не найдено. Измените фильтр или запрос.':
      'Nothing found. Change the filter or the query.',
    'Показано {a}–{b} из {n}': 'Showing {a}–{b} of {n}',
    'Нет записей': 'No records',
    'Показаны {n} последних {word} из 1 284 · {m} на повторном контроле':
      'Showing the latest {n} {word} of 1,284 · {m} in follow-up'
  });

  /* ------------- Подписи внутри SVG и вымышленные имена --------------- */

  var NAMES = {
    'А. Смирнова': 'A. Smirnova',
    'М. Иванов': 'M. Ivanov',
    'К. Петров': 'K. Petrov',
    'Д. Волкова': 'D. Volkova',
    'Н. Соколов': 'N. Sokolov',
    'Л. Кузнецова': 'L. Kuznetsova',
    'Т. Морозов': 'T. Morozov',
    'С. Лебедева': 'S. Lebedeva',
    'Р. Егоров': 'R. Egorov',
    'В. Титова': 'V. Titova',
    'Г. Никитин': 'G. Nikitin',
    'О. Белова': 'O. Belova',
    'И. Фомин': 'I. Fomin',
    'Ю. Королёва': 'Yu. Koroleva',
    'П. Гусев': 'P. Gusev',
    'Э. Зайцева': 'E. Zaytseva',
    'Ф. Дроздов': 'F. Drozdov',
    'Ж. Абрамова': 'Zh. Abramova',
    'Х. Мельник': 'Kh. Melnik',
    'Ц. Орлов': 'Ts. Orlov',
    'Ш. Рябова': 'Sh. Ryabova',
    'Б. Юдин': 'B. Yudin',
    'Я. Панова': 'Ya. Panova',
    'У. Савин': 'U. Savin',
    'ЕК': 'EK'
  };
  Object.assign(D.uz, NAMES);
  Object.assign(D.en, NAMES);

  Object.assign(D.uz, {
    'РОСТ · ИМТ': 'BOʻY · TVI',
    'высокий риск · 60': 'yuqori xavf · 60',
    'умеренный риск · 25': 'oʻrtacha xavf · 25',
    'Сумма баллов по отмеченным признакам': 'Belgilangan alomatlar boʻyicha ballar yigʻindisi',
    'Сен': 'Sen', 'Окт': 'Okt', 'Ноя': 'Noy', 'Дек': 'Dek',
    'Янв': 'Yan', 'Фев': 'Fev', 'Мар': 'Mar'
  });

  Object.assign(D.en, {
    'РОСТ · ИМТ': 'HEIGHT · BMI',
    'высокий риск · 60': 'high risk · 60',
    'умеренный риск · 25': 'moderate risk · 25',
    'Сумма баллов по отмеченным признакам': 'Total points from the signs marked',
    'Сен': 'Sep', 'Окт': 'Oct', 'Ноя': 'Nov', 'Дек': 'Dec',
    'Янв': 'Jan', 'Фев': 'Feb', 'Мар': 'Mar'
  });

  /* ---------------- Бэкенд: сохранение, вход, кабинет ----------------- */

  Object.assign(D.uz, {
    'расчёт в браузере, отправка — только по вашей кнопке':
      'hisob brauzerda, yuborish — faqat sizning tugmangiz bilan',
    'Ответы обрабатываются локально. На сервер они попадают, только если вы сами нажмёте «Сохранить».':
      'Javoblar lokal qayta ishlanadi. Serverga ular faqat siz «Saqlash» tugmasini bosgandagina yuboriladi.',
    'отправка только по кнопке': 'yuborish faqat tugma orqali',
    'Расчёт выполняется в вашем браузере, и по умолчанию ответы никуда не уходят. Отправить их можно только вручную — кнопкой «Сохранить» на экране результата, чтобы показать анкету врачу по короткому коду. Имя ребёнка не сохраняется ни при каком сценарии, регистрация не требуется.':
      'Hisob sizning brauzeringizda bajariladi va sukut boʻyicha javoblar hech qayerga yuborilmaydi. Ularni faqat qoʻlda — natija ekranidagi «Saqlash» tugmasi bilan yuborish mumkin, shunda shifokor anketani qisqa kod boʻyicha ochadi. Bolaning ismi hech qanday holatda saqlanmaydi, roʻyxatdan oʻtish talab etilmaydi.',
    'Отправка — только по вашей кнопке': 'Yuborish — faqat sizning tugmangiz bilan',
    'Ответы обрабатываются в браузере. На сервер они уйдут, только если вы нажмёте «Сохранить» на экране результата. Имя ребёнка мы не спрашиваем намеренно.':
      'Javoblar brauzerda qayta ishlanadi. Serverga ular faqat natija ekranidagi «Saqlash» tugmasini bossangiz yuboriladi. Bolaning ismini ataylab soʻramaymiz.',

    'Показать результат врачу': 'Natijani shifokorga koʻrsatish',
    'Оценка посчитана в вашем браузере и никуда не отправлена. Если хотите показать её врачу — сохраните: вы получите короткий код, по которому врач откроет эту анкету у себя. Имя ребёнка при этом не сохраняется.':
      'Baho sizning brauzeringizda hisoblandi va hech qayerga yuborilmadi. Uni shifokorga koʻrsatmoqchi boʻlsangiz — saqlang: qisqa kod olasiz, shifokor shu kod boʻyicha anketani oʻzida ochadi. Bolaning ismi bunda saqlanmaydi.',
    'Сохранить и получить код': 'Saqlash va kod olish',
    'Код оценки': 'Baholash kodi',
    'Назовите код врачу — он найдёт по нему вашу анкету.':
      'Kodni shifokorga ayting — u shu kod boʻyicha anketangizni topadi.',
    'Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.':
      'Saqlab boʻlmadi. Ulanishni tekshirib, qayta urinib koʻring.',

    'Педиатр': 'Pediatr',
    'Выйти': 'Chiqish',
    'Данные загружаются с сервера. Анкета не собирает имя ребёнка — оценка опознаётся по коду, а метку пациента ставит врач.':
      'Maʼlumotlar serverdan yuklanadi. Anketa bolaning ismini yigʻmaydi — baho kod boʻyicha aniqlanadi, bemor belgisini esa shifokor qoʻyadi.',
    'Показатели по сохранённым оценкам': 'Saqlangan baholar boʻyicha koʻrsatkichlar',
    'Всего оценок': 'Jami baholar',
    'за всё время': 'butun davr uchun',
    'За последние 30 дней': 'Soʻnggi 30 kunda',
    'новых оценок': 'yangi baholar',
    'требуют контроля': 'nazorat talab qiladi',
    'от всех оценок': 'barcha baholardan',
    'Загружено {n} {word} · {m} на повторном контроле':
      '{n} ta {word} yuklandi · {m} tasi takroriy nazoratda',
    'Не удалось загрузить данные с сервера.': 'Serverdan maʼlumot yuklab boʻlmadi.',

    'Вход для врача — NDST': 'Shifokor uchun kirish — NDST',
    'Вход в кабинет врача NDST.': 'NDST shifokor kabinetiga kirish.',
    'Не менее 8 символов': 'Kamida 8 ta belgi',
    'Вход в кабинет врача': 'Shifokor kabinetiga kirish',
    'Доступ к оценкам пациентов. Родителям вход не нужен — анкета открыта без регистрации.':
      'Bemorlar baholariga kirish. Ota-onalarga kirish shart emas — anketa roʻyxatdan oʻtmasdan ochiq.',
    'Рабочая почта': 'Ish pochtasi',
    'Пароль': 'Parol',
    'Войти': 'Kirish',
    'Демонстрационный доступ:': 'Namoyish uchun kirish:',
    '. Смените пароль перед публикацией.': '. Nashrdan oldin parolni oʻzgartiring.',
    'Введите почту и пароль не короче 8 символов.':
      'Pochta va kamida 8 ta belgidan iborat parolni kiriting.',
    'Не удалось войти. Проверьте данные.': 'Kirib boʻlmadi. Maʼlumotlarni tekshiring.',
    'Сервер недоступен. Попробуйте позже.': 'Server mavjud emas. Keyinroq urinib koʻring.',
    'Неверная почта или пароль': 'Pochta yoki parol notoʻgʻri',
    'Слишком много попыток. Повторите через несколько минут.':
      'Juda koʻp urinish. Bir necha daqiqadan soʻng qayta urinib koʻring.',

    'Страница не найдена — NDST': 'Sahifa topilmadi — NDST',
    'Страница не найдена': 'Sahifa topilmadi',
    'Возможно, адрес изменился или страница удалена.':
      'Ehtimol, manzil oʻzgargan yoki sahifa oʻchirilgan.'
  });

  Object.assign(D.en, {
    'расчёт в браузере, отправка — только по вашей кнопке':
      'computed in your browser, sent only when you choose',
    'Ответы обрабатываются локально. На сервер они попадают, только если вы сами нажмёте «Сохранить».':
      'Answers are processed locally. They reach the server only if you press “Save” yourself.',
    'отправка только по кнопке': 'sent only on request',
    'Расчёт выполняется в вашем браузере, и по умолчанию ответы никуда не уходят. Отправить их можно только вручную — кнопкой «Сохранить» на экране результата, чтобы показать анкету врачу по короткому коду. Имя ребёнка не сохраняется ни при каком сценарии, регистрация не требуется.':
      'The calculation runs in your browser and by default nothing leaves it. You can send the answers only deliberately — with the “Save” button on the result screen — so a doctor can open the questionnaire by a short code. The child’s name is never stored, and no sign-up is required.',
    'Отправка — только по вашей кнопке': 'Sent only when you choose',
    'Ответы обрабатываются в браузере. На сервер они уйдут, только если вы нажмёте «Сохранить» на экране результата. Имя ребёнка мы не спрашиваем намеренно.':
      'Answers are processed in your browser. They go to the server only if you press “Save” on the result screen. We deliberately do not ask for the child’s name.',

    'Показать результат врачу': 'Show the result to a doctor',
    'Оценка посчитана в вашем браузере и никуда не отправлена. Если хотите показать её врачу — сохраните: вы получите короткий код, по которому врач откроет эту анкету у себя. Имя ребёнка при этом не сохраняется.':
      'The assessment was computed in your browser and has not been sent anywhere. To show it to a doctor, save it: you will get a short code they can use to open this questionnaire. The child’s name is not stored.',
    'Сохранить и получить код': 'Save and get a code',
    'Код оценки': 'Assessment code',
    'Назовите код врачу — он найдёт по нему вашу анкету.':
      'Give the code to your doctor — they will find your questionnaire by it.',
    'Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.':
      'Could not save. Check your connection and try again.',

    'Педиатр': 'Paediatrician',
    'Выйти': 'Sign out',
    'Данные загружаются с сервера. Анкета не собирает имя ребёнка — оценка опознаётся по коду, а метку пациента ставит врач.':
      'Data is loaded from the server. The questionnaire collects no child’s name — an assessment is identified by its code, and the clinician adds a patient label.',
    'Показатели по сохранённым оценкам': 'Metrics across saved assessments',
    'Всего оценок': 'Assessments total',
    'за всё время': 'all time',
    'За последние 30 дней': 'Last 30 days',
    'новых оценок': 'new assessments',
    'требуют контроля': 'need follow-up',
    'от всех оценок': 'of all assessments',
    'Загружено {n} {word} · {m} на повторном контроле':
      'Loaded {n} {word} · {m} in follow-up',
    'Не удалось загрузить данные с сервера.': 'Could not load data from the server.',

    'Вход для врача — NDST': 'Clinician sign-in — NDST',
    'Вход в кабинет врача NDST.': 'Sign in to the NDST clinician dashboard.',
    'Не менее 8 символов': 'At least 8 characters',
    'Вход в кабинет врача': 'Sign in to the dashboard',
    'Доступ к оценкам пациентов. Родителям вход не нужен — анкета открыта без регистрации.':
      'Access to patient assessments. Parents do not need an account — the questionnaire is open to everyone.',
    'Рабочая почта': 'Work email',
    'Пароль': 'Password',
    'Войти': 'Sign in',
    'Демонстрационный доступ:': 'Demo access:',
    '. Смените пароль перед публикацией.': '. Change the password before going live.',
    'Введите почту и пароль не короче 8 символов.':
      'Enter an email and a password of at least 8 characters.',
    'Не удалось войти. Проверьте данные.': 'Could not sign in. Check your details.',
    'Сервер недоступен. Попробуйте позже.': 'The server is unavailable. Try again later.',
    'Неверная почта или пароль': 'Wrong email or password',
    'Слишком много попыток. Повторите через несколько минут.':
      'Too many attempts. Try again in a few minutes.',

    'Страница не найдена — NDST': 'Page not found — NDST',
    'Страница не найдена': 'Page not found',
    'Возможно, адрес изменился или страница удалена.':
      'The address may have changed, or the page was removed.'
  });

  /* APPEND-POINT */





  /* ---------------------- Кабинет пациента ---------------------------- */

  Object.assign(D.uz, {
    "Кабинет":
      "Kabinet",
    "Кабинет пациента":
      "Bemor kabineti",
    "Кабинет пациента — NDST":
      "Bemor kabineti — NDST",
    "Личный кабинет NDST: история оценок риска ребёнка, динамика и рекомендации.":
      "NDST shaxsiy kabineti: bolaning xavf baholari tarixi, dinamika va tavsiyalar.",
    "История":
      "Tarix",
    "Дети":
      "Bolalar",
    "Рекомендации":
      "Tavsiyalar",
    "Действия":
      "Amallar",
    "Пройти анкету":
      "Soʻrovnomani toʻldirish",
    "Родитель":
      "Ota-ona",
    "Все дети":
      "Barcha bolalar",
    "Выбрать ребёнка":
      "Bolani tanlash",
    "Без профиля":
      "Profilsiz",
    "Кабинет показывает только ваши оценки. Врач видит их без имени ребёнка — имя хранится здесь и никуда не передаётся.":
      "Kabinet faqat sizning baholaringizni koʻrsatadi. Shifokor ularni bolaning ismisiz koʻradi — ism shu yerda saqlanadi va hech qayerga uzatilmaydi.",
    "Последняя оценка и динамика":
      "Oxirgi baho va dinamika",
    "Изменение":
      "Oʻzgarish",
    "Отметка врача":
      "Shifokor belgisi",
    "Динамика риска":
      "Xavf dinamikasi",
    "Балл по каждой пройденной анкете":
      "Har bir toʻldirilgan soʻrovnoma boʻyicha ball",
    "График изменения балла риска по датам анкет":
      "Soʻrovnoma sanalari boʻyicha xavf balli oʻzgarishi grafigi",
    "Пока нет ни одной оценки — пройдите анкету, и здесь появится динамика.":
      "Hozircha birorta baho yoʻq — soʻrovnomani toʻldiring, shunda bu yerda dinamika paydo boʻladi.",
    "Что повлияло на результат":
      "Natijaga nima taʼsir qildi",
    "Ближайший шаг":
      "Keyingi qadam",
    "Что стоит сделать по итогам последней анкеты":
      "Oxirgi soʻrovnoma natijasi boʻyicha nima qilish kerak",
    "Все рекомендации":
      "Barcha tavsiyalar",
    "Пройдите анкету, чтобы увидеть результат.":
      "Natijani koʻrish uchun soʻrovnomani toʻldiring.",
    "Пройдите анкету — после неё здесь появится понятный следующий шаг.":
      "Soʻrovnomani toʻldiring — shundan keyin bu yerda aniq keyingi qadam paydo boʻladi.",
    "анкет пока нет":
      "hozircha soʻrovnomalar yoʻq",
    "в кабинете":
      "kabinetda",
    "по сравнению с прошлой анкетой":
      "oldingi soʻrovnomaga nisbatan",
    "нужны хотя бы две анкеты одного ребёнка":
      "bitta bolaning kamida ikkita soʻrovnomasi kerak",
    "врач отметил повторный контроль":
      "shifokor takroriy nazoratni belgilagan",
    "повторный контроль не назначен":
      "takroriy nazorat tayinlanmagan",
    "оценок на повторном контроле":
      "baho takroriy nazoratda",
    "Привязать оценку по коду":
      "Bahoni kod boʻyicha bogʻlash",
    "Если анкету проходили без входа, введите код с экрана результата":
      "Agar soʻrovnoma tizimga kirmasdan toʻldirilgan boʻlsa, natija ekranidagi kodni kiriting",
    "Код оценки":
      "Baho kodi",
    "Например, 3b51AujIQrbr":
      "Masalan, 3b51AujIQrbr",
    "Кому засчитать":
      "Kimga yozilsin",
    "Без привязки к ребёнку":
      "Bolaga bogʻlamasdan",
    "Привязать":
      "Bogʻlash",
    "Оценка добавлена в кабинет.":
      "Baho kabinetga qoʻshildi.",
    "Введите код с экрана результата.":
      "Natija ekranidagi kodni kiriting.",
    "Не удалось привязать оценку.":
      "Bahoni bogʻlab boʻlmadi.",
    "Оценка с таким кодом не найдена":
      "Bunday kodli baho topilmadi",
    "Эта оценка уже привязана к другому кабинету":
      "Bu baho boshqa kabinetga bogʻlangan",
    "Пройденные анкеты":
      "Toʻldirilgan soʻrovnomalar",
    "Свежие сверху":
      "Yangilari yuqorida",
    "Здесь появятся пройденные анкеты. Уже есть код — привяжите его формой выше.":
      "Bu yerda toʻldirilgan soʻrovnomalar paydo boʻladi. Kodingiz bor boʻlsa — yuqoridagi shakl orqali bogʻlang.",
    "пока пусто":
      "hozircha boʻsh",
    "Профили нужны, чтобы история не смешивалась между детьми":
      "Profillar bolalarning tarixi aralashib ketmasligi uchun kerak",
    "Добавить ребёнка":
      "Bola qoʻshish",
    "Изменить профиль":
      "Profilni oʻzgartirish",
    "Имя видно только вам: врачу оценка приходит без него":
      "Ism faqat sizga koʻrinadi: shifokorga baho ismsiz boradi",
    "Имя":
      "Ism",
    "Как зовут ребёнка":
      "Bolaning ismi",
    "Пол":
      "Jinsi",
    "Не указан":
      "Koʻrsatilmagan",
    "Год рождения":
      "Tugʻilgan yili",
    "Добавить":
      "Qoʻshish",
    "Сохранить":
      "Saqlash",
    "Изменить":
      "Oʻzgartirish",
    "Удалить":
      "Oʻchirish",
    "Профилей пока нет":
      "Hozircha profillar yoʻq",
    "Добавьте ребёнка, чтобы история оценок не смешивалась. Без профиля оценки тоже сохраняются.":
      "Baholar tarixi aralashib ketmasligi uchun bola qoʻshing. Profilsiz ham baholar saqlanadi.",
    "возраст не указан":
      "yoshi koʻrsatilmagan",
    "последний балл":
      "oxirgi ball",
    "Укажите имя ребёнка.":
      "Bolaning ismini koʻrsating.",
    "Не удалось сохранить профиль. Проверьте год рождения.":
      "Profilni saqlab boʻlmadi. Tugʻilgan yilini tekshiring.",
    "Удалить профиль «{name}»? Оценки останутся в кабинете, но потеряют привязку к ребёнку.":
      "«{name}» profili oʻchirilsinmi? Baholar kabinetda qoladi, lekin bolaga bogʻlanishini yoʻqotadi.",
    "Ребёнок не найден":
      "Bola topilmadi",
    "По последней пройденной анкете":
      "Oxirgi toʻldirilgan soʻrovnoma boʻyicha",
    "По анкете от {date}":
      "{date} sanasidagi soʻrovnoma boʻyicha",
    "Когда нужна неотложная помощь":
      "Qachon shoshilinch yordam kerak",
    "Вызывайте скорую, если у ребёнка появились запах ацетона изо рта и частое глубокое дыхание, многократная рвота с сильной болью в животе или спутанность сознания и выраженная сонливость. Эти признаки не ждут приёма.":
      "Bolada ogʻizdan atseton hidi va tez-tez chuqur nafas olish, qayta-qayta qusish bilan qorinda kuchli ogʻriq yoki ongning chalkashishi va kuchli uyquchanlik paydo boʻlsa, tez yordam chaqiring. Bu belgilar qabulni kutmaydi.",
    "О чём рассказать врачу":
      "Shifokorga nima haqida aytish kerak",
    "Пункты, которые повлияли на результат":
      "Natijaga taʼsir qilgan bandlar",
    "Значимых факторов не отмечено — расскажите врачу об общем самочувствии ребёнка.":
      "Muhim omillar belgilanmagan — shifokorga bolaning umumiy ahvoli haqida aytib bering.",
    "Что можно изменить самим":
      "Oʻzingiz nimani oʻzgartira olasiz",
    "Только то, что зависит от семьи, а не от назначений":
      "Faqat oilaga bogʻliq narsalar, tayinlovlarga emas",
    "Рекомендации появятся после первой пройденной анкеты.":
      "Tavsiyalar birinchi soʻrovnoma toʻldirilgandan keyin paydo boʻladi.",
    "оценка описывает факторы риска и не является медицинским диагнозом. Решение об обследовании принимает врач после осмотра.":
      "baho xavf omillarini tavsiflaydi va tibbiy tashxis emas. Tekshiruv haqidagi qarorni shifokor koʻrikdan keyin qabul qiladi.",
    "Запишитесь к врачу в ближайшие дни":
      "Yaqin kunlarda shifokorga yoziling",
    "Результат показывает заметное сочетание факторов. Обратитесь к педиатру или детскому эндокринологу и покажите эту сводку — по ней врач поймёт, что именно вы отметили.":
      "Natija omillarning sezilarli birikmasini koʻrsatmoqda. Pediatr yoki bolalar endokrinologiga murojaat qiling va ushbu xulosani koʻrsating — undan shifokor aynan nimani belgilaganingizni tushunadi.",
    "Повторите анкету после приёма или если появятся новые симптомы.":
      "Qabuldan keyin yoki yangi alomatlar paydo boʻlsa, soʻrovnomani qayta toʻldiring.",
    "Обсудите результат на ближайшем приёме":
      "Natijani yaqin qabulda muhokama qiling",
    "Срочности нет, но факторы стоит проговорить с педиатром — он решит, нужны ли анализы. Если симптомы усилятся, не ждите планового приёма.":
      "Shoshilinch holat yoʻq, lekin omillarni pediatr bilan gaplashib olish kerak — tahlillar zarurligini u hal qiladi. Alomatlar kuchaysa, rejali qabulni kutmang.",
    "Повторите анкету через 1–3 месяца или раньше при изменениях.":
      "Soʻrovnomani 1–3 oydan keyin yoki oʻzgarishlar boʻlsa, undan oldin qayta toʻldiring.",
    "Достаточно планового наблюдения":
      "Rejali kuzatuv yetarli",
    "Значимых сочетаний факторов сейчас не видно. Отдельно отметьте появление жажды, учащённого мочеиспускания и потери веса — это ключевая тройка признаков.":
      "Hozircha omillarning muhim birikmasi koʻrinmayapti. Chanqoq, tez-tez siyish va vazn yoʻqotish paydo boʻlishiga alohida eʼtibor bering — bu asosiy uchlik.",
    "Повторите анкету через 6 месяцев или при первых симптомах.":
      "Soʻrovnomani 6 oydan keyin yoki dastlabki alomatlarda qayta toʻldiring.",
    "Добавьте ребёнку регулярную нагрузку: подойдёт час активных игр или прогулки в день.":
      "Bolaga muntazam jismoniy faollik qoʻshing: kuniga bir soat faol oʻyin yoki sayr yetarli.",
    "Замените сладкие напитки водой — это самая простая из перемен и заметная по эффекту.":
      "Shirin ichimliklarni suv bilan almashtiring — bu eng oddiy va sezilarli taʼsir beradigan oʻzgarish.",
    "Обсудите с педиатром питание и вес: снижение даже небольшой части лишнего веса улучшает чувствительность к инсулину.":
      "Pediatr bilan ovqatlanish va vaznni muhokama qiling: ortiqcha vaznning ozgina qismini kamaytirish ham insulinga sezgirlikni yaxshilaydi.",
    "Попросите педиатра составить план по весу — самостоятельные диеты детям не подходят.":
      "Pediatrdan vazn boʻyicha reja tuzishni soʻrang — bolalarga mustaqil parhezlar toʻgʻri kelmaydi.",
    "Вход в кабинет пациента":
      "Bemor kabinetiga kirish",
    "Вход в кабинет пациента — NDST":
      "Bemor kabinetiga kirish — NDST",
    "Вход в личный кабинет NDST для родителей.":
      "Ota-onalar uchun NDST shaxsiy kabinetiga kirish.",
    "История оценок ребёнка и рекомендации в одном месте. Анкету можно пройти и без входа — код с экрана результата вы привяжете позже.":
      "Bolaning baholar tarixi va tavsiyalar bir joyda. Soʻrovnomani tizimga kirmasdan ham toʻldirish mumkin — natija ekranidagi kodni keyinroq bogʻlaysiz.",
    "Почта":
      "Pochta",
    "Ещё нет учётной записи?":
      "Hisobingiz yoʻqmi?",
    "Зарегистрироваться":
      "Roʻyxatdan oʻtish",
    "Регистрация в кабинете пациента — NDST":
      "Bemor kabinetida roʻyxatdan oʻtish — NDST",
    "Регистрация в личном кабинете NDST для родителей.":
      "Ota-onalar uchun NDST shaxsiy kabinetida roʻyxatdan oʻtish.",
    "Регистрация родителя":
      "Ota-ona roʻyxatdan oʻtishi",
    "Нужна только почта и пароль. Имя ребёнка вы добавите уже в кабинете — в анкету оно не попадает и врачу не передаётся.":
      "Faqat pochta va parol kerak. Bolaning ismini kabinetda qoʻshasiz — u soʻrovnomaga tushmaydi va shifokorga uzatilmaydi.",
    "Как к вам обращаться":
      "Sizga qanday murojaat qilaylik",
    "Имя или имя и фамилия":
      "Ism yoki ism va familiya",
    "Создать кабинет":
      "Kabinet yaratish",
    "Уже регистрировались?":
      "Allaqachon roʻyxatdan oʻtganmisiz?",
    "Войти":
      "Kirish",
    "Укажите, как к вам обращаться.":
      "Sizga qanday murojaat qilishni koʻrsating.",
    "Такая почта уже зарегистрирована":
      "Bunday pochta allaqachon roʻyxatdan oʻtgan",
    "Вы родитель?":
      "Siz ota-onamisiz?",
    "Доступ к оценкам пациентов. Родителям сюда не нужно — анкета открыта без регистрации, а история ребёнка живёт в кабинете пациента.":
      "Bemorlar baholariga kirish. Ota-onalarga bu yerga kerak emas — soʻrovnoma roʻyxatdan oʻtmasdan ochiq, bolaning tarixi esa bemor kabinetida.",
    "Записать в историю ребёнка":
      "Bolaning tarixiga yozish",
    "Оценка сохранена в ваш":
      "Baho saqlandi:",
    "кабинет пациента":
      "bemor kabinetingizga",
    "Сохраните код: с ним оценку можно добавить в":
      "Kodni saqlang: u bilan bahoni",
    "и следить за динамикой.":
      "qoʻshib, dinamikani kuzatish mumkin.",
    "График динамики количества оценок по месяцам":
      "Oylar boʻyicha baholar sonining dinamikasi grafigi",
    "Круговая диаграмма распределения уровней риска":
      "Xavf darajalari taqsimotining doiraviy diagrammasi",
    "Итоговая оценка риска":
      "Yakuniy xavf bahosi",
    "Оценка риска 68 процентов":
      "Xavf bahosi 68 foiz",
    "Кривая перевода суммы баллов в оценку риска: насыщение, границы уровней на 25 и 60 процентах":
      "Ballar yigʻindisini xavf bahosiga oʻtkazish egri chizigʻi: toʻyinish, darajalar chegarasi 25 va 60 foizda",
    "Фотография ребёнка в кадре медицинской схемы: вокруг — сеть измеряемых показателей: рост, ИМТ, симптомы, анамнез":
      "Tibbiy sxema ramkasidagi bola surati: atrofida oʻlchanadigan koʻrsatkichlar toʻri: boʻy, TVI, alomatlar, anamnez",
    "Новая оценка":
      "Yangi baho"
  });

  Object.assign(D.en, {
    "Кабинет":
      "Portal",
    "Кабинет пациента":
      "Patient portal",
    "Кабинет пациента — NDST":
      "Patient portal — NDST",
    "Личный кабинет NDST: история оценок риска ребёнка, динамика и рекомендации.":
      "NDST personal portal: your child’s risk assessment history, trend and recommendations.",
    "История":
      "History",
    "Дети":
      "Children",
    "Рекомендации":
      "Recommendations",
    "Действия":
      "Actions",
    "Пройти анкету":
      "Take the questionnaire",
    "Родитель":
      "Parent",
    "Все дети":
      "All children",
    "Выбрать ребёнка":
      "Select a child",
    "Без профиля":
      "No profile",
    "Кабинет показывает только ваши оценки. Врач видит их без имени ребёнка — имя хранится здесь и никуда не передаётся.":
      "The portal shows only your assessments. The doctor sees them without the child’s name — the name is stored here and is never sent anywhere.",
    "Последняя оценка и динамика":
      "Latest assessment and trend",
    "Изменение":
      "Change",
    "Отметка врача":
      "Doctor’s flag",
    "Динамика риска":
      "Risk over time",
    "Балл по каждой пройденной анкете":
      "Score for each completed questionnaire",
    "График изменения балла риска по датам анкет":
      "Chart of risk score change by questionnaire date",
    "Пока нет ни одной оценки — пройдите анкету, и здесь появится динамика.":
      "No assessments yet — complete the questionnaire and the trend will appear here.",
    "Что повлияло на результат":
      "What shaped the result",
    "Ближайший шаг":
      "Next step",
    "Что стоит сделать по итогам последней анкеты":
      "What to do based on the latest questionnaire",
    "Все рекомендации":
      "All recommendations",
    "Пройдите анкету, чтобы увидеть результат.":
      "Complete the questionnaire to see the result.",
    "Пройдите анкету — после неё здесь появится понятный следующий шаг.":
      "Complete the questionnaire — a clear next step will appear here afterwards.",
    "анкет пока нет":
      "no questionnaires yet",
    "в кабинете":
      "in the portal",
    "по сравнению с прошлой анкетой":
      "compared with the previous questionnaire",
    "нужны хотя бы две анкеты одного ребёнка":
      "at least two questionnaires for the same child are needed",
    "врач отметил повторный контроль":
      "the doctor flagged a follow-up",
    "повторный контроль не назначен":
      "no follow-up scheduled",
    "оценок на повторном контроле":
      "assessments flagged for follow-up",
    "Привязать оценку по коду":
      "Link an assessment by code",
    "Если анкету проходили без входа, введите код с экрана результата":
      "If the questionnaire was completed without signing in, enter the code from the result screen",
    "Код оценки":
      "Assessment code",
    "Например, 3b51AujIQrbr":
      "For example, 3b51AujIQrbr",
    "Кому засчитать":
      "Assign to",
    "Без привязки к ребёнку":
      "Not linked to a child",
    "Привязать":
      "Link",
    "Оценка добавлена в кабинет.":
      "The assessment was added to your portal.",
    "Введите код с экрана результата.":
      "Enter the code from the result screen.",
    "Не удалось привязать оценку.":
      "The assessment could not be linked.",
    "Оценка с таким кодом не найдена":
      "No assessment found with that code",
    "Эта оценка уже привязана к другому кабинету":
      "That assessment is already linked to another portal",
    "Пройденные анкеты":
      "Completed questionnaires",
    "Свежие сверху":
      "Newest first",
    "Здесь появятся пройденные анкеты. Уже есть код — привяжите его формой выше.":
      "Completed questionnaires will appear here. Already have a code? Link it with the form above.",
    "пока пусто":
      "nothing yet",
    "Профили нужны, чтобы история не смешивалась между детьми":
      "Profiles keep each child’s history separate",
    "Добавить ребёнка":
      "Add a child",
    "Изменить профиль":
      "Edit profile",
    "Имя видно только вам: врачу оценка приходит без него":
      "The name is visible only to you — the doctor receives the assessment without it",
    "Имя":
      "Name",
    "Как зовут ребёнка":
      "Child’s name",
    "Пол":
      "Sex",
    "Не указан":
      "Not specified",
    "Год рождения":
      "Year of birth",
    "Добавить":
      "Add",
    "Сохранить":
      "Save",
    "Изменить":
      "Edit",
    "Удалить":
      "Delete",
    "Профилей пока нет":
      "No profiles yet",
    "Добавьте ребёнка, чтобы история оценок не смешивалась. Без профиля оценки тоже сохраняются.":
      "Add a child so the history stays separate. Assessments are saved without a profile too.",
    "возраст не указан":
      "age not specified",
    "последний балл":
      "latest score",
    "Укажите имя ребёнка.":
      "Enter the child’s name.",
    "Не удалось сохранить профиль. Проверьте год рождения.":
      "The profile could not be saved. Check the year of birth.",
    "Удалить профиль «{name}»? Оценки останутся в кабинете, но потеряют привязку к ребёнку.":
      "Delete the profile “{name}”? The assessments stay in the portal but lose their link to the child.",
    "Ребёнок не найден":
      "Child not found",
    "По последней пройденной анкете":
      "Based on the most recent questionnaire",
    "По анкете от {date}":
      "Based on the questionnaire from {date}",
    "Когда нужна неотложная помощь":
      "When emergency care is needed",
    "Вызывайте скорую, если у ребёнка появились запах ацетона изо рта и частое глубокое дыхание, многократная рвота с сильной болью в животе или спутанность сознания и выраженная сонливость. Эти признаки не ждут приёма.":
      "Call an ambulance if the child develops an acetone smell on the breath with rapid deep breathing, repeated vomiting with severe abdominal pain, or confusion and marked drowsiness. These signs will not wait for an appointment.",
    "О чём рассказать врачу":
      "What to tell the doctor",
    "Пункты, которые повлияли на результат":
      "The items that shaped the result",
    "Значимых факторов не отмечено — расскажите врачу об общем самочувствии ребёнка.":
      "No significant factors were marked — tell the doctor about the child’s general wellbeing.",
    "Что можно изменить самим":
      "What you can change yourselves",
    "Только то, что зависит от семьи, а не от назначений":
      "Only what the family controls, not what the doctor prescribes",
    "Рекомендации появятся после первой пройденной анкеты.":
      "Recommendations will appear after the first completed questionnaire.",
    "оценка описывает факторы риска и не является медицинским диагнозом. Решение об обследовании принимает врач после осмотра.":
      "the assessment describes risk factors and is not a medical diagnosis. The decision to investigate is made by a doctor after an examination.",
    "Запишитесь к врачу в ближайшие дни":
      "Book a doctor’s appointment within the next few days",
    "Результат показывает заметное сочетание факторов. Обратитесь к педиатру или детскому эндокринологу и покажите эту сводку — по ней врач поймёт, что именно вы отметили.":
      "The result shows a notable combination of factors. See a paediatrician or a paediatric endocrinologist and show them this summary — it tells the doctor exactly what you marked.",
    "Повторите анкету после приёма или если появятся новые симптомы.":
      "Retake the questionnaire after the appointment, or if new symptoms appear.",
    "Обсудите результат на ближайшем приёме":
      "Discuss the result at your next appointment",
    "Срочности нет, но факторы стоит проговорить с педиатром — он решит, нужны ли анализы. Если симптомы усилятся, не ждите планового приёма.":
      "There is no urgency, but the factors are worth raising with a paediatrician, who will decide whether tests are needed. If symptoms worsen, do not wait for the scheduled visit.",
    "Повторите анкету через 1–3 месяца или раньше при изменениях.":
      "Retake the questionnaire in one to three months, or sooner if things change.",
    "Достаточно планового наблюдения":
      "Routine monitoring is enough",
    "Значимых сочетаний факторов сейчас не видно. Отдельно отметьте появление жажды, учащённого мочеиспускания и потери веса — это ключевая тройка признаков.":
      "No significant combination of factors is visible right now. Watch especially for thirst, frequent urination and weight loss — that is the key triad.",
    "Повторите анкету через 6 месяцев или при первых симптомах.":
      "Retake the questionnaire in six months, or at the first symptoms.",
    "Добавьте ребёнку регулярную нагрузку: подойдёт час активных игр или прогулки в день.":
      "Give the child regular activity: an hour of active play or walking a day is enough.",
    "Замените сладкие напитки водой — это самая простая из перемен и заметная по эффекту.":
      "Swap sugary drinks for water — the simplest change, and one with a visible effect.",
    "Обсудите с педиатром питание и вес: снижение даже небольшой части лишнего веса улучшает чувствительность к инсулину.":
      "Discuss diet and weight with a paediatrician: losing even part of the excess weight improves insulin sensitivity.",
    "Попросите педиатра составить план по весу — самостоятельные диеты детям не подходят.":
      "Ask a paediatrician to draw up a weight plan — self-directed diets are not suitable for children.",
    "Вход в кабинет пациента":
      "Sign in to the patient portal",
    "Вход в кабинет пациента — NDST":
      "Patient portal sign-in — NDST",
    "Вход в личный кабинет NDST для родителей.":
      "Sign in to the NDST personal portal for parents.",
    "История оценок ребёнка и рекомендации в одном месте. Анкету можно пройти и без входа — код с экрана результата вы привяжете позже.":
      "Your child’s assessment history and recommendations in one place. You can take the questionnaire without signing in — link the code from the result screen later.",
    "Почта":
      "Email",
    "Ещё нет учётной записи?":
      "No account yet?",
    "Зарегистрироваться":
      "Sign up",
    "Регистрация в кабинете пациента — NDST":
      "Patient portal sign-up — NDST",
    "Регистрация в личном кабинете NDST для родителей.":
      "Sign up for the NDST personal portal for parents.",
    "Регистрация родителя":
      "Parent sign-up",
    "Нужна только почта и пароль. Имя ребёнка вы добавите уже в кабинете — в анкету оно не попадает и врачу не передаётся.":
      "Only an email and password are needed. You will add the child’s name inside the portal — it never enters the questionnaire and is not sent to the doctor.",
    "Как к вам обращаться":
      "What should we call you",
    "Имя или имя и фамилия":
      "First name, or first and last name",
    "Создать кабинет":
      "Create portal",
    "Уже регистрировались?":
      "Already registered?",
    "Войти":
      "Sign in",
    "Укажите, как к вам обращаться.":
      "Tell us what to call you.",
    "Такая почта уже зарегистрирована":
      "That email is already registered",
    "Вы родитель?":
      "Are you a parent?",
    "Доступ к оценкам пациентов. Родителям сюда не нужно — анкета открыта без регистрации, а история ребёнка живёт в кабинете пациента.":
      "Access to patient assessments. Parents do not need this page — the questionnaire is open without sign-up, and the child’s history lives in the patient portal.",
    "Записать в историю ребёнка":
      "Save to a child’s history",
    "Оценка сохранена в ваш":
      "The assessment was saved to your",
    "кабинет пациента":
      "patient portal",
    "Сохраните код: с ним оценку можно добавить в":
      "Keep the code: with it you can add the assessment to the",
    "и следить за динамикой.":
      "and follow the trend.",
    "График динамики количества оценок по месяцам":
      "Chart of assessment counts by month",
    "Круговая диаграмма распределения уровней риска":
      "Donut chart of risk level distribution",
    "Итоговая оценка риска":
      "Final risk score",
    "Оценка риска 68 процентов":
      "Risk score 68 percent",
    "Кривая перевода суммы баллов в оценку риска: насыщение, границы уровней на 25 и 60 процентах":
      "Curve converting the point total into a risk score: saturation, with level boundaries at 25 and 60 percent",
    "Фотография ребёнка в кадре медицинской схемы: вокруг — сеть измеряемых показателей: рост, ИМТ, симптомы, анамнез":
      "Photo of a child inside a medical schematic frame, surrounded by a network of measured indicators: height, BMI, symptoms, history",
    "Новая оценка":
      "New assessment"
  });

  /* ------ Анкета: питание, среда и соединительная ткань --------------- */

  Object.assign(D.uz, {
    "Упорный зуд кожи или в области промежности":
      "Teri yoki chot sohasidagi qattiq qichishish",
    "Зуд, который не проходит, и повторяющаяся молочница":
      "Oʻtib ketmaydigan qichishish va qaytalanuvchi kandidoz",
    "Нарушения ночного сна":
      "Tungi uyqu buzilishi",
    "Частые пробуждения, в том числе из-за походов в туалет":
      "Tez-tez uygʻonish, shu jumladan hojatxonaga borish sababli",
    "Сухость кожи":
      "Teri quruqligi",
    "Диабет 1 типа у бабушки или дедушки":
      "Buvi yoki bobosida 1-tur diabet",
    "Диабет 2 типа у бабушки или дедушки":
      "Buvi yoki bobosida 2-tur diabet",
    "Диабет 2 типа у родителя, брата или сестры":
      "Ota-ona, aka-uka yoki opa-singilda 2-tur diabet",
    "Вторая линия родства — вес меньше, чем у первой":
      "Ikkinchi darajali qarindoshlik — vazni birinchisidan kam",
    "Учитывается отдельно от родителей, братьев и сестёр":
      "Ota-ona, aka-uka va opa-singillardan alohida hisobga olinadi",
    "Первая линия родства":
      "Birinchi darajali qarindoshlik",
    "Ферментопатии или нарушения обмена у родителей":
      "Ota-onasida fermentopatiya yoki modda almashinuvi buzilishi",
    "Например, непереносимость лактозы, целиакия, наследственные обменные болезни":
      "Masalan, laktozaga chidamsizlik, seliakiya, irsiy modda almashinuvi kasalliklari",
    "Условия жизни":
      "Turmush sharoiti",
    "Длительная стрессовая обстановка в семье":
      "Oilada uzoq davom etgan stressli vaziyat",
    "Затяжной конфликт, тяжёлая болезнь или утрата близкого, переезд":
      "Choʻzilgan nizo, yaqin kishining ogʻir kasalligi yoki yoʻqotilishi, koʻchish",
    "Ограниченные материальные возможности семьи":
      "Oilaning moddiy imkoniyatlari cheklangan",
    "Сказываются на питании и на том, как быстро удаётся попасть к врачу":
      "Ovqatlanishga va shifokorga qanchalik tez borish mumkinligiga taʼsir qiladi",
    "Питание":
      "Ovqatlanish",
    "Как в целом устроено питание ребёнка":
      "Bolaning ovqatlanishi umuman qanday tashkil etilgan",
    "Выберите вариант, на который рацион похож больше всего.":
      "Ratsion koʻproq oʻxshaydigan variantni tanlang.",
    "Затрудняюсь ответить":
      "Javob berishim qiyin",
    "В целом сбалансированное":
      "Umuman muvozanatli",
    "Нерегулярное, с пропусками приёмов пищи":
      "Tartibsiz, ovqatlanishni oʻtkazib yuborish bilan",
    "Много сладостей и выпечки каждый день":
      "Har kuni koʻp shirinlik va pishiriq",
    "Преобладают фастфуд и готовые продукты":
      "Fastfud va tayyor mahsulotlar ustunlik qiladi",
    "Какую часть рациона составляют углеводы":
      "Ratsionning qanday qismini uglevodlar tashkil qiladi",
    "Углеводы — это хлеб, каши, макароны, картофель, фрукты и сладости. Оцените на глаз по обычной тарелке.":
      "Uglevodlar — bu non, boʻtqa, makaron, kartoshka, mevalar va shirinliklar. Odatdagi likopchaga qarab chamalab baholang.",
    "Затрудняюсь оценить":
      "Baholashim qiyin",
    "Меньше трети":
      "Uchdan biridan kam",
    "Около половины":
      "Taxminan yarmi",
    "Больше половины":
      "Yarmidan koʻp",
    "Основная часть рациона":
      "Ratsionning asosiy qismi",
    "Характер питания не указан":
      "Ovqatlanish tavsifi koʻrsatilmagan",
    "Питание в целом сбалансированное":
      "Ovqatlanish umuman muvozanatli",
    "Нерегулярное питание, пропуски приёмов пищи":
      "Tartibsiz ovqatlanish, ovqatlanishni oʻtkazib yuborish",
    "Долю углеводов оценить не удалось":
      "Uglevodlar ulushini baholab boʻlmadi",
    "Углеводы — меньше трети рациона":
      "Uglevodlar — ratsionning uchdan biridan kam",
    "Углеводы — около половины рациона":
      "Uglevodlar — ratsionning taxminan yarmi",
    "Углеводы — больше половины рациона":
      "Uglevodlar — ratsionning yarmidan koʻp",
    "Углеводы — основная часть рациона":
      "Uglevodlar — ratsionning asosiy qismi",
    "Группа крови ребёнка":
      "Bolaning qon guruhi",
    "Не знаю":
      "Bilmayman",
    "На балл не влияет: связь группы крови с диабетом в исследованиях противоречива. Сохраняем для врача.":
      "Ballga taʼsir qilmaydi: qon guruhi va diabet oʻrtasidagi bogʻliqlik tadqiqotlarda ziddiyatli. Shifokor uchun saqlaymiz.",
    "Справочно, на балл не влияет:":
      "Maʼlumot uchun, ballga taʼsir qilmaydi:",
    "Группа крови не указана":
      "Qon guruhi koʻrsatilmagan",
    "Группа крови O (I)":
      "Qon guruhi O (I)",
    "Группа крови A (II)":
      "Qon guruhi A (II)",
    "Группа крови B (III)":
      "Qon guruhi B (III)",
    "Группа крови AB (IV)":
      "Qon guruhi AB (IV)",
    "Соединительная ткань":
      "Biriktiruvchi toʻqima",
    "Далее: соединительная ткань":
      "Keyingi: biriktiruvchi toʻqima",
    "Признаки со стороны соединительной ткани":
      "Biriktiruvchi toʻqima tomonidan belgilar",
    "Недифференцированная дисплазия соединительной ткани — фон, на котором нарушения углеводного обмена выявляют раньше. Поодиночке эти признаки встречаются и у здоровых детей, поэтому важно их число, а не каждый по отдельности. Отмечайте только то, в чём уверены.":
      "Differensiallanmagan biriktiruvchi toʻqima displaziyasi — uglevod almashinuvi buzilishlari erta aniqlanadigan fon. Bu belgilar alohida holda sogʻlom bolalarda ham uchraydi, shuning uchun ularning soni muhim, har biri alohida emas. Faqat ishonchingiz komil boʻlganini belgilang.",
    "Опорно-двигательный аппарат":
      "Tayanch-harakat apparati",
    "Повышенная подвижность суставов":
      "Boʻgʻimlarning ortiqcha harakatchanligi",
    "Сколиоз или выраженное нарушение осанки":
      "Skolioz yoki qomatning sezilarli buzilishi",
    "Плоскостопие":
      "Yassioyoqlik",
    "Деформация грудной клетки":
      "Koʻkrak qafasi deformatsiyasi",
    "Воронкообразная или килевидная":
      "Voronkasimon yoki kilsimon",
    "Астеническое телосложение, длинные тонкие пальцы":
      "Astenik tana tuzilishi, uzun ingichka barmoqlar",
    "Кожа, зубы, зрение":
      "Teri, tishlar, koʻrish",
    "Тонкая растяжимая кожа, стрии, атрофические рубцы":
      "Ingichka choʻziluvchan teri, striyalar, atrofik chandiqlar",
    "Кожа легко оттягивается, рубцы широкие и втянутые":
      "Teri oson tortiladi, chandiqlar keng va ichkariga tortilgan",
    "Лёгкое образование синяков, кровоточивость дёсен":
      "Osongina koʻkarish, milk qonashi",
    "Аномалии прикуса, скученность зубов, высокое нёбо":
      "Tishlov anomaliyalari, tishlarning zich joylashuvi, baland tanglay",
    "Близорукость":
      "Miyopiya (yaqindan koʻrish)",
    "Внутренние органы":
      "Ichki aʼzolar",
    "Пролапс митрального клапана или малая аномалия сердца":
      "Mitral klapan prolapsi yoki yurakning kichik anomaliyasi",
    "Обычно находят на УЗИ сердца":
      "Odatda yurak UTTsida aniqlanadi",
    "Грыжи, варикоз, опущение органов":
      "Churralar, varikoz, aʼzolar tushishi",
    "Признаки дисплазии соединительной ткани":
      "Biriktiruvchi toʻqima displaziyasi belgilari",
    "Признаки дисплазии соединительной ткани умеренные":
      "Biriktiruvchi toʻqima displaziyasi belgilari oʻrtacha",
    "Признаки дисплазии соединительной ткани выражены":
      "Biriktiruvchi toʻqima displaziyasi belgilari aniq ifodalangan",
    "Шаг 1 из 5":
      "Bosqich 1 / 5",
    "Шаг {n} из {total}":
      "Bosqich {n} / {total}",
    "Пять шагов от анкеты до понятного результата":
      "Soʻrovnomadan tushunarli natijagacha besh bosqich",
    "Полная анкета занимает около семи минут — пять коротких шагов.":
      "Toʻliq soʻrovnoma taxminan yetti daqiqa vaqt oladi — besh qisqa bosqich.",
    "Занимает около семи минут · без регистрации":
      "Taxminan yetti daqiqa · roʻyxatdan oʻtmasdan",
    "~7 минут":
      "~7 daqiqa",
    "5 шагов · ~7 минут":
      "5 bosqich · ~7 daqiqa",
    "38 признаков · веса по значимости":
      "38 belgi · ahamiyatiga koʻra vaznlar",
    "12 признаков · длительность":
      "12 belgi · davomiyligi",
    "15 факторов · питание · среда":
      "15 omil · ovqatlanish · muhit",
    "11 признаков · НДСТ":
      "11 belgi · DBTD",
    "Признаки недифференцированной дисплазии — фон, на котором нарушения обмена выявляют раньше.":
      "Differensiallanmagan displaziya belgilari — modda almashinuvi buzilishlari erta aniqlanadigan fon.",
    "симптомы, анамнез, питание и соединительная ткань":
      "alomatlar, anamnez, ovqatlanish va biriktiruvchi toʻqima",
    "Пять шагов: данные о ребёнке, симптомы, факторы риска, признаки дисплазии соединительной ткани и понятный результат с разбором повлиявших факторов.":
      "Besh bosqich: bola haqidagi maʼlumotlar, alomatlar, xavf omillari, biriktiruvchi toʻqima displaziyasi belgilari va taʼsir qilgan omillar tahlili bilan tushunarli natija.",
    "Переразгибание локтей и коленей, большой палец достаёт до предплечья":
      "Tirsak va tizzalarning ortiqcha yozilishi, bosh barmoq bilakka tegadi"
  });

  Object.assign(D.en, {
    "Упорный зуд кожи или в области промежности":
      "Persistent itching of the skin or the genital area",
    "Зуд, который не проходит, и повторяющаяся молочница":
      "Itching that does not go away, and recurring thrush",
    "Нарушения ночного сна":
      "Disturbed night sleep",
    "Частые пробуждения, в том числе из-за походов в туалет":
      "Frequent waking, including trips to the toilet",
    "Сухость кожи":
      "Dry skin",
    "Диабет 1 типа у бабушки или дедушки":
      "Type 1 diabetes in a grandparent",
    "Диабет 2 типа у бабушки или дедушки":
      "Type 2 diabetes in a grandparent",
    "Диабет 2 типа у родителя, брата или сестры":
      "Type 2 diabetes in a parent or sibling",
    "Вторая линия родства — вес меньше, чем у первой":
      "Second-degree relative — weighted less than first-degree",
    "Учитывается отдельно от родителей, братьев и сестёр":
      "Counted separately from parents and siblings",
    "Первая линия родства":
      "First-degree relative",
    "Ферментопатии или нарушения обмена у родителей":
      "Enzyme or metabolic disorders in the parents",
    "Например, непереносимость лактозы, целиакия, наследственные обменные болезни":
      "For example lactose intolerance, coeliac disease, inherited metabolic disorders",
    "Условия жизни":
      "Living conditions",
    "Длительная стрессовая обстановка в семье":
      "Prolonged stressful situation in the family",
    "Затяжной конфликт, тяжёлая болезнь или утрата близкого, переезд":
      "A drawn-out conflict, serious illness or loss of a close relative, relocation",
    "Ограниченные материальные возможности семьи":
      "Limited financial means in the family",
    "Сказываются на питании и на том, как быстро удаётся попасть к врачу":
      "This affects the diet and how quickly the child can be seen by a doctor",
    "Питание":
      "Diet",
    "Как в целом устроено питание ребёнка":
      "How the child’s diet is arranged overall",
    "Выберите вариант, на который рацион похож больше всего.":
      "Pick the option the diet resembles most closely.",
    "Затрудняюсь ответить":
      "Hard to say",
    "В целом сбалансированное":
      "Broadly balanced",
    "Нерегулярное, с пропусками приёмов пищи":
      "Irregular, with skipped meals",
    "Много сладостей и выпечки каждый день":
      "A lot of sweets and baked goods every day",
    "Преобладают фастфуд и готовые продукты":
      "Fast food and ready-made products dominate",
    "Какую часть рациона составляют углеводы":
      "What share of the diet is carbohydrates",
    "Углеводы — это хлеб, каши, макароны, картофель, фрукты и сладости. Оцените на глаз по обычной тарелке.":
      "Carbohydrates are bread, porridge, pasta, potatoes, fruit and sweets. Estimate by eye from a typical plate.",
    "Затрудняюсь оценить":
      "Hard to estimate",
    "Меньше трети":
      "Less than a third",
    "Около половины":
      "About half",
    "Больше половины":
      "More than half",
    "Основная часть рациона":
      "The bulk of the diet",
    "Характер питания не указан":
      "Dietary pattern not specified",
    "Питание в целом сбалансированное":
      "The diet is broadly balanced",
    "Нерегулярное питание, пропуски приёмов пищи":
      "Irregular eating, skipped meals",
    "Долю углеводов оценить не удалось":
      "The share of carbohydrates could not be estimated",
    "Углеводы — меньше трети рациона":
      "Carbohydrates make up less than a third of the diet",
    "Углеводы — около половины рациона":
      "Carbohydrates make up about half of the diet",
    "Углеводы — больше половины рациона":
      "Carbohydrates make up more than half of the diet",
    "Углеводы — основная часть рациона":
      "Carbohydrates make up the bulk of the diet",
    "Группа крови ребёнка":
      "The child’s blood group",
    "Не знаю":
      "I do not know",
    "На балл не влияет: связь группы крови с диабетом в исследованиях противоречива. Сохраняем для врача.":
      "Does not affect the score: the link between blood group and diabetes is inconsistent across studies. Stored for the doctor.",
    "Справочно, на балл не влияет:":
      "For reference, not counted in the score:",
    "Группа крови не указана":
      "Blood group not specified",
    "Группа крови O (I)":
      "Blood group O (I)",
    "Группа крови A (II)":
      "Blood group A (II)",
    "Группа крови B (III)":
      "Blood group B (III)",
    "Группа крови AB (IV)":
      "Blood group AB (IV)",
    "Соединительная ткань":
      "Connective tissue",
    "Далее: соединительная ткань":
      "Next: connective tissue",
    "Признаки со стороны соединительной ткани":
      "Signs involving the connective tissue",
    "Недифференцированная дисплазия соединительной ткани — фон, на котором нарушения углеводного обмена выявляют раньше. Поодиночке эти признаки встречаются и у здоровых детей, поэтому важно их число, а не каждый по отдельности. Отмечайте только то, в чём уверены.":
      "Undifferentiated connective tissue dysplasia is a background against which carbohydrate metabolism disorders are detected earlier. Taken one at a time these signs also occur in healthy children, so what matters is how many there are, not any single one. Mark only what you are sure of.",
    "Опорно-двигательный аппарат":
      "Musculoskeletal system",
    "Повышенная подвижность суставов":
      "Joint hypermobility",
    "Сколиоз или выраженное нарушение осанки":
      "Scoliosis or marked postural abnormality",
    "Плоскостопие":
      "Flat feet",
    "Деформация грудной клетки":
      "Chest wall deformity",
    "Воронкообразная или килевидная":
      "Funnel chest or pigeon chest",
    "Астеническое телосложение, длинные тонкие пальцы":
      "Asthenic build, long slender fingers",
    "Кожа, зубы, зрение":
      "Skin, teeth, vision",
    "Тонкая растяжимая кожа, стрии, атрофические рубцы":
      "Thin stretchy skin, striae, atrophic scars",
    "Кожа легко оттягивается, рубцы широкие и втянутые":
      "The skin pulls away easily, scars are wide and sunken",
    "Лёгкое образование синяков, кровоточивость дёсен":
      "Bruising easily, bleeding gums",
    "Аномалии прикуса, скученность зубов, высокое нёбо":
      "Bite abnormalities, crowded teeth, high-arched palate",
    "Близорукость":
      "Short-sightedness",
    "Внутренние органы":
      "Internal organs",
    "Пролапс митрального клапана или малая аномалия сердца":
      "Mitral valve prolapse or a minor cardiac anomaly",
    "Обычно находят на УЗИ сердца":
      "Usually found on a heart ultrasound",
    "Грыжи, варикоз, опущение органов":
      "Hernias, varicose veins, organ prolapse",
    "Признаки дисплазии соединительной ткани":
      "Signs of connective tissue dysplasia",
    "Признаки дисплазии соединительной ткани умеренные":
      "Signs of connective tissue dysplasia are moderate",
    "Признаки дисплазии соединительной ткани выражены":
      "Signs of connective tissue dysplasia are pronounced",
    "Шаг 1 из 5":
      "Step 1 of 5",
    "Шаг {n} из {total}":
      "Step {n} of {total}",
    "Пять шагов от анкеты до понятного результата":
      "Five steps from questionnaire to a clear result",
    "Полная анкета занимает около семи минут — пять коротких шагов.":
      "The full questionnaire takes about seven minutes — five short steps.",
    "Занимает около семи минут · без регистрации":
      "About seven minutes · no sign-up",
    "~7 минут":
      "~7 minutes",
    "5 шагов · ~7 минут":
      "5 steps · ~7 minutes",
    "38 признаков · веса по значимости":
      "38 signs · weighted by significance",
    "12 признаков · длительность":
      "12 signs · duration",
    "15 факторов · питание · среда":
      "15 factors · diet · environment",
    "11 признаков · НДСТ":
      "11 signs · UCTD",
    "Признаки недифференцированной дисплазии — фон, на котором нарушения обмена выявляют раньше.":
      "Signs of undifferentiated dysplasia are a background against which metabolic disorders are detected earlier.",
    "симптомы, анамнез, питание и соединительная ткань":
      "symptoms, history, diet and connective tissue",
    "Пять шагов: данные о ребёнке, симптомы, факторы риска, признаки дисплазии соединительной ткани и понятный результат с разбором повлиявших факторов.":
      "Five steps: details about the child, symptoms, risk factors, signs of connective tissue dysplasia, and a clear result with a breakdown of what shaped it.",
    "Переразгибание локтей и коленей, большой палец достаёт до предплечья":
      "Elbows and knees over-extend, the thumb reaches the forearm"
  });

  /* ---------------- Доперевод после сквозной проверки ----------------- */

  Object.assign(D.uz, {
    "Оцените риск у своего ребёнка за семь минут":
      "Bolangizdagi xavfni yetti daqiqada baholang",
    "Пять шагов, понятный результат и конкретные рекомендации по дальнейшим действиям.":
      "Besh bosqich, tushunarli natija va keyingi harakatlar boʻyicha aniq tavsiyalar.",
    "Сводка оценки риска":
      "Xavf bahosi xulosasi",
    "Скачать PDF":
      "PDF yuklab olish",
    "Не удалось подготовить PDF. Нажмите «Распечатать сводку» и выберите «Сохранить как PDF».":
      "PDF tayyorlab boʻlmadi. «Xulosani chop etish» tugmasini bosing va «PDF sifatida saqlash»ni tanlang.",
    "АНАЛИЗ РИСКА":
      "XAVF TAHLILI",
    "Признаков отмечено: {n}":
      "Belgilar belgilandi: {n}",
    "Признаков дисплазии соединительной ткани несколько. Скажите о них педиатру: на этом фоне нарушения обмена имеет смысл искать раньше.":
      "Biriktiruvchi toʻqima displaziyasi belgilari bir nechta. Bu haqda pediatrga ayting: bunday fonda modda almashinuvi buzilishlarini erta izlash maʼqul.",
    "Признаков дисплазии соединительной ткани отмечено много. Это не болезнь сама по себе, но повод наблюдаться у педиатра вместе с ортопедом и кардиологом и не пропускать обследование углеводного обмена.":
      "Biriktiruvchi toʻqima displaziyasi belgilari koʻp belgilangan. Bu oʻz-oʻzidan kasallik emas, lekin pediatr bilan birga ortoped va kardiolog kuzatuvida boʻlish va uglevod almashinuvi tekshiruvini oʻtkazib yubormaslik uchun asos."
  });

  Object.assign(D.en, {
    "Оцените риск у своего ребёнка за семь минут":
      "Check your child’s risk in seven minutes",
    "Пять шагов, понятный результат и конкретные рекомендации по дальнейшим действиям.":
      "Five steps, a clear result and concrete recommendations on what to do next.",
    "Сводка оценки риска":
      "Risk assessment summary",
    "Скачать PDF":
      "Download PDF",
    "Не удалось подготовить PDF. Нажмите «Распечатать сводку» и выберите «Сохранить как PDF».":
      "Could not prepare the PDF. Press “Print the summary” and choose “Save as PDF”.",
    "АНАЛИЗ РИСКА":
      "RISK ANALYSIS",
    "Признаков отмечено: {n}":
      "Signs marked: {n}",
    "Признаков дисплазии соединительной ткани несколько. Скажите о них педиатру: на этом фоне нарушения обмена имеет смысл искать раньше.":
      "There are several signs of connective tissue dysplasia. Tell the paediatrician: against this background it makes sense to look for metabolic problems earlier.",
    "Признаков дисплазии соединительной ткани отмечено много. Это не болезнь сама по себе, но повод наблюдаться у педиатра вместе с ортопедом и кардиологом и не пропускать обследование углеводного обмена.":
      "Many signs of connective tissue dysplasia were marked. This is not a disease in itself, but it is a reason to be followed by a paediatrician together with an orthopaedist and a cardiologist, and not to skip testing of carbohydrate metabolism."
  });

  /* ---- Шкала ДСТ -----------------------------------------------------
     Справочник шкалы дисплазии соединительной ткани (как в калькуляторе
     DST), осмотр врача и сравнение групп. ДСТ по-узбекски — BTD
     (biriktiruvchi toʻqima displaziyasi), по-английски — CTD. */

  Object.assign(D.uz, {
    "Недостаточно фенотипических признаков": "Fenotipik belgilar yetarli emas",
    "I степень": "I daraja",
    "II степень": "II daraja",
    "III степень": "III daraja",
    "оба отрицательны": "ikkalasi manfiy",
    "положителен один из двух": "ikkitadan biri musbat",
    "положительны оба": "ikkalasi musbat",
    "Признаки арахнодактилии": "Araxnodaktiliya belgilari",
    "Симптом Штейнберга (большой палец)": "Shteynberg simptomi (bosh barmoq)",
    "Большой палец, зажатый в кулак, выступает за ульнарный край ладони":
      "Mushtga qisilgan bosh barmoq kaftning tirsak tomonidagi chetidan chiqib turadi",
    "Симптом Уокера—Мёрдока (запястье)": "Uoker—Myordok simptomi (bilak)",
    "I и V пальцы перекрываются при охвате запястья противоположной руки":
      "Qarama-qarshi qoʻl bilagini ushlaganda I va V barmoqlar bir-birining ustiga chiqadi",
    "Повышенная растяжимость кожи (на тыльной поверхности кисти)":
      "Terining oshgan choʻziluvchanligi (qoʻl panjasining orqa yuzasida)",
    "Нет": "Yoʻq",
    "Умеренная (<3 см)": "Oʻrtacha (<3 sm)",
    "Выраженная (≥3 см)": "Yaqqol (≥3 sm)",
    "Мышечная гипотония": "Mushak gipotoniyasi",
    "Умеренная": "Oʻrtacha",
    "Выраженная": "Yaqqol",
    "Гипермобильность суставов (по Бейтону)": "Boʻgʻimlar gipermobilligi (Beyton shkalasi boʻyicha)",
    "Нет (0–3)": "Yoʻq (0–3)",
    "Умеренная (4–5)": "Oʻrtacha (4–5)",
    "Выраженная (6–9)": "Yaqqol (6–9)",
    "Отрицательный": "Manfiy",
    "Положительный": "Musbat",

    "Долихоцефалия": "Dolixotsefaliya",
    "Искривление носовой перегородки": "Burun toʻsigʻining qiyshayishi",
    "Птичий клюв": "«Qush tumshugʻi» shaklidagi burun",
    "Скуловая гипоплазия": "Yonoq suyagi gipoplaziyasi",
    "Голубые склеры": "Koʻkimtir skleralar",
    "Гипо-/гипертелоризм и/или телекант": "Gipo-/gipertelorizm va/yoki telekant",
    "Птоз": "Ptoz (qovoq osilishi)",
    "Прогрессирующая миопия (>1 D/год)": "Zoʻrayib boruvchi miopiya (yiliga >1 D)",
    "Высокое / готическое небо": "Baland / gotik tanglay",
    "Незаращение твёрдого/мягкого неба": "Qattiq/yumshoq tanglayning bitmay qolishi",
    "Нарушение сроков и последовательности прорезывания зубов":
      "Tish chiqish muddati va tartibining buzilishi",
    "Расщепление язычка": "Tanglay tilchasining ikkiga ajralishi",
    "Неправильный прикус": "Notoʻgʻri tishlov",
    "Мягкость хрящевой ткани ушей": "Quloq togʻay toʻqimasining yumshoqligi",
    "Сухая, истончённая или преждевременно морщинистая кожа":
      "Quruq, yupqalashgan yoki barvaqt ajinlangan teri",
    "Тонкая ранимая кожа": "Yupqa, oson shikastlanadigan teri",
    "Патологическое рубцевание (атрофические и/или келоидные рубцы)":
      "Patologik chandiqlanish (atrofik va/yoki keloid chandiqlar)",
    "Повышенная ломкость сосудов кожи (лёгкое образование экхимозов/гематом)":
      "Teri tomirlarining oshgan moʻrtligi (ekximoz/gematomalarning oson paydo boʻlishi)",
    "Атрофические стрии, не связанные с ожирением, беременностью или быстрым ростом":
      "Semizlik, homiladorlik yoki tez oʻsish bilan bogʻliq boʻlmagan atrofik striyalar",
    "Деформация грудной клетки (воронкообразная или килевидная)":
      "Koʻkrak qafasi deformatsiyasi (voronkasimon yoki kilsimon)",
    "Сколиоз": "Skolioz",
    "Кифоз / лордоз": "Kifoz / lordoz",
    "Рецидивирующие подвывихи суставов": "Boʻgʻimlarning takroriy chala chiqishi",
    "Брахидактилия": "Braxidaktiliya",
    "Частичная синдактилия II–III пальцев стопы": "Oyoq II–III barmoqlarining qisman sindaktiliyasi",
    "Клинодактилия": "Klinodaktiliya",
    "Варикозное расширение вен нижних конечностей": "Oyoq venalarining varikoz kengayishi",
    "Х-/О-образное искривление ног": "Oyoqlarning X-/O-simon qiyshayishi",
    "Сандалевидная щель": "Sandalsimon tirqish",
    "Косолапость": "Maymoqlik",
    "Натоптыши": "Oyoq qadoqlari",
    "Структурные аномалии волос (ломкость, истончение)":
      "Soch tuzilishidagi anomaliyalar (moʻrtlik, yupqalashish)",
    "Дистрофические изменения ногтей (ломкость, продольная исчерченность, истончение ногтевой пластинки)":
      "Tirnoqlarning distrofik oʻzgarishlari (moʻrtlik, boʻylama chiziqlar, tirnoq plastinkasining yupqalashishi)",
    "Узкий лицевой скелет": "Tor yuz skeleti",
    "Долихостеномелия": "Dolixostenomeliya",
    "Телеангиэктазии": "Teleangiektaziyalar",
    "Вальгусная установка стоп": "Oyoq panjalarining valgus holati",
    "Видимая венозная сеть": "Koʻrinib turadigan vena toʻri",
    "Скошенность подбородка": "Iyakning orqaga qiyalanishi",
    "Асимметрия стояния лопаток, «вялая осанка»": "Kuraklarning nosimmetrik joylashuvi, «boʻshashgan qomat»",
    "Грыжи передней брюшной стенки и/или диастаз прямых мышц живота":
      "Qorin old devori churralari va/yoki qorin toʻgʻri mushaklari diastazi",
    "Гипоплазия мышечной и/или подкожно-жировой ткани":
      "Mushak va/yoki teri osti yogʻ toʻqimasi gipoplaziyasi",

    "Пролапс митрального клапана": "Mitral klapan prolapsi",
    "Дополнительные хорды": "Qoʻshimcha xordalar",
    "Аритмии": "Aritmiyalar",
    "Кардиомиопатии": "Kardiomiopatiyalar",
    "Аневризма аорты": "Aorta anevrizmasi",
    "Ангиодисплазии": "Angiodisplaziyalar",
    "Бронхиальная астма": "Bronxial astma",
    "Аномалия желчного пузыря": "Oʻt pufagi anomaliyasi",
    "Дискинезия ЖВП": "Oʻt yoʻllari diskineziyasi",
    "Желчекаменная болезнь": "Oʻt-tosh kasalligi",
    "Гастродуодениты": "Gastroduodenitlar",
    "Гастроэзофагальный рефлюкс": "Gastroezofageal reflyuks",
    "Дивертикулы": "Divertikullar",
    "Мегаколон": "Megakolon",
    "Долихосигма": "Dolixosigma",
    "Недержание мочи": "Siydikni tuta olmaslik",
    "Синдром раздраженного кишечника": "Taʼsirlangan ichak sindromi",
    "Удвоение ЧЛС": "Buyrak kosacha-jomcha tizimining ikkilanishi",
    "Нефроптоз": "Nefroptoz",
    "Пузырно-мочеточниковый рефлюкс": "Qovuq-siydik yoʻli reflyuksi",
    "Дисметаболическая нефропатия": "Dismetabolik nefropatiya",
    "Задержка полового развития": "Jinsiy rivojlanishning kechikishi",
    "Ювенильные кровотечения / вялая мошонка": "Yuvenil qon ketishlar / boʻshashgan yorgʻoq",
    "Дисменорея / грыжи": "Dismenoreya / churralar",
    "Гипоплазия матки / варикоцеле": "Bachadon gipoplaziyasi / varikotsele",
    "Дисплазия тазобедренных суставов": "Chanoq-son boʻgʻimlari displaziyasi",
    "Висцероптоз": "Visseroptoz",
    "Грыжа пищеводного отверстия": "Diafragma qizilungach teshigi churrasi",
    "Дуральная эктазия": "Dural ektaziya",

    "11 признаков · шкала ДСТ": "11 ta belgi · BTD shkalasi",
    "Признаки недифференцированной дисплазии оцениваются по шкале ДСТ отдельно от риска диабета.":
      "Differensiallanmagan displaziya belgilari diabet xavfidan alohida, BTD shkalasi boʻyicha baholanadi.",
    "Риск диабета в процентах, степень ДСТ, перечень повлиявших факторов и рекомендации по действиям.":
      "Foizdagi diabet xavfi, BTD darajasi, taʼsir qilgan omillar roʻyxati va harakatlar boʻyicha tavsiyalar.",
    "риск 0–100 · степень ДСТ": "xavf 0–100 · BTD darajasi",

    "Недифференцированная дисплазия соединительной ткани — фон, на котором нарушения углеводного обмена выявляют раньше. Признаки оцениваются в баллах по шкале ДСТ отдельно от риска диабета: так врач сможет сравнить детей с дисплазией и без неё. Отмечайте только то, в чём уверены, — точную степень определит врач на осмотре.":
      "Differensiallanmagan biriktiruvchi toʻqima displaziyasi — uglevod almashinuvi buzilishlari ertaroq aniqlanadigan fon. Belgilar diabet xavfidan alohida, BTD shkalasi boʻyicha ballarda baholanadi: shunda shifokor displaziyasi bor va yoʻq bolalarni solishtira oladi. Faqat ishonchingiz komil boʻlgan belgilarni belgilang — aniq darajani shifokor koʻrikda belgilaydi.",
    "Оценка признаков дисплазии по шкале ДСТ": "Displaziya belgilarini BTD shkalasi boʻyicha baholash",
    "Низкий риск диабета": "Past diabet xavfi",
    "Умеренный риск диабета": "Oʻrtacha diabet xavfi",
    "Высокий риск диабета": "Yuqori diabet xavfi",
    "Дисплазия соединительной ткани": "Biriktiruvchi toʻqima displaziyasi",
    "Шкала ДСТ: 0–15 — недостаточно признаков · 16–25 — I степень · 26–35 — II степень · 36 и выше — III степень":
      "BTD shkalasi: 0–15 — belgilar yetarli emas · 16–25 — I daraja · 26–35 — II daraja · 36 va undan yuqori — III daraja",
    "Индекс (сумма баллов)": "Indeks (ballar yigʻindisi)",
    "Признаков отмечено": "Belgilangan belgilar",
    "Значимых (вес 4–5)": "Ahamiyatli (vazni 4–5)",
    "Аномалии органов": "Aʼzolar anomaliyalari",
    "Предварительная оценка по ответам анкеты: точную степень определяет врач на осмотре по полной шкале ДСТ. На процент риска диабета степень дисплазии не влияет — она нужна, чтобы сравнивать детей с дисплазией и без неё.":
      "Soʻrovnoma javoblari boʻyicha dastlabki baho: aniq darajani shifokor koʻrikda toʻliq BTD shkalasi boʻyicha belgilaydi. Displaziya darajasi diabet xavfi foiziga taʼsir qilmaydi — u displaziyasi bor va yoʻq bolalarni solishtirish uchun kerak.",
    "аномалия, в индекс не входит": "anomaliya, indeksga kirmaydi",
    "Признаки дисплазии не отмечены.": "Displaziya belgilari belgilanmagan.",
    "По ответам набирается степень дисплазии соединительной ткани. Попросите педиатра провести осмотр по полной шкале ДСТ: на этом фоне нарушения углеводного обмена имеет смысл искать раньше.":
      "Javoblar boʻyicha biriktiruvchi toʻqima displaziyasi darajasi yigʻiladi. Pediatrdan toʻliq BTD shkalasi boʻyicha koʻrik oʻtkazishni soʻrang: bunday fonda uglevod almashinuvi buzilishlarini ertaroq izlash maʼqul.",

    "ДСТ": "BTD",
    "С ДСТ": "BTD bilan",
    "Без ДСТ": "BTDsiz",
    "ДСТ I": "BTD I",
    "ДСТ II": "BTD II",
    "ДСТ III": "BTD III",
    "индекс {n}": "indeks {n}",
    "осмотр врача": "shifokor koʻrigi",
    "со слов родителя": "ota-ona soʻzlaridan",
    "Риск диабета у детей с дисплазией соединительной ткани и без неё":
      "Biriktiruvchi toʻqima displaziyasi bor va yoʻq bolalarda diabet xavfi",
    "Высокий риск без ДСТ": "BTDsiz yuqori xavf",
    "Высокий риск при ДСТ": "BTD boʻlganda yuqori xavf",
    "Осмотрено врачом по шкале ДСТ": "Shifokor BTD shkalasi boʻyicha koʻrgan",
    "Сравнение групп по шкале ДСТ": "BTD shkalasi boʻyicha guruhlarni solishtirish",
    "Степень дисплазии — по осмотру врача, а если осмотра не было, предварительно по ответам родителя":
      "Displaziya darajasi — shifokor koʻrigi boʻyicha, koʻrik boʻlmagan boʻlsa — ota-ona javoblari boʻyicha dastlabki",
    "Группа": "Guruh",
    "Средний риск": "Xavfning oʻrtacha qiymati",
    "Риск диабета": "Diabet xavfi",
    "Осмотр врача": "Shifokor koʻrigi",
    "Шкала ДСТ: 0–15 — недостаточно фенотипических признаков, 16–25 — I степень, 26–35 — II степень, 36 и выше — III степень. Аномалии органов учитываются отдельно и в индекс не входят.":
      "BTD shkalasi: 0–15 — fenotipik belgilar yetarli emas, 16–25 — I daraja, 26–35 — II daraja, 36 va undan yuqori — III daraja. Aʼzolar anomaliyalari alohida hisobga olinadi va indeksga kirmaydi.",
    "Это сравнение групп, а не доказательство связи: для вывода нужны оценки с осмотром врача и достаточное число детей в каждой группе. Осмотр по шкале ДСТ открывается кнопкой в колонке «ДСТ» таблицы оценок.":
      "Bu guruhlarni solishtirish, bogʻliqlikning isboti emas: xulosa uchun shifokor koʻrigi oʻtkazilgan baholar va har bir guruhda yetarlicha bolalar kerak. BTD shkalasi boʻyicha koʻrik baholar jadvalidagi «BTD» ustunidagi tugma bilan ochiladi.",
    "Без ДСТ (индекс 0–15)": "BTDsiz (indeks 0–15)",
    "ДСТ I степени (индекс 16–25)": "BTD I daraja (indeks 16–25)",
    "ДСТ II степени (индекс 26–35)": "BTD II daraja (indeks 26–35)",
    "ДСТ III степени (индекс 36 и выше)": "BTD III daraja (indeks 36 va undan yuqori)",
    "Все дети с ДСТ (I–III степень)": "BTD bor barcha bolalar (I–III daraja)",
    "нет данных": "maʼlumot yoʻq",
    "Оценок: {n} · средний риск {avg}": "Baholar: {n} · xavfning oʻrtacha qiymati {avg}",
    "из {n} оценок": "{n} ta bahodan",

    "Осмотр по шкале ДСТ": "BTD shkalasi boʻyicha koʻrik",
    "Закрыть": "Yopish",
    "Индекс": "Indeks",
    "Признаков": "Belgilar",
    "Значимых 4–5": "Ahamiyatli 4–5",
    "Аномалий": "Anomaliyalar",
    "Фенотипические признаки": "Fenotipik belgilar",
    "Признаки с градацией": "Darajali belgilar",
    "Два теста дают один признак: оба отрицательны — 0, положителен один — 3, положительны оба — 5 баллов.":
      "Ikki test bitta belgini beradi: ikkalasi manfiy — 0, bittasi musbat — 3, ikkalasi musbat — 5 ball.",
    "Ассоциированные аномалии": "Bogʻliq anomaliyalar",
    "Учитываются отдельным числом и в индекс не входят: пороги степеней рассчитаны на фенотипические признаки.":
      "Alohida son sifatida hisobga olinadi va indeksga kirmaydi: daraja chegaralari fenotipik belgilar uchun hisoblangan.",
    "Вернуть ответы родителя": "Ota-ona javoblariga qaytarish",
    "Сохранить осмотр": "Koʻrikni saqlash",
    "Итог по арахнодактилии:": "Araxnodaktiliya boʻyicha natija:",
    "сохранён осмотр врача": "shifokor koʻrigi saqlangan",
    "предварительно, по ответам родителя": "dastlabki, ota-ona javoblari boʻyicha",
    "Не удалось сохранить осмотр. Проверьте соединение и попробуйте ещё раз.":
      "Koʻrikni saqlab boʻlmadi. Aloqani tekshirib, qayta urinib koʻring.",

    "предварительно, по ответам анкеты": "dastlabki, soʻrovnoma javoblari boʻyicha",
    "Врач оценил признаки дисплазии соединительной ткани по шкале ДСТ. Это не болезнь сама по себе, но повод наблюдаться у педиатра вместе с ортопедом и кардиологом и не пропускать обследование углеводного обмена.":
      "Shifokor biriktiruvchi toʻqima displaziyasi belgilarini BTD shkalasi boʻyicha baholadi. Bu oʻz-oʻzidan kasallik emas, lekin pediatr, ortoped va kardiolog kuzatuvida boʻlish va uglevod almashinuvi tekshiruvini oʻtkazib yubormaslik uchun asos.",
    "По ответам анкеты набирается степень дисплазии соединительной ткани. Попросите педиатра провести осмотр по полной шкале ДСТ: на этом фоне нарушения обмена имеет смысл искать раньше.":
      "Soʻrovnoma javoblari boʻyicha biriktiruvchi toʻqima displaziyasi darajasi yigʻiladi. Pediatrdan toʻliq BTD shkalasi boʻyicha koʻrik oʻtkazishni soʻrang: bunday fonda almashinuv buzilishlarini ertaroq izlash maʼqul.",

    "Степень определена врачом на осмотре по полной шкале ДСТ. На процент риска диабета степень дисплазии не влияет — она нужна, чтобы сравнивать детей с дисплазией и без неё.":
      "Daraja shifokor tomonidan toʻliq BTD shkalasi boʻyicha koʻrikda aniqlangan. Displaziya darajasi diabet xavfi foiziga taʼsir qilmaydi — u displaziyasi bor va yoʻq bolalarni solishtirish uchun kerak.",
    "Врач определил степень дисплазии соединительной ткани по полной шкале ДСТ: на этом фоне нарушения углеводного обмена имеет смысл искать раньше.":
      "Shifokor biriktiruvchi toʻqima displaziyasi darajasini toʻliq BTD shkalasi boʻyicha aniqladi: bunday fonda uglevod almashinuvi buzilishlarini ertaroq izlash maʼqul.",
    "Готовим PDF…": "PDF tayyorlanmoqda…",
    "Не удалось подготовить PDF. Попробуйте ещё раз через минуту.":
      "PDF tayyorlab boʻlmadi. Bir daqiqadan soʻng qayta urinib koʻring."
  });

  Object.assign(D.en, {
    "Недостаточно фенотипических признаков": "Not enough phenotypic signs",
    "I степень": "Grade I",
    "II степень": "Grade II",
    "III степень": "Grade III",
    "оба отрицательны": "both negative",
    "положителен один из двух": "one of the two positive",
    "положительны оба": "both positive",
    "Признаки арахнодактилии": "Signs of arachnodactyly",
    "Симптом Штейнберга (большой палец)": "Steinberg sign (thumb)",
    "Большой палец, зажатый в кулак, выступает за ульнарный край ладони":
      "The thumb folded into the fist protrudes beyond the ulnar edge of the palm",
    "Симптом Уокера—Мёрдока (запястье)": "Walker–Murdoch sign (wrist)",
    "I и V пальцы перекрываются при охвате запястья противоположной руки":
      "The thumb and little finger overlap when grasping the opposite wrist",
    "Повышенная растяжимость кожи (на тыльной поверхности кисти)":
      "Increased skin extensibility (back of the hand)",
    "Нет": "None",
    "Умеренная (<3 см)": "Moderate (<3 cm)",
    "Выраженная (≥3 см)": "Marked (≥3 cm)",
    "Мышечная гипотония": "Muscle hypotonia",
    "Умеренная": "Moderate",
    "Выраженная": "Marked",
    "Гипермобильность суставов (по Бейтону)": "Joint hypermobility (Beighton score)",
    "Нет (0–3)": "None (0–3)",
    "Умеренная (4–5)": "Moderate (4–5)",
    "Выраженная (6–9)": "Marked (6–9)",
    "Отрицательный": "Negative",
    "Положительный": "Positive",

    "Долихоцефалия": "Dolichocephaly",
    "Искривление носовой перегородки": "Deviated nasal septum",
    "Птичий клюв": "Beaked nose",
    "Скуловая гипоплазия": "Malar hypoplasia",
    "Голубые склеры": "Blue sclerae",
    "Гипо-/гипертелоризм и/или телекант": "Hypo-/hypertelorism and/or telecanthus",
    "Птоз": "Ptosis",
    "Прогрессирующая миопия (>1 D/год)": "Progressive myopia (>1 D/year)",
    "Высокое / готическое небо": "High / gothic palate",
    "Незаращение твёрдого/мягкого неба": "Cleft hard/soft palate",
    "Нарушение сроков и последовательности прорезывания зубов":
      "Abnormal timing and order of tooth eruption",
    "Расщепление язычка": "Bifid uvula",
    "Неправильный прикус": "Malocclusion",
    "Мягкость хрящевой ткани ушей": "Soft ear cartilage",
    "Сухая, истончённая или преждевременно морщинистая кожа":
      "Dry, thinned or prematurely wrinkled skin",
    "Тонкая ранимая кожа": "Thin, fragile skin",
    "Патологическое рубцевание (атрофические и/или келоидные рубцы)":
      "Abnormal scarring (atrophic and/or keloid scars)",
    "Повышенная ломкость сосудов кожи (лёгкое образование экхимозов/гематом)":
      "Fragile skin vessels (easy bruising and haematomas)",
    "Атрофические стрии, не связанные с ожирением, беременностью или быстрым ростом":
      "Atrophic striae not related to obesity, pregnancy or rapid growth",
    "Деформация грудной клетки (воронкообразная или килевидная)":
      "Chest deformity (pectus excavatum or carinatum)",
    "Сколиоз": "Scoliosis",
    "Кифоз / лордоз": "Kyphosis / lordosis",
    "Рецидивирующие подвывихи суставов": "Recurrent joint subluxations",
    "Брахидактилия": "Brachydactyly",
    "Частичная синдактилия II–III пальцев стопы": "Partial syndactyly of toes II–III",
    "Клинодактилия": "Clinodactyly",
    "Варикозное расширение вен нижних конечностей": "Varicose veins of the legs",
    "Х-/О-образное искривление ног": "X- or O-shaped legs",
    "Сандалевидная щель": "Sandal gap",
    "Косолапость": "Clubfoot",
    "Натоптыши": "Calluses",
    "Структурные аномалии волос (ломкость, истончение)":
      "Structural hair abnormalities (brittleness, thinning)",
    "Дистрофические изменения ногтей (ломкость, продольная исчерченность, истончение ногтевой пластинки)":
      "Dystrophic nail changes (brittleness, longitudinal ridging, thinning of the nail plate)",
    "Узкий лицевой скелет": "Narrow facial skeleton",
    "Долихостеномелия": "Dolichostenomelia",
    "Телеангиэктазии": "Telangiectasias",
    "Вальгусная установка стоп": "Valgus position of the feet",
    "Видимая венозная сеть": "Visible venous network",
    "Скошенность подбородка": "Receding chin",
    "Асимметрия стояния лопаток, «вялая осанка»": "Asymmetric shoulder blades, “slack posture”",
    "Грыжи передней брюшной стенки и/или диастаз прямых мышц живота":
      "Anterior abdominal wall hernias and/or diastasis recti",
    "Гипоплазия мышечной и/или подкожно-жировой ткани":
      "Hypoplasia of muscle and/or subcutaneous fat",

    "Пролапс митрального клапана": "Mitral valve prolapse",
    "Дополнительные хорды": "False chordae tendineae",
    "Аритмии": "Arrhythmias",
    "Кардиомиопатии": "Cardiomyopathies",
    "Аневризма аорты": "Aortic aneurysm",
    "Ангиодисплазии": "Angiodysplasias",
    "Бронхиальная астма": "Bronchial asthma",
    "Аномалия желчного пузыря": "Gallbladder anomaly",
    "Дискинезия ЖВП": "Biliary dyskinesia",
    "Желчекаменная болезнь": "Gallstone disease",
    "Гастродуодениты": "Gastroduodenitis",
    "Гастроэзофагальный рефлюкс": "Gastro-oesophageal reflux",
    "Дивертикулы": "Diverticula",
    "Мегаколон": "Megacolon",
    "Долихосигма": "Dolichosigma",
    "Недержание мочи": "Urinary incontinence",
    "Синдром раздраженного кишечника": "Irritable bowel syndrome",
    "Удвоение ЧЛС": "Duplex renal collecting system",
    "Нефроптоз": "Nephroptosis",
    "Пузырно-мочеточниковый рефлюкс": "Vesicoureteral reflux",
    "Дисметаболическая нефропатия": "Dysmetabolic nephropathy",
    "Задержка полового развития": "Delayed puberty",
    "Ювенильные кровотечения / вялая мошонка": "Juvenile bleeding / lax scrotum",
    "Дисменорея / грыжи": "Dysmenorrhoea / hernias",
    "Гипоплазия матки / варикоцеле": "Uterine hypoplasia / varicocele",
    "Дисплазия тазобедренных суставов": "Hip dysplasia",
    "Висцероптоз": "Visceroptosis",
    "Грыжа пищеводного отверстия": "Hiatal hernia",
    "Дуральная эктазия": "Dural ectasia",

    "11 признаков · шкала ДСТ": "11 signs · CTD scale",
    "Признаки недифференцированной дисплазии оцениваются по шкале ДСТ отдельно от риска диабета.":
      "Signs of undifferentiated dysplasia are scored on the CTD scale separately from the diabetes risk.",
    "Риск диабета в процентах, степень ДСТ, перечень повлиявших факторов и рекомендации по действиям.":
      "Diabetes risk as a percentage, the CTD grade, the factors that contributed and recommendations on what to do.",
    "риск 0–100 · степень ДСТ": "risk 0–100 · CTD grade",

    "Недифференцированная дисплазия соединительной ткани — фон, на котором нарушения углеводного обмена выявляют раньше. Признаки оцениваются в баллах по шкале ДСТ отдельно от риска диабета: так врач сможет сравнить детей с дисплазией и без неё. Отмечайте только то, в чём уверены, — точную степень определит врач на осмотре.":
      "Undifferentiated connective tissue dysplasia is a background against which disorders of carbohydrate metabolism are detected earlier. The signs are scored on the CTD scale separately from the diabetes risk, so the doctor can compare children with and without dysplasia. Mark only what you are sure of — the doctor will determine the exact grade at the examination.",
    "Оценка признаков дисплазии по шкале ДСТ": "Scoring dysplasia signs on the CTD scale",
    "Низкий риск диабета": "Low diabetes risk",
    "Умеренный риск диабета": "Moderate diabetes risk",
    "Высокий риск диабета": "High diabetes risk",
    "Дисплазия соединительной ткани": "Connective tissue dysplasia",
    "Шкала ДСТ: 0–15 — недостаточно признаков · 16–25 — I степень · 26–35 — II степень · 36 и выше — III степень":
      "CTD scale: 0–15 — not enough signs · 16–25 — grade I · 26–35 — grade II · 36 and above — grade III",
    "Индекс (сумма баллов)": "Index (sum of points)",
    "Признаков отмечено": "Signs marked",
    "Значимых (вес 4–5)": "Significant (weight 4–5)",
    "Аномалии органов": "Organ anomalies",
    "Предварительная оценка по ответам анкеты: точную степень определяет врач на осмотре по полной шкале ДСТ. На процент риска диабета степень дисплазии не влияет — она нужна, чтобы сравнивать детей с дисплазией и без неё.":
      "A preliminary estimate from the questionnaire: the exact grade is set by a doctor at an examination on the full CTD scale. The dysplasia grade does not change the diabetes risk percentage — it is needed to compare children with and without dysplasia.",
    "аномалия, в индекс не входит": "anomaly, not included in the index",
    "Признаки дисплазии не отмечены.": "No dysplasia signs marked.",
    "По ответам набирается степень дисплазии соединительной ткани. Попросите педиатра провести осмотр по полной шкале ДСТ: на этом фоне нарушения углеводного обмена имеет смысл искать раньше.":
      "The answers add up to a grade of connective tissue dysplasia. Ask the paediatrician for an examination on the full CTD scale: against this background it makes sense to look for carbohydrate metabolism disorders earlier.",

    "ДСТ": "CTD",
    "С ДСТ": "With CTD",
    "Без ДСТ": "No CTD",
    "ДСТ I": "CTD I",
    "ДСТ II": "CTD II",
    "ДСТ III": "CTD III",
    "индекс {n}": "index {n}",
    "осмотр врача": "doctor's examination",
    "со слов родителя": "parent-reported",
    "Риск диабета у детей с дисплазией соединительной ткани и без неё":
      "Diabetes risk in children with and without connective tissue dysplasia",
    "Высокий риск без ДСТ": "High risk without CTD",
    "Высокий риск при ДСТ": "High risk with CTD",
    "Осмотрено врачом по шкале ДСТ": "Examined by a doctor on the CTD scale",
    "Сравнение групп по шкале ДСТ": "Group comparison on the CTD scale",
    "Степень дисплазии — по осмотру врача, а если осмотра не было, предварительно по ответам родителя":
      "Dysplasia grade — from the doctor's examination or, if there was none, a preliminary estimate from the parent's answers",
    "Группа": "Group",
    "Средний риск": "Average risk",
    "Риск диабета": "Diabetes risk",
    "Осмотр врача": "Doctor's examination",
    "Шкала ДСТ: 0–15 — недостаточно фенотипических признаков, 16–25 — I степень, 26–35 — II степень, 36 и выше — III степень. Аномалии органов учитываются отдельно и в индекс не входят.":
      "CTD scale: 0–15 — not enough phenotypic signs, 16–25 — grade I, 26–35 — grade II, 36 and above — grade III. Organ anomalies are counted separately and are not included in the index.",
    "Это сравнение групп, а не доказательство связи: для вывода нужны оценки с осмотром врача и достаточное число детей в каждой группе. Осмотр по шкале ДСТ открывается кнопкой в колонке «ДСТ» таблицы оценок.":
      "This compares groups; it does not prove a link. A conclusion needs assessments with a doctor's examination and enough children in each group. The CTD examination opens from the button in the “CTD” column of the assessments table.",
    "Без ДСТ (индекс 0–15)": "No CTD (index 0–15)",
    "ДСТ I степени (индекс 16–25)": "CTD grade I (index 16–25)",
    "ДСТ II степени (индекс 26–35)": "CTD grade II (index 26–35)",
    "ДСТ III степени (индекс 36 и выше)": "CTD grade III (index 36 and above)",
    "Все дети с ДСТ (I–III степень)": "All children with CTD (grades I–III)",
    "нет данных": "no data",
    "Оценок: {n} · средний риск {avg}": "Assessments: {n} · average risk {avg}",
    "из {n} оценок": "of {n} assessments",

    "Осмотр по шкале ДСТ": "CTD scale examination",
    "Закрыть": "Close",
    "Индекс": "Index",
    "Признаков": "Signs",
    "Значимых 4–5": "Significant 4–5",
    "Аномалий": "Anomalies",
    "Фенотипические признаки": "Phenotypic signs",
    "Признаки с градацией": "Graded signs",
    "Два теста дают один признак: оба отрицательны — 0, положителен один — 3, положительны оба — 5 баллов.":
      "The two tests make one sign: both negative — 0, one positive — 3, both positive — 5 points.",
    "Ассоциированные аномалии": "Associated anomalies",
    "Учитываются отдельным числом и в индекс не входят: пороги степеней рассчитаны на фенотипические признаки.":
      "Counted as a separate number and not included in the index: the grade thresholds are set for phenotypic signs.",
    "Вернуть ответы родителя": "Revert to the parent's answers",
    "Сохранить осмотр": "Save examination",
    "Итог по арахнодактилии:": "Arachnodactyly result:",
    "сохранён осмотр врача": "doctor's examination saved",
    "предварительно, по ответам родителя": "preliminary, from the parent's answers",
    "Не удалось сохранить осмотр. Проверьте соединение и попробуйте ещё раз.":
      "Could not save the examination. Check the connection and try again.",

    "предварительно, по ответам анкеты": "preliminary, from the questionnaire",
    "Врач оценил признаки дисплазии соединительной ткани по шкале ДСТ. Это не болезнь сама по себе, но повод наблюдаться у педиатра вместе с ортопедом и кардиологом и не пропускать обследование углеводного обмена.":
      "The doctor has assessed the signs of connective tissue dysplasia on the CTD scale. This is not a disease in itself, but it is a reason to be followed by a paediatrician together with an orthopaedist and a cardiologist, and not to skip testing of carbohydrate metabolism.",
    "По ответам анкеты набирается степень дисплазии соединительной ткани. Попросите педиатра провести осмотр по полной шкале ДСТ: на этом фоне нарушения обмена имеет смысл искать раньше.":
      "The questionnaire answers add up to a grade of connective tissue dysplasia. Ask the paediatrician for an examination on the full CTD scale: against this background it makes sense to look for metabolic problems earlier.",

    "Степень определена врачом на осмотре по полной шкале ДСТ. На процент риска диабета степень дисплазии не влияет — она нужна, чтобы сравнивать детей с дисплазией и без неё.":
      "The grade was set by a doctor at an examination on the full CTD scale. The dysplasia grade does not change the diabetes risk percentage — it is needed to compare children with and without dysplasia.",
    "Врач определил степень дисплазии соединительной ткани по полной шкале ДСТ: на этом фоне нарушения углеводного обмена имеет смысл искать раньше.":
      "A doctor has set the grade of connective tissue dysplasia on the full CTD scale: against this background it makes sense to look for carbohydrate metabolism disorders earlier.",
    "Готовим PDF…": "Preparing the PDF…",
    "Не удалось подготовить PDF. Попробуйте ещё раз через минуту.":
      "Could not prepare the PDF. Please try again in a minute."
  });

  /* ---- Замечания заказчика 16.09.2026: семейный анамнез, аутоиммунные
     болезни родителей, вирусные инфекции, перинатальные факторы и шаг 4
     анкеты в баллах шкалы ДСТ ---------------------------------------- */

  Object.assign(D.uz, {
    "Сахарный диабет 1 типа у отца":
      "Otada 1-tur qandli diabet",
    "Сахарный диабет 1 типа у матери":
      "Onada 1-tur qandli diabet",
    "Сахарный диабет 1 типа у брата или сестры":
      "Aka-uka yoki opa-singilda 1-tur qandli diabet",
    "Например, непереносимость лактозы, наследственные обменные болезни":
      "Masalan, laktozani koʻtara olmaslik, irsiy almashinuv kasalliklari",
    "Аутоиммунные заболевания у родителей":
      "Ota-onada autoimmun kasalliklar",
    "Эти заболевания часто связаны с общей наследственной предрасположенностью к сахарному диабету 1 типа.":
      "Bu kasalliklar koʻpincha 1-tur qandli diabetga umumiy irsiy moyillik bilan bogʻliq.",
    "Аутоиммунный тиреоидит (тиреоидит Хашимото)":
      "Autoimmun tireoidit (Xashimoto tireoiditi)",
    "Аутоиммунный тиреоидит (тиреоидит Хашимото) у родителей":
      "Ota-onada autoimmun tireoidit (Xashimoto tireoiditi)",
    "Болезнь Грейвса":
      "Greyvs kasalligi",
    "Болезнь Грейвса у родителей":
      "Ota-onada Greyvs kasalligi",
    "Витилиго":
      "Vitiligo",
    "Витилиго у родителей":
      "Ota-onada vitiligo",
    "Целиакия":
      "Tseliakiya",
    "Целиакия у родителей":
      "Ota-onada tseliakiya",
    "Ревматоидный артрит":
      "Revmatoid artrit",
    "Ревматоидный артрит у родителей":
      "Ota-onada revmatoid artrit",
    "Болезнь Аддисона":
      "Addison kasalligi",
    "Болезнь Аддисона у родителей":
      "Ota-onada Addison kasalligi",
    "Перенесённые вирусные инфекции":
      "Oʻtkazilgan virusli infeksiyalar",
    "Перенесённые вирусные инфекции: энтеровирусы, аденовирусы":
      "Oʻtkazilgan virusli infeksiyalar: enteroviruslar, adenoviruslar",
    "Энтеровирусы (Коксаки B), аденовирусы, повторные респираторные инфекции":
      "Enteroviruslar (Koksaki B), adenoviruslar, takroriy respirator infeksiyalar",
    "Осложнения беременности или родов":
      "Homiladorlik yoki tugʻruq asoratlari",
    "Внутриутробная инфекция, тяжёлый токсикоз, преждевременные роды, асфиксия в родах":
      "Ona qornidagi infeksiya, ogʻir toksikoz, muddatidan oldin tugʻruq, tugʻruqdagi asfiksiya",
    "Аномалии развития мочеполовой системы":
      "Siydik-tanosil tizimi rivojlanish anomaliyalari",
    "Аномалии развития органов пищеварения":
      "Hazm aʼzolari rivojlanish anomaliyalari",
    "Кожа, зубы, глаза, уши":
      "Teri, tishlar, koʻzlar, quloqlar",
    "Суставы и кожа: признаки с градацией":
      "Boʻgʻimlar va teri: darajali belgilar",
    "Родитель отмечает сам признак, степень уточняет врач на осмотре.":
      "Ota-ona belgining oʻzini belgilaydi, darajasini shifokor koʻrikda aniqlaydi.",
    "Внутренние органы: малые аномалии развития":
      "Ichki aʼzolar: kichik rivojlanish anomaliyalari",
    "Обычно их находят на УЗИ. Учитываются отдельным числом и в сумму баллов не входят.":
      "Odatda ular ultratovush tekshiruvida aniqlanadi. Alohida son sifatida hisobga olinadi va ballar yigʻindisiga kirmaydi.",
    "Недифференцированная дисплазия соединительной ткани — фон, на котором нарушения углеводного обмена выявляют раньше. У каждого признака свой балл по шкале ДСТ, и считаются они отдельно от риска диабета: так врач сможет сравнить детей с дисплазией и без неё. Отмечайте только то, в чём уверены, — точную степень определит врач на осмотре.":
      "Differensiallanmagan biriktiruvchi toʻqima displaziyasi — uglevod almashinuvi buzilishlari ertaroq aniqlanadigan fon. Har bir belgining BTD shkalasi boʻyicha oʻz bali bor va ular diabet xavfidan alohida hisoblanadi: shunda shifokor displaziyasi bor va yoʻq bolalarni solishtira oladi. Faqat ishonchingiz komil boʻlgan belgilarni belgilang — aniq darajani shifokor koʻrikda belgilaydi."
  });

  Object.assign(D.en, {
    "Сахарный диабет 1 типа у отца":
      "Type 1 diabetes in the father",
    "Сахарный диабет 1 типа у матери":
      "Type 1 diabetes in the mother",
    "Сахарный диабет 1 типа у брата или сестры":
      "Type 1 diabetes in a brother or sister",
    "Например, непереносимость лактозы, наследственные обменные болезни":
      "For example, lactose intolerance or inherited metabolic diseases",
    "Аутоиммунные заболевания у родителей":
      "Autoimmune diseases in the parents",
    "Эти заболевания часто связаны с общей наследственной предрасположенностью к сахарному диабету 1 типа.":
      "These diseases are often linked to a shared inherited predisposition to type 1 diabetes.",
    "Аутоиммунный тиреоидит (тиреоидит Хашимото)":
      "Autoimmune thyroiditis (Hashimoto's thyroiditis)",
    "Аутоиммунный тиреоидит (тиреоидит Хашимото) у родителей":
      "Autoimmune thyroiditis (Hashimoto's thyroiditis) in a parent",
    "Болезнь Грейвса":
      "Graves' disease",
    "Болезнь Грейвса у родителей":
      "Graves' disease in a parent",
    "Витилиго":
      "Vitiligo",
    "Витилиго у родителей":
      "Vitiligo in a parent",
    "Целиакия":
      "Coeliac disease",
    "Целиакия у родителей":
      "Coeliac disease in a parent",
    "Ревматоидный артрит":
      "Rheumatoid arthritis",
    "Ревматоидный артрит у родителей":
      "Rheumatoid arthritis in a parent",
    "Болезнь Аддисона":
      "Addison's disease",
    "Болезнь Аддисона у родителей":
      "Addison's disease in a parent",
    "Перенесённые вирусные инфекции":
      "Past viral infections",
    "Перенесённые вирусные инфекции: энтеровирусы, аденовирусы":
      "Past viral infections: enteroviruses, adenoviruses",
    "Энтеровирусы (Коксаки B), аденовирусы, повторные респираторные инфекции":
      "Enteroviruses (Coxsackie B), adenoviruses, recurrent respiratory infections",
    "Осложнения беременности или родов":
      "Complications of pregnancy or birth",
    "Внутриутробная инфекция, тяжёлый токсикоз, преждевременные роды, асфиксия в родах":
      "Intrauterine infection, severe toxicosis, premature birth, birth asphyxia",
    "Аномалии развития мочеполовой системы":
      "Developmental anomalies of the urogenital system",
    "Аномалии развития органов пищеварения":
      "Developmental anomalies of the digestive organs",
    "Кожа, зубы, глаза, уши":
      "Skin, teeth, eyes, ears",
    "Суставы и кожа: признаки с градацией":
      "Joints and skin: graded signs",
    "Родитель отмечает сам признак, степень уточняет врач на осмотре.":
      "The parent marks the sign itself; the doctor determines its degree at the examination.",
    "Внутренние органы: малые аномалии развития":
      "Internal organs: minor developmental anomalies",
    "Обычно их находят на УЗИ. Учитываются отдельным числом и в сумму баллов не входят.":
      "They are usually found on ultrasound. Counted as a separate number and not included in the points total.",
    "Недифференцированная дисплазия соединительной ткани — фон, на котором нарушения углеводного обмена выявляют раньше. У каждого признака свой балл по шкале ДСТ, и считаются они отдельно от риска диабета: так врач сможет сравнить детей с дисплазией и без неё. Отмечайте только то, в чём уверены, — точную степень определит врач на осмотре.":
      "Undifferentiated connective tissue dysplasia is a background against which disorders of carbohydrate metabolism are detected earlier. Every sign has its own score on the CTD scale, and they are counted separately from the diabetes risk, so the doctor can compare children with and without dysplasia. Mark only what you are sure of — the doctor will determine the exact grade at the examination."
  });

  /* ---- Кабинет врача: регистрация, карточка оценки, выгрузка -------- */

  Object.assign(D.uz, {
    "Регистрация врача":
      "Shifokorni roʻyxatdan oʻtkazish",
    "Учётная запись врача заводится по коду клиники. Код выдаёт тот, кто отвечает за платформу в вашей клинике.":
      "Shifokor hisobi klinika kodi boʻyicha ochiladi. Kodni klinikangizda platforma uchun javob beradigan xodim beradi.",
    "Имя и фамилия":
      "Ism va familiya",
    "Например, Е. Ковалёва":
      "Masalan, E. Kovalyova",
    "Код клиники":
      "Klinika kodi",
    "Уже есть доступ?":
      "Kirish huquqi bormi?",
    "Войти в кабинет врача":
      "Shifokor kabinetiga kirish",
    "Нет доступа?":
      "Kirish huquqi yoʻqmi?",
    "Зарегистрироваться по коду клиники":
      "Klinika kodi bilan roʻyxatdan oʻtish",
    "Введите код клиники.":
      "Klinika kodini kiriting.",
    "Карточка оценки":
      "Baho kartochkasi",
    "Метка пациента":
      "Bemor belgisi",
    "Анкета не собирает имя ребёнка. Метку ставит врач, и видна она только в кабинете врача.":
      "Soʻrovnoma bolaning ismini olmaydi. Belgini shifokor qoʻyadi va u faqat shifokor kabinetida koʻrinadi.",
    "Например, Иванов Тимур":
      "Masalan, Ivanov Timur",
    "Повторный контроль":
      "Takroriy nazorat",
    "Нужен повторный контроль":
      "Takroriy nazorat kerak",
    "Отметка видна родителю в его кабинете и попадает в фильтр «На контроле».":
      "Belgi ota-onaga oʻz kabinetida koʻrinadi va «Nazoratda» filtriga tushadi.",
    "Кто на повторном контроле":
      "Kim takroriy nazoratda",
    "90 дней":
      "90 kun",
    "Год":
      "Yil",
    "{n} дней":
      "{n} kun",
    "За последние {n} дней":
      "Soʻnggi {n} kun ichida",
    "Отчёт за период по сохранённым оценкам":
      "Saqlangan baholar boʻyicha davr hisoboti",
    "Оценок за период":
      "Davr ichidagi baholar",
    "Осмотрено по шкале ДСТ":
      "BTD shkalasi boʻyicha koʻrilgan",
    "средний риск {avg}%":
      "oʻrtacha xavf {avg}%",
    "Чаще всего влияло на оценку":
      "Bahoga eng koʻp taʼsir qilgan",
    "Сколько анкет за период содержали фактор":
      "Davr ichida omil nechta soʻrovnomada uchragan",
    "Фактор":
      "Omil",
    "Анкет":
      "Soʻrovnomalar",
    "Доля":
      "Ulush",
    "Степень":
      "Daraja",
    "Степени ДСТ за период":
      "Davr ichidagi BTD darajalari",
    "По анкетам, а не по детям":
      "Bolalar emas, soʻrovnomalar boʻyicha",
    "Нет данных за период.":
      "Davr uchun maʼlumot yoʻq.",
    "Выгрузка":
      "Yuklab olish",
    "Выгрузить за период":
      "Davr uchun yuklab olish",
    "Файл CSV открывается в Excel: все ответы, риск и степень ДСТ":
      "CSV fayli Excelda ochiladi: barcha javoblar, xavf va BTD darajasi",
    "В файл попадают: код оценки, дата, метка пациента, возраст и пол, рост и вес, ИМТ, риск диабета в процентах, уровень, индекс и степень ДСТ, число признаков и аномалий, группа крови, питание, симптомы и факторы риска.":
      "Faylga quyidagilar tushadi: baho kodi, sana, bemor belgisi, yosh va jins, boʻy va vazn, TVI, foizdagi diabet xavfi, daraja, BTD indeksi va darajasi, belgilar va anomaliyalar soni, qon guruhi, ovqatlanish, alomatlar va xavf omillari.",
    "Считаются дети: у ребёнка берётся последняя анкета. Степень — по осмотру врача, а если осмотра не было, предварительно по ответам родителя":
      "Bolalar hisoblanadi: har bir bolaning oxirgi soʻrovnomasi olinadi. Daraja — shifokor koʻrigi boʻyicha, koʻrik boʻlmagan boʻlsa — ota-ona javoblari boʻyicha dastlabki"
  });

  Object.assign(D.en, {
    "Регистрация врача":
      "Doctor registration",
    "Учётная запись врача заводится по коду клиники. Код выдаёт тот, кто отвечает за платформу в вашей клинике.":
      "A doctor account is created with a clinic code. The code is issued by whoever runs the platform at your clinic.",
    "Имя и фамилия":
      "First and last name",
    "Например, Е. Ковалёва":
      "For example, E. Kovaleva",
    "Код клиники":
      "Clinic code",
    "Уже есть доступ?":
      "Already have access?",
    "Войти в кабинет врача":
      "Sign in to the doctor cabinet",
    "Нет доступа?":
      "No access yet?",
    "Зарегистрироваться по коду клиники":
      "Register with a clinic code",
    "Введите код клиники.":
      "Enter the clinic code.",
    "Карточка оценки":
      "Assessment card",
    "Метка пациента":
      "Patient label",
    "Анкета не собирает имя ребёнка. Метку ставит врач, и видна она только в кабинете врача.":
      "The questionnaire does not collect the child's name. The label is set by the doctor and is visible only in the doctor cabinet.",
    "Например, Иванов Тимур":
      "For example, Ivanov Timur",
    "Повторный контроль":
      "Follow-up",
    "Нужен повторный контроль":
      "Follow-up needed",
    "Отметка видна родителю в его кабинете и попадает в фильтр «На контроле».":
      "The flag is visible to the parent in their cabinet and appears in the “Follow-up” filter.",
    "Кто на повторном контроле":
      "Who needs follow-up",
    "90 дней":
      "90 days",
    "Год":
      "Year",
    "{n} дней":
      "{n} days",
    "За последние {n} дней":
      "In the last {n} days",
    "Отчёт за период по сохранённым оценкам":
      "Report on saved assessments for the period",
    "Оценок за период":
      "Assessments in the period",
    "Осмотрено по шкале ДСТ":
      "Examined on the CTD scale",
    "средний риск {avg}%":
      "average risk {avg}%",
    "Чаще всего влияло на оценку":
      "Most frequent contributing factors",
    "Сколько анкет за период содержали фактор":
      "How many questionnaires in the period included the factor",
    "Фактор":
      "Factor",
    "Анкет":
      "Questionnaires",
    "Доля":
      "Share",
    "Степень":
      "Grade",
    "Степени ДСТ за период":
      "CTD grades in the period",
    "По анкетам, а не по детям":
      "By questionnaires, not by children",
    "Нет данных за период.":
      "No data for the period.",
    "Выгрузка":
      "Export",
    "Выгрузить за период":
      "Export the period",
    "Файл CSV открывается в Excel: все ответы, риск и степень ДСТ":
      "The CSV file opens in Excel: all answers, the risk and the CTD grade",
    "В файл попадают: код оценки, дата, метка пациента, возраст и пол, рост и вес, ИМТ, риск диабета в процентах, уровень, индекс и степень ДСТ, число признаков и аномалий, группа крови, питание, симптомы и факторы риска.":
      "The file contains: assessment code, date, patient label, age and sex, height and weight, BMI, diabetes risk as a percentage, level, CTD index and grade, the number of signs and anomalies, blood group, diet, symptoms and risk factors.",
    "Считаются дети: у ребёнка берётся последняя анкета. Степень — по осмотру врача, а если осмотра не было, предварительно по ответам родителя":
      "Children are counted: the latest questionnaire of each child is used. The grade comes from the doctor's examination or, if there was none, a preliminary estimate from the parent's answers"
  });

  /* ---- Настройки кабинета: код клиники, врачи, пароль --------------- */

  Object.assign(D.uz, {
    "Профиль врача и доступ к кабинету":
      "Shifokor profili va kabinetga kirish huquqi",
    "Профиль":
      "Profil",
    "Кто вошёл в кабинет":
      "Kabinetga kim kirgan",
    "Права":
      "Huquqlar",
    "Смена пароля":
      "Parolni almashtirish",
    "Текущий пароль":
      "Joriy parol",
    "Новый пароль":
      "Yangi parol",
    "Сменить пароль":
      "Parolni almashtirish",
    "По нему врач заводит себе учётную запись":
      "Shifokor shu kod bilan oʻziga hisob ochadi",
    "Передайте код врачу вместе со ссылкой на страницу регистрации. Новый код отменяет старый: те, кто уже зарегистрировался, остаются.":
      "Kodni roʻyxatdan oʻtish sahifasi havolasi bilan birga shifokorga bering. Yangi kod eskisini bekor qiladi: allaqachon roʻyxatdan oʻtganlar qoladi.",
    "Скопировать":
      "Nusxalash",
    "Создать новый":
      "Yangisini yaratish",
    "Врачи":
      "Shifokorlar",
    "У кого есть доступ к оценкам пациентов":
      "Bemorlar baholariga kimda kirish huquqi bor",
    "Добавлен":
      "Qoʻshilgan",
    "Администратор":
      "Administrator",
    "Всего врачей: {n}":
      "Jami shifokorlar: {n}",
    "это вы":
      "bu siz",
    "Сделать администратором":
      "Administrator qilish",
    "Сделать педиатром":
      "Pediatr qilish",
    "Убрать доступ":
      "Kirishni bekor qilish",
    "Точно убрать?":
      "Aniq bekor qilinsinmi?",
    "Доступ убран":
      "Kirish bekor qilindi",
    "Код скопирован":
      "Kod nusxalandi",
    "Новый код клиники создан":
      "Yangi klinika kodi yaratildi",
    "Пароль изменён":
      "Parol oʻzgartirildi",
    "Пароль не короче 8 символов.":
      "Parol kamida 8 belgidan iborat boʻlsin.",
    "Не удалось сменить пароль.":
      "Parolni almashtirib boʻlmadi.",
    "Код задан переменной окружения NDST_CLINIC_CODE — менять его нужно там.":
      "Kod NDST_CLINIC_CODE muhit oʻzgaruvchisida berilgan — uni oʻsha yerda oʻzgartirish kerak.",
    "Нужны права администратора":
      "Administrator huquqlari kerak",
    "Текущий пароль не подошёл":
      "Joriy parol notoʻgʻri",
    "Это единственный администратор — сначала назначьте другого":
      "Bu yagona administrator — avval boshqasini tayinlang",
    "Нельзя убрать доступ самому себе":
      "Oʻzingizning kirish huquqingizni bekor qila olmaysiz",
    "Врач не найден":
      "Shifokor topilmadi",
    "Код задан через NDST_CLINIC_CODE — меняется только там":
      "Kod NDST_CLINIC_CODE orqali berilgan — faqat oʻsha yerda oʻzgaradi",
    "Неверный код клиники":
      "Klinika kodi notoʻgʻri"
  });

  Object.assign(D.en, {
    "Профиль врача и доступ к кабинету":
      "Doctor profile and cabinet access",
    "Профиль":
      "Profile",
    "Кто вошёл в кабинет":
      "Who is signed in",
    "Права":
      "Rights",
    "Смена пароля":
      "Change password",
    "Текущий пароль":
      "Current password",
    "Новый пароль":
      "New password",
    "Сменить пароль":
      "Change password",
    "По нему врач заводит себе учётную запись":
      "A doctor uses it to create an account",
    "Передайте код врачу вместе со ссылкой на страницу регистрации. Новый код отменяет старый: те, кто уже зарегистрировался, остаются.":
      "Give the code to the doctor together with the link to the registration page. A new code cancels the old one; everyone already registered keeps access.",
    "Скопировать":
      "Copy",
    "Создать новый":
      "Create a new one",
    "Врачи":
      "Doctors",
    "У кого есть доступ к оценкам пациентов":
      "Who has access to patient assessments",
    "Добавлен":
      "Added",
    "Администратор":
      "Administrator",
    "Всего врачей: {n}":
      "Doctors in total: {n}",
    "это вы":
      "this is you",
    "Сделать администратором":
      "Make administrator",
    "Сделать педиатром":
      "Make paediatrician",
    "Убрать доступ":
      "Revoke access",
    "Точно убрать?":
      "Really revoke?",
    "Доступ убран":
      "Access revoked",
    "Код скопирован":
      "Code copied",
    "Новый код клиники создан":
      "A new clinic code has been created",
    "Пароль изменён":
      "Password changed",
    "Пароль не короче 8 символов.":
      "The password must be at least 8 characters.",
    "Не удалось сменить пароль.":
      "Could not change the password.",
    "Код задан переменной окружения NDST_CLINIC_CODE — менять его нужно там.":
      "The code is set by the NDST_CLINIC_CODE environment variable — change it there.",
    "Нужны права администратора":
      "Administrator rights are required",
    "Текущий пароль не подошёл":
      "The current password is wrong",
    "Это единственный администратор — сначала назначьте другого":
      "This is the only administrator — appoint another one first",
    "Нельзя убрать доступ самому себе":
      "You cannot revoke your own access",
    "Врач не найден":
      "Doctor not found",
    "Код задан через NDST_CLINIC_CODE — меняется только там":
      "The code is set through NDST_CLINIC_CODE and can only be changed there",
    "Неверный код клиники":
      "Wrong clinic code"
  });

  /* ---- База знаний и сброс пароля врача ----------------------------- */

  Object.assign(D.uz, {
    "Как платформа считает риск диабета и степень ДСТ":
      "Platforma diabet xavfi va BTD darajasini qanday hisoblaydi",
    "Риск сахарного диабета":
      "Qandli diabet xavfi",
    "Процент от 0 до 97":
      "0 dan 97 gacha foiz",
    "Каждый отмеченный признак даёт баллы. Сумма переводится в процент по насыщающей кривой 100 × (1 − e^(−сумма / 62)): первые значимые признаки поднимают оценку сильнее всего.":
      "Har bir belgilangan belgi ball beradi. Yigʻindi 100 × (1 − e^(−yigʻindi / 62)) toʻyinuvchi egri chiziq boʻyicha foizga aylantiriladi: dastlabki ahamiyatli belgilar bahoni eng koʻp oshiradi.",
    "Если у ребёнка одновременно жажда, частое мочеиспускание и потеря веса или ночное недержание, оценка не ниже 70%.":
      "Agar bolada bir vaqtda chanqoq, tez-tez siyish va vazn yoʻqotish yoki tungi siydik tuta olmaslik boʻlsa, baho 70% dan past boʻlmaydi.",
    "Уровни: до 25% — низкий риск, 25–59% — умеренный, 60% и выше — высокий.":
      "Darajalar: 25% gacha — past xavf, 25–59% — oʻrtacha, 60% va undan yuqori — yuqori.",
    "Шкала ДСТ":
      "BTD shkalasi",
    "Считается отдельно от риска диабета":
      "Diabet xavfidan alohida hisoblanadi",
    "Индекс — сумма баллов фенотипических признаков, признаков с градацией и признака арахнодактилии. 0–15 — недостаточно фенотипических признаков, 16–25 — I степень, 26–35 — II степень, 36 и выше — III степень.":
      "Indeks — fenotipik belgilar, darajali belgilar va araxnodaktiliya belgisi ballarining yigʻindisi. 0–15 — fenotipik belgilar yetarli emas, 16–25 — I daraja, 26–35 — II daraja, 36 va undan yuqori — III daraja.",
    "Аномалии органов считаются отдельным числом и в индекс не входят.":
      "Aʼzolar anomaliyalari alohida son sifatida hisoblanadi va indeksga kirmaydi.",
    "Родитель отмечает частые признаки, врач заполняет полный список на осмотре. Осмотр врача переносится на следующие анкеты того же ребёнка.":
      "Ota-ona koʻp uchraydigan belgilarni belgilaydi, shifokor koʻrikda toʻliq roʻyxatni toʻldiradi. Shifokor koʻrigi shu bolaning keyingi soʻrovnomalariga oʻtkaziladi.",
    "Баллы факторов риска диабета":
      "Diabet xavf omillari ballari",
    "Те же веса, что в анкете и на сервере":
      "Soʻrovnoma va serverdagi bilan bir xil vaznlar",
    "Баллы":
      "Ballar",
    "Баллы признаков ДСТ":
      "BTD belgilari ballari",
    "По документу «Новые правила программы»":
      "«Dasturning yangi qoidalari» hujjati boʻyicha",
    "Признак":
      "Belgi",
    "В анкете родителя":
      "Ota-ona soʻrovnomasida",
    "да":
      "ha",
    "Ограничения":
      "Cheklovlar",
    "Что важно помнить при чтении результата":
      "Natijani oʻqishda nimani yodda tutish kerak",
    "Результат — оценка факторов риска, а не диагноз.":
      "Natija — xavf omillarini baholash, tashxis emas.",
    "Баллы шкалы ДСТ взяты из документа DST. Баллы факторов риска диабета расставлены по клинической логике и должны пройти проверку врачом-эндокринологом перед применением на реальных пациентах.":
      "BTD shkalasi ballari DST hujjatidan olingan. Diabet xavf omillari ballari klinik mantiq asosida qoʻyilgan va haqiqiy bemorlarda qoʻllashdan oldin endokrinolog shifokor tomonidan tekshirilishi kerak.",
    "Сбросить пароль":
      "Parolni tiklash",
    "единственный администратор":
      "yagona administrator",
    "Временный пароль для":
      "Vaqtinchalik parol:",
    "Передайте его врачу — сменить пароль он сможет в своих настройках. Больше этот пароль нигде не покажется.":
      "Uni shifokorga bering — parolni oʻz sozlamalarida almashtira oladi. Bu parol boshqa hech qayerda koʻrsatilmaydi.",
    "Свой пароль меняется в профиле":
      "Oʻz parolingiz profilda almashtiriladi"
  });

  Object.assign(D.en, {
    "Как платформа считает риск диабета и степень ДСТ":
      "How the platform calculates diabetes risk and the CTD grade",
    "Риск сахарного диабета":
      "Diabetes risk",
    "Процент от 0 до 97":
      "A percentage from 0 to 97",
    "Каждый отмеченный признак даёт баллы. Сумма переводится в процент по насыщающей кривой 100 × (1 − e^(−сумма / 62)): первые значимые признаки поднимают оценку сильнее всего.":
      "Every marked sign adds points. The sum is converted into a percentage with the saturating curve 100 × (1 − e^(−sum / 62)): the first significant signs raise the score the most.",
    "Если у ребёнка одновременно жажда, частое мочеиспускание и потеря веса или ночное недержание, оценка не ниже 70%.":
      "If the child has thirst, frequent urination and weight loss or bedwetting at the same time, the score is at least 70%.",
    "Уровни: до 25% — низкий риск, 25–59% — умеренный, 60% и выше — высокий.":
      "Levels: below 25% — low risk, 25–59% — moderate, 60% and above — high.",
    "Шкала ДСТ":
      "CTD scale",
    "Считается отдельно от риска диабета":
      "Calculated separately from the diabetes risk",
    "Индекс — сумма баллов фенотипических признаков, признаков с градацией и признака арахнодактилии. 0–15 — недостаточно фенотипических признаков, 16–25 — I степень, 26–35 — II степень, 36 и выше — III степень.":
      "The index is the sum of points for phenotypic signs, graded signs and the arachnodactyly sign. 0–15 — not enough phenotypic signs, 16–25 — grade I, 26–35 — grade II, 36 and above — grade III.",
    "Аномалии органов считаются отдельным числом и в индекс не входят.":
      "Organ anomalies are counted as a separate number and are not included in the index.",
    "Родитель отмечает частые признаки, врач заполняет полный список на осмотре. Осмотр врача переносится на следующие анкеты того же ребёнка.":
      "The parent marks the common signs; the doctor fills in the full list at the examination. The doctor's examination carries over to the child's later questionnaires.",
    "Баллы факторов риска диабета":
      "Diabetes risk factor points",
    "Те же веса, что в анкете и на сервере":
      "The same weights as in the questionnaire and on the server",
    "Баллы":
      "Points",
    "Баллы признаков ДСТ":
      "CTD sign points",
    "По документу «Новые правила программы»":
      "According to the “New programme rules” document",
    "Признак":
      "Sign",
    "В анкете родителя":
      "In the parent questionnaire",
    "да":
      "yes",
    "Ограничения":
      "Limitations",
    "Что важно помнить при чтении результата":
      "What to keep in mind when reading the result",
    "Результат — оценка факторов риска, а не диагноз.":
      "The result is a risk factor assessment, not a diagnosis.",
    "Баллы шкалы ДСТ взяты из документа DST. Баллы факторов риска диабета расставлены по клинической логике и должны пройти проверку врачом-эндокринологом перед применением на реальных пациентах.":
      "CTD scale points come from the DST document. Diabetes risk factor points follow clinical reasoning and must be reviewed by an endocrinologist before use with real patients.",
    "Сбросить пароль":
      "Reset password",
    "единственный администратор":
      "the only administrator",
    "Временный пароль для":
      "Temporary password for",
    "Передайте его врачу — сменить пароль он сможет в своих настройках. Больше этот пароль нигде не покажется.":
      "Give it to the doctor — they can change it in their settings. This password will not be shown anywhere again.",
    "Свой пароль меняется в профиле":
      "Change your own password in the profile"
  });

  /* ---- Счётчики на главной ------------------------------------------ */

  Object.assign(D.uz, {
    "признак": "belgi",
    "61 признак · веса по значимости": "61 ta belgi · ahamiyatiga koʻra vaznlar",
    "22 фактора · питание · среда": "22 ta omil · ovqatlanish · muhit",
    "27 признаков · шкала ДСТ": "27 ta belgi · BTD shkalasi"
  });

  Object.assign(D.en, {
    "признак": "signs",
    "61 признак · веса по значимости": "61 signs · weighted by significance",
    "22 фактора · питание · среда": "22 factors · diet · environment",
    "27 признаков · шкала ДСТ": "27 signs · CTD scale"
  });

  /* ---- Заголовок главной: тема работы ---------------------------------
     H1 состоит из трёх кусков: [1] <span>[2]</span> [3]. В узбекском и
     английском естественный порядок слов другой, поэтому значения смещены —
     подряд они читаются как цельная фраза. */

  Object.assign(D.uz, {
    "Раннее выявление предикторов":
      "Differensiallanmagan biriktiruvchi toʻqima displaziyasi boʻlgan bolalarda",
    "сахарного диабета у детей":
      "qandli diabet",
    "с недифференцированными дисплазиями соединительной ткани":
      "prediktorlarini erta aniqlash"
  });

  Object.assign(D.en, {
    "Раннее выявление предикторов":
      "Early detection of",
    "сахарного диабета у детей":
      "diabetes",
    "с недифференцированными дисплазиями соединительной ткани":
      "predictors in children with undifferentiated connective tissue dysplasia"
  });

  /* ======================================================================
     Запуск
     ====================================================================== */

  function init() {
    mountSwitchers();
    setLang(detect(), true);
  }

  window.NdstI18n = {
    t: t,
    apply: apply,
    plural: plural,
    months: months,
    setLang: setLang,
    get lang() { return lang; },
    dict: D
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
