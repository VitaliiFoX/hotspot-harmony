// Ukrainian texts of the page, keyed by the English text they replace. The only file where Cyrillic is allowed
// (scripts/check_english.py). A key that is missing here falls back to English.
//
// Plural entries (the `other` text of `tn`) hold three forms, "one|few|many". Month names are lower case, as inside
// a sentence; "<Month>.of" is the genitive of a date ("20 серпня") and "<Mon>.short" the axis label.

export const UK: Record<string, string> = {
  Ukrainian: "Українська",

  January: "січень",
  February: "лютий",
  March: "березень",
  April: "квітень",
  May: "травень",
  June: "червень",
  July: "липень",
  August: "серпень",
  September: "вересень",
  October: "жовтень",
  November: "листопад",
  December: "грудень",
  "January.of": "січня",
  "February.of": "лютого",
  "March.of": "березня",
  "April.of": "квітня",
  "May.of": "травня",
  "June.of": "червня",
  "July.of": "липня",
  "August.of": "серпня",
  "September.of": "вересня",
  "October.of": "жовтня",
  "November.of": "листопада",
  "December.of": "грудня",
  "Jan.short": "січ",
  "Feb.short": "лют",
  "Mar.short": "бер",
  "Apr.short": "квіт",
  "May.short": "трав",
  "Jun.short": "черв",
  "Jul.short": "лип",
  "Aug.short": "серп",
  "Sep.short": "вер",
  "Oct.short": "жовт",
  "Nov.short": "лист",
  "Dec.short": "груд",
  // A place in a ranking, masculine to agree with the month names: 1-й, 10-й, 22-й.
  "{place}.ordinal": "{place}-й",
  Mo: "Пн",
  Tu: "Вт",
  We: "Ср",
  Th: "Чт",
  Fr: "Пт",
  Sa: "Сб",
  Su: "Нд",

  Ukraine: "Україна",
  Argentina: "Аргентина",
  West: "Зах.",
  South: "Півд.",
  East: "Сх.",
  North: "Півн.",
  N: "пн. ш.",
  S: "пд. ш.",
  E: "сх. д.",
  W: "зх. д.",

  hotspots: "гарячі точки",
  "fire cell-days": "клітинко-дні з вогнем",
  "MODIS-equivalent fire cell-days": "клітинко-дні з вогнем в еквіваленті MODIS",
  "MODIS Terra only, scaled": "лише MODIS Terra, масштабовано",
  "MODIS Terra + Aqua (reference)": "MODIS Terra + Aqua (еталон)",
  "VIIRS NOAA-20, harmonized": "VIIRS NOAA-20, гармонізовано",
  "MODIS Terra, scaled": "MODIS Terra, масштабовано",
  "Country, per year": "Країна, за рік",
  "Country, per month": "Країна, за місяць",
  "1° tile, per year": "Квадрат 1°, за рік",
  "1° tile, per month": "Квадрат 1°, за місяць",
  "This method, on years it did not see": "Цей метод, на роках, яких він не бачив",
  "Baseline: one scaling factor, fitted on all years": "Базова лінія: один коефіцієнт, підібраний на всіх роках",
  "Baseline: VIIRS as delivered, no correction": "Базова лінія: VIIRS як є, без поправки",
  "No cell with burning falls inside this area. Either it has not burned, or it lies outside the borders of the regions with data, which are checked by bounding box only.":
    "У цю область не потрапляє жодна клітинка з горінням. Або тут не горіло, або область лежить поза межами регіонів з даними, які перевіряються лише за обмежувальним прямокутником.",
  "Chornobyl exclusion zone, April 2020": "Чорнобильська зона відчуження, квітень 2020",
  "A box around the exclusion zone; the globe opens on the day of the April 2020 fires with the most hotspots in it.":
    "Прямокутник навколо зони відчуження; глобус відкривається на дні квітневих пожеж 2020 року з найбільшою кількістю гарячих точок у ньому.",
  "Southern steppe, summer 2015": "Південний степ, літо 2015",
  "A box over the steppe from Mykolaiv to Zaporizhzhia, where most burning comes in July and August; the globe opens on its busiest day before 2022.":
    "Прямокутник над степом від Миколаєва до Запоріжжя, де найбільше горить у липні та серпні; глобус відкривається на найактивнішому дні до 2022 року.",

  "Fill in all four edges of the area.": "Заповніть усі чотири межі області.",
  "West must be smaller than east.": "Захід має бути меншим за схід.",
  "South must be smaller than north.": "Південь має бути меншим за північ.",
  "The area is off the map.": "Область виходить за межі карти.",
  "Part of the area is outside the regions that have data ({names}); only the covered part is counted.":
    "Частина області лежить поза регіонами з даними ({names}); враховано лише покриту частину.",
  "The API has no data yet. Run `make data`, then restart `make api`.":
    "В API ще немає даних. Запустіть `make data`, потім перезапустіть `make api`.",
  "Cannot reach the API: {reason}. Start it with `make api`.": "Немає зв'язку з API: {reason}. Запустіть його командою `make api`.",
  "The export stops at {limit} hotspots. Choose a smaller area or a shorter period to get all of them.":
    "Експорт обмежено {limit} гарячими точками. Щоб отримати всі, виберіть меншу область або коротший період.",
  "The export failed: {reason}": "Експорт не вдався: {reason}",
  "VIIRS S-NPP replaces MODIS": "VIIRS S-NPP замінює MODIS",
  "Raw record": "Сирий ряд",
  "Harmonized record": "Гармонізований ряд",
  "Burning activity calendar from satellite fire hotspots, 2000 to 2025":
    "Календар активності горіння за супутниковими гарячими точками, 2000–2025",
  Language: "Мова",
  Theme: "Тема",
  System: "Системна",
  Light: "Світла",
  Dark: "Темна",
  "Example areas": "Приклади областей",
  Examples: "Приклади",
  "Values are {unit} (1 km cells with fire on a day), matched to the MODIS Terra + Aqua reference, so {first} and {last} compare.":
    "Значення — {unit} (клітинки 1 км з вогнем за день), зведені до еталону MODIS Terra + Aqua, тож {first} і {last} можна порівнювати.",
  "Raw {unit}, uncorrected: VIIRS sees small fires MODIS misses, so values jump at {month} and cannot be compared across it.":
    "Сирі {unit} без поправки: VIIRS бачить дрібні пожежі, яких не помічає MODIS, тож з {month} значення стрибають і порівнювати через цю межу не можна.",
  MODIS: "MODIS",
  "VIIRS S-NPP": "VIIRS S-NPP",
  "as reported": "як є",
  "adjusted to the reference": "зведено до еталону",
  "values jump at its start": "на його початку значення стрибають",
  "How far to trust it": "Наскільки цьому довіряти",
  "Loading the record...": "Завантаження ряду...",
  "Burning activity calendar": "Календар активності горіння",
  "Hotspot Harmony - burning activity calendar": "Hotspot Harmony - календар активності горіння",
  "Colour scale": "Шкала кольору",
  "Log scale": "Логарифмічна шкала",
  "Linear scale": "Лінійна шкала",
  "Download calendar data (CSV)": "Завантажити дані календаря (CSV)",
  "Peak burning months": "Місяці піку горіння",
  "The fewest months that together hold {share}% of a typical year, where a typical year adds up each month's median over every year of the record. Burning activity, not fire risk.":
    "Найменше число місяців, що разом дають {share}% типового року; типовий рік — це сума медіан кожного місяця за всі роки ряду. Це активність горіння, а не пожежний ризик.",
  "Counted on the raw record, which jumps in 2012; the harmonized record compares the years fairly.":
    "Пораховано за сирим рядом, який стрибає у 2012 році; гармонізований ряд порівнює роки чесно.",
  "{year} against the usual season": "{year} проти звичайного сезону",
  "Monthly {unit}; median and middle half over all years": "{unit} за місяць; медіана і середня половина за всі роки",
  Year: "Рік",
  "Burning per year": "Горіння за рік",
  "Yearly {unit} within the selected period. The line is the raw record: MODIS before {month}, VIIRS S-NPP from then on, in {lineUnit} with no correction":
    "{unit} за рік у вибраному періоді. Лінія — сирий ряд: MODIS до {month}, далі VIIRS S-NPP, {lineUnit} без поправки",
  "Yearly {unit} within the selected period": "{unit} за рік у вибраному періоді",
  "Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m). This project is not affiliated with or endorsed by NASA.":
    "Дані: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 м). Проєкт не пов'язаний з NASA і не схвалений нею.",
  "Monthly {unit} in the area, over {count} grid cells with burning":
    "{unit} за місяць в області, по {count} клітинці сітки з горінням|{unit} за місяць в області, по {count} клітинках сітки з горінням|{unit} за місяць в області, по {count} клітинках сітки з горінням",

  "Burning in a month that is usually quiet": "Горіння в місяць, який зазвичай спокійний",
  "No burning, as usual for {month}": "Горіння немає, як зазвичай для цього місяця",
  "{month} {year} is within the method's error of a typical {month}": "{month} {year}: у межах похибки методу від типового місяця",
  "{month} {year} burned as much as a typical {month}": "{month} {year}: горіло стільки ж, скільки в типовий {month}",
  "{month} {year} burned more than a typical {month}": "{month} {year}: горіло більше, ніж у типовий {month}",
  "{month} {year} burned less than a typical {month}": "{month} {year}: горіло менше, ніж у типовий {month}",
  "the {month} median is zero, so there is no ratio": "медіана за {month} нульова, тож відношення немає",
  "the {month} median; the harmonized record can be off by about {error} in a month like this, so this is not unusual":
    "від медіани за {month}; гармонізований ряд може помилятися приблизно на {error} у такий місяць, тож це не незвично",
  "the {month} median; further from it than the method's error of about {error}":
    "від медіани за {month}; далі від неї, ніж похибка методу, приблизно {error}",
  "the {month} median; MODIS as reported, so no harmonization error":
    "від медіани за {month}; MODIS як є, тож похибки гармонізації немає",
  "the {month} median": "від медіани за {month}",
  "{month} {year} against its history": "{month} {year} проти своєї історії",
  "n/a": "н/д",
  "The busiest of {n} {month}s": "Найактивніший {month} із {n}",
  "{rank} busiest of {n} {month}s": "{rank} найактивніший {month} із {n}",
  "{month} {year} is the busiest of the last 12 months of the period": "{month} {year} — найактивніший з останніх 12 місяців періоду",
  "{month} {year} is the last month of the period": "{month} {year} — останній місяць періоду",
  "Without harmonization": "Без гармонізації",
  "The raw record sets VIIRS, which sees many more small fires, against a median that is partly MODIS.":
    "Сирий ряд порівнює VIIRS, який бачить значно більше дрібних пожеж, з медіаною, що частково складається з MODIS.",
  "Each dot is one {month}, {first} to {last}": "Кожна точка — {month} одного з років {first}–{last}",
  "Each dot is one {month}, {first} to {last}; the median is over all {n} years on record":
    "Кожна точка — {month} одного з років {first}–{last}; медіана — за всі {n} рік ряду|Кожна точка — {month} одного з років {first}–{last}; медіана — за всі {n} роки ряду|Кожна точка — {month} одного з років {first}–{last}; медіана — за всі {n} років ряду",
  "{month} {year}: {value} {unit}": "{month} {year}: {value} ({unit})",
  "median {value}": "медіана {value}",
  "{month} in every year, in {unit}": "{month} кожного року, {unit}",
  "{month} in every year, in {unit}: {own}; {median}. Use the left and right arrow keys to read the years.":
    "{month} кожного року, {unit}: {own}; {median}. Читайте роки клавішами зі стрілками ліворуч і праворуч.",
  Place: "Місце",
  "The record ends with {year}, the last year in the FIRMS country archive, so the latest month here is not the current one.":
    "Ряд закінчується {year} роком, останнім в архіві FIRMS за країнами, тож останній місяць тут не поточний.",
  "A hotspot is a fire the satellite detected: clouds, smoke and the time of the overpass hide some fires, so no hotspot does not prove there was no fire.":
    "Гаряча точка — це пожежа, яку виявив супутник: хмари, дим і час прольоту приховують частину пожеж, тож відсутність гарячої точки не доводить, що пожежі не було.",
  "{unit}, over {n} years": "{unit}, за {n} рік|{unit}, за {n} роки|{unit}, за {n} років",
  "median for {month}": "медіана за {month}",
  "of that median": "від цієї медіани",
  sensor: "сенсор",
  "Burning activity calendar, {first} to {last}. Use the arrow keys to read months, or switch to the table.":
    "Календар активності горіння, {first}–{last}. Читайте місяці клавішами зі стрілками або перемкніться на таблицю.",
  "Highlight {year} in the seasonal chart": "Виділити {year} на сезонному графіку",
  "{min} to {max} {unit}, log scale": "від {min} до {max}, {unit}, логарифмічна шкала",
  "up to {max} {unit}": "до {max}, {unit}",
  "Monthly {unit}": "{unit} за місяць",
  "Show chart": "Показати графік",
  "Show table": "Показати таблицю",
  "Saving image...": "Збереження зображення...",
  "Download PNG": "Завантажити PNG",

  "Loading the hotspots of this day...": "Завантаження гарячих точок цього дня...",
  "Cannot load this day: {error}": "Не вдалося завантажити цей день: {error}",
  "{sensor} was down on this day, so its hotspots are missing or incomplete: a low count or a zero here is missing data, not a quiet day.":
    "{sensor} цього дня не працював, тож його гарячі точки відсутні або неповні: мала кількість чи нуль тут — це брак даних, а не спокійний день.",
  "No hotspots on this day.": "Цього дня гарячих точок немає.",
  "Date and time": "Дата і час",
  "Hotspots from 00:00 through {time} UTC": "Гарячі точки з 00:00 до {time} UTC",
  "Previous month": "Попередній місяць",
  "Next month": "Наступний місяць",
  "Days of {month}": "Дні: {month}",
  ", {sensor} was down: missing data": ", {sensor} не працював: брак даних",
  "{sensor} was down: missing data, not a quiet day": "{sensor} не працював: брак даних, а не спокійний день",
  "Time, UTC": "Час, UTC",
  "Time, UTC, as HH:MM": "Час, UTC, у форматі ГГ:ХХ",
  "Pause the clock": "Зупинити годинник",
  "Play the day": "Програти день",
  Pause: "Пауза",
  "{unit} so far that day": "{unit} за цей день на цей час",
  "Last hour": "Остання година",
  "This day is cut at {count} hotspots, so the figures are lower than the full record.":
    "Цей день обрізано до {count} гарячих точок, тож цифри нижчі за повний ряд.",
  "Sensor: {sensor}": "Сенсор: {sensor}",

  "Period, from": "Період, з",
  to: "до",
  Region: "Регіон",
  "Area of interest: drawn on the map, {n} corners. Its bounds, degrees":
    "Область інтересу: намальована на карті, кутів: {n}. Її межі, градуси",
  "Area of interest, degrees": "Область інтересу, градуси",
  "Remove the drawn area": "Прибрати намальовану область",
  Record: "Ряд",
  "The pipeline has not produced this record yet": "Конвеєр ще не створив цей ряд",
  Raw: "Сирий",
  Harmonized: "Гармонізований",
  "Preparing CSV...": "Готуємо CSV...",
  "Download hotspots (CSV)": "Завантажити гарячі точки (CSV)",

  "An area can have at most {max} corners.": "Область може мати не більше {max} кутів.",
  "Scroll to move down the page. {key} + scroll zooms the map.":
    "Прокручуйте, щоб рухатися сторінкою. {key} + прокрутка масштабує карту.",
  "Use two fingers to move the map.": "Рухайте карту двома пальцями.",
  "Globe of the selected day's hotspots. Drag or use the arrow keys to turn it; plus and minus, or Ctrl or Command with the scroll wheel, to zoom.":
    "Глобус із гарячими точками вибраного дня. Перетягуйте або повертайте його клавішами зі стрілками; масштаб — плюс і мінус або Ctrl чи Command з коліщатком.",
  "Click to make it your area.": "Клацніть, щоб зробити це своєю областю.",
  "raw record": "сирий ряд",
  "harmonized record": "гармонізований ряд",
  "Globe of hotspots": "Глобус гарячих точок",
  "Map of hotspots": "Карта гарячих точок",
  "Map view": "Вигляд карти",
  Globe: "Глобус",
  "Flat map": "Пласка карта",
  "Satellite fire hotspots, day by day": "Супутникові гарячі точки пожеж, день за днем",
  "Burning activity calendar, 2000 to 2025": "Календар активності горіння, 2000–2025",
  "Back to the day": "Назад до дня",
  "Where it burns": "Де горить",
  "Redraw the area": "Перемалювати область",
  "Draw an area": "Намалювати область",
  "Show globe": "Показати глобус",
  "Show map": "Показати карту",
  "Hide the date panel": "Сховати панель дати",
  Hide: "Сховати",
  "Show the date panel": "Показати панель дати",
  "Hotspots on {date}, in {unit}": "Гарячі точки {date}, {unit}",
  "00:00 through {time}": "00:00 – {time}",
  "{from} to {to}": "{from} – {to}",
  "Whole day": "Увесь день",
  All: "Усі",
  "No hotspots loaded for this day.": "Для цього дня гарячі точки не завантажено.",
  "What the cells show": "Що показують клітинки",
  "How much": "Скільки",
  "How it changed": "Як змінилося",
  "1° tiles": "Квадрати 1°",
  "0.25° cells": "Клітинки 0,25°",
  "Click the map to place the corners of your area of interest.": "Клацайте на карті, щоб поставити кути своєї області.",
  "{n} of at least 3 corners placed.": "Поставлено кутів: {n} з щонайменше 3.",
  "{n} corners. Click the first corner, double-click or press Enter to finish.":
    "Кутів: {n}. Щоб завершити, клацніть перший кут, двічі клацніть або натисніть Enter.",
  "Undo corner": "Скасувати кут",
  Finish: "Завершити",
  Cancel: "Скасувати",
  "Your area, {n} corners: {error}": "Ваша область, кутів: {n}: {error}",
  "Your area, {n} corners. The calendar below now counts the burning inside it.":
    "Ваша область, кутів: {n}. Календар нижче тепер рахує горіння всередині неї.",
  "See its calendar": "Дивитися її календар",
  "Remove the area": "Прибрати область",
  "Hide the legend": "Сховати легенду",
  "Cannot load the cells: {error}": "Не вдалося завантажити клітинки: {error}",
  "Loading where it burns...": "Завантаження, де горить...",
  "How burning changed, {late} against {early}, {record}": "Як змінилося горіння, {late} проти {early}, {record}",
  "The period has fewer than two full years: choose a longer one to see a change":
    "У періоді менше двох повних років: виберіть довший, щоб побачити зміну",
  "Where it burns, {start} to {end}: {unit} a year per 100 km², {record}":
    "Де горить, {start} – {end}: {unit} за рік на 100 км², {record}",
  "The raw record switches from MODIS to VIIRS in 2012, so much of this rise is the sensor, not the fire: switch the record to harmonized to see the change that is real.":
    "Сирий ряд у 2012 році переходить з MODIS на VIIRS, тож значна частина цього зростання — сенсор, а не вогонь: перемкніться на гармонізований ряд, щоб побачити справжню зміну.",
  "A change within the method's error for a 1-degree tile and a year (±{error}%) is shown as none.":
    "Зміна в межах похибки методу для квадрата 1° і року (±{error}%) показана як відсутня.",
  "That error was measured on 1-degree tiles; on 0.25-degree cells it is larger, so a small change here can still be noise.":
    "Цю похибку виміряно на квадратах 1°; на клітинках 0,25° вона більша, тож невелика зміна тут ще може бути шумом.",
  "Grey: no burning in the first half. From 2022 the record also holds the fires of the war in the east and south.":
    "Сірий: у першій половині не горіло. З 2022 року ряд містить і пожежі війни на сході та півдні.",
  "Point at a tile for its figures; click it to make it your area. 1-degree tiles are the scale the method's error was measured on.":
    "Наведіть на квадрат, щоб побачити його цифри; клацніть, щоб зробити його своєю областю. Похибку методу виміряно саме на квадратах 1°.",
  "Point at a cell for its figures; click it to make it your area. 0.25-degree cells are finer than the 1-degree tiles the method's error was measured on.":
    "Наведіть на клітинку, щоб побачити її цифри; клацніть, щоб зробити її своєю областю. Клітинки 0,25° дрібніші за квадрати 1°, на яких виміряно похибку методу.",
  "Hotspots through the selected time": "Гарячі точки до вибраного часу",
  "Detected in the hour up to it": "Виявлені за годину до нього",
  "Where hotspots crowd, orange turns red": "Де гарячих точок багато, помаранчевий стає червоним",
  "{key} + scroll zooms the map; scroll alone moves down the page.":
    "{key} + прокрутка масштабує карту; сама прокрутка рухає сторінку.",
  "Data: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 m). Imagery: NASA GIBS (Blue Marble). Map:":
    "Дані: NASA FIRMS (MODIS Collection 6.1, VIIRS 375 м). Знімки: NASA GIBS (Blue Marble). Карта:",
  data: "дані",
  "© OpenStreetMap contributors": "© учасники OpenStreetMap",
  "Show the legend and data credits": "Показати легенду і джерела даних",
  "Legend and credits": "Легенда і джерела",
  "The map needs WebGL2, which this browser does not offer. The burning activity calendar below works without it.":
    "Для карти потрібен WebGL2, якого цей браузер не має. Календар активності горіння нижче працює і без нього.",

  "In short": "Коротко",
  "No month burns in a typical year here: every monthly median is zero. The seasonal chart shows the years that did burn.":
    "У типовий рік тут не горить жоден місяць: усі місячні медіани нульові. Сезонний графік показує роки, коли горіло.",
  "of the burning of a typical year": "горіння типового року",
  Peak: "Пік",
  "one of the peak burning months": "один з місяців піку горіння",
  "Peak burning months: together at least {share} of a typical year": "Місяці піку горіння: разом щонайменше {share} типового року",
  "Other months": "Інші місяці",
  "Share of a typical year's burning in each month; peak burning months: {months}. Use the left and right arrow keys to read months.":
    "Частка горіння типового року в кожному місяці; місяці піку: {months}. Читайте місяці клавішами вліво і вправо.",
  none: "немає",
  "Each month's median over the record, in {unit}, and its share of a typical year":
    "Медіана кожного місяця за весь ряд, {unit}, і її частка в типовому році",
  Month: "Місяць",
  Median: "Медіана",
  "Share of a typical year": "Частка типового року",
  "Peak burning month": "Місяць піку горіння",
  Yes: "Так",
  "{n} months hold {share} of the burning of a typical year":
    "{n} місяць дає {share} горіння типового року|{n} місяці дають {share} горіння типового року|{n} місяців дають {share} горіння типового року",
  "{unit}, median over {n} years": "{unit}, медіана за {n} рік|{unit}, медіана за {n} роки|{unit}, медіана за {n} років",
  median: "медіана",
  "{low} to {high}": "{low} – {high}",
  "middle half of years": "середня половина років",
  "Middle half of years (25th to 75th percentile)": "Середня половина років (від 25-го до 75-го перцентиля)",
  "Median of all years": "Медіана всіх років",
  "Monthly {unit} in {year} against the median of all years. Use the left and right arrow keys to read months.":
    "{unit} за місяць у {year} році проти медіани всіх років. Читайте місяці клавішами вліво і вправо.",
  "Monthly {unit}: {year} against all years": "{unit} за місяць: {year} проти всіх років",
  "25th percentile": "25-й перцентиль",
  "75th percentile": "75-й перцентиль",
  Years: "Років",

  "Where in this area it burns most": "Де в цій області горить найбільше",
  "Busiest cells of the area, {unit} a year": "Найактивніші клітинки області, {unit} за рік",
  "Cell centre": "Центр клітинки",
  "A year": "За рік",
  "Per 100 km²": "На 100 км²",
  "Years burning": "Років з горінням",
  "Most in": "Найбільше в",
  Map: "Карта",
  "{n} of {years}": "{n} з {years}",
  "Show on the map": "Показати на карті",
  "The {n} grid cells of the area with the most {unit} a year, {start} to {end}, harmonized record. A cell is {deg}° on a side, about {km2} km² here.":
    "{n} клітинка сітки області з найбільшою кількістю за рік ({unit}), {start} – {end}, гармонізований ряд. Сторона клітинки {deg}°, тут це близько {km2} км².|{n} клітинки сітки області з найбільшою кількістю за рік ({unit}), {start} – {end}, гармонізований ряд. Сторона клітинки {deg}°, тут це близько {km2} км².|{n} клітинок сітки області з найбільшою кількістю за рік ({unit}), {start} – {end}, гармонізований ряд. Сторона клітинки {deg}°, тут це близько {km2} км².",

  "the overlap years": "роки перекриття",
  "How far to trust this": "Наскільки цьому довіряти",
  "Each year of {years} was hidden in turn. The method was fitted on the other years, and its harmonized VIIRS for the hidden year was compared with what MODIS reported. The error is the sum of the misses over the sum of what MODIS reported.":
    "Кожен рік з {years} по черзі приховували. Метод підбирали на решті років, а його гармонізований VIIRS за прихований рік порівнювали з тим, що показав MODIS. Похибка — це сума промахів, поділена на суму показів MODIS.",
  "{region}, month by month": "{region}, помісячно",
  "An area smaller than {region}, month by month": "Область, менша за регіон {region}, помісячно",
  "error on years the method did not see": "похибка на роках, яких метод не бачив",
  "error of a 1° tile on years the method did not see; a larger area errs less":
    "похибка квадрата 1° на роках, яких метод не бачив; більша область помиляється менше",
  "One scaling factor instead": "Натомість один коефіцієнт",
  "the simplest correction, fitted on all years, the hidden one included":
    "найпростіша поправка, підібрана на всіх роках, разом із прихованим",
  "No correction at all": "Зовсім без поправки",
  "VIIRS as delivered, against MODIS": "VIIRS як є, проти MODIS",
  "{region}: error as a share of what MODIS reported. The method is scored on years it did not see; the scaling factor has seen them all.":
    "{region}: похибка як частка від показів MODIS. Метод оцінено на роках, яких він не бачив; коефіцієнт бачив усі.",
  Check: "Перевірка",
  "What the sensor switch does to {region}": "Що зміна сенсора робить з рядом: {region}",
  "Mean yearly burning in {after} against {before}, for the whole country. The raw record switches from MODIS to VIIRS in 2012; the harmonized one does not jump there.":
    "Середнє річне горіння за {after} проти {before}, для всієї країни. Сирий ряд у 2012 році переходить з MODIS на VIIRS; гармонізований там не стрибає.",
  "The difference between the two is the sensor, not the fire. Up to 2021 the harmonized record is MODIS as reported, so its change is what MODIS itself saw.":
    "Різниця між ними — це сенсор, а не вогонь. До 2021 року гармонізований ряд — це MODIS як є, тож його зміна — те, що бачив сам MODIS.",
  "Where the method loses: one scaling factor does better for {scales}.": "Де метод програє: один коефіцієнт кращий для {scales}.",
  "{scale} ({factor} against {method})": "{scale} ({factor} проти {method})",
  " and ": " і ",
  "Method: {method}, {how}. Bias {bias} over {months} months. From ": "Метод: {method}, {how}. Зсув {bias} за {months} міс. З ",
  "chosen again for every hidden year from the other years alone": "обирався заново для кожного прихованого року лише за іншими роками",
  "chosen once on all years, so this check saw each hidden year in that one step and may flatter the method":
    "обрано один раз на всіх роках, тож ця перевірка на тому кроці бачила кожен прихований рік і може прикрашати метод",
  ", written by ": ", записано командою ",
  " on {time}. ": " {time}. ",
  "All checks": "Усі перевірки",
  "The method": "Метод",

  "Unusual months": "Незвичні місяці",
  "Months that stand out from the same month of the other years of the period: a robust z of {z} or more (median and median absolute deviation), and further from the median than the method's error. Largest departure first.":
    "Місяці, що вирізняються серед того самого місяця інших років періоду: робастний z від {z} (медіана і медіанне абсолютне відхилення) і відстань від медіани більша за похибку методу. Спершу найбільші відхилення.",
  "On the raw record many months after 2012 stand out because VIIRS replaced MODIS, not because more burned.":
    "У сирому ряді багато місяців після 2012 року вирізняються тому, що VIIRS замінив MODIS, а не тому, що горіло більше.",
  "No month of this area stands out from its own history by more than the method's error.":
    "Жоден місяць цієї області не відхиляється від своєї історії більше, ніж на похибку методу.",
  "Show this year on the calendar": "Показати цей рік у календарі",
  "{value} {unit} in a month that usually has none": "{value} ({unit}) у місяць, коли зазвичай нічого немає",
  "{ratio}× its median: {value} against {median} {unit}": "{ratio}× від медіани: {value} проти {median} ({unit})",
  "more than usual, z {z}": "більше, ніж зазвичай, z {z}",
  "less than usual, z {z}": "менше, ніж зазвичай, z {z}",

  From: "Джерело",
  Partial: "Неповний",
  "not all 12 months are covered": "покрито не всі 12 місяців",
  "{columns}, full year": "{columns}, повний рік",
  "Full year": "Повний рік",
  "Partial year": "Неповний рік",
  "{unit} per year, with the {line} as a line. Use the left and right arrow keys to read years.":
    "{unit} за рік, {line} — лінією. Читайте роки клавішами вліво і вправо.",
  "{unit} per year. Use the left and right arrow keys to read years.": "{unit} за рік. Читайте роки клавішами вліво і вправо.",
  "Per year: {columns} in {unit}, {line} in {lineUnit}": "За рік: {columns}, {unit}; {line}, {lineUnit}",
  "{unit} per year": "{unit} за рік",
  Total: "Усього",
  Coverage: "Покриття",

  "No burning in {early}, so no change can be given; about {amount} a year in {late}.":
    "У {early} не горіло, тож зміну не визначити; близько {amount} за рік у {late}.",
  "no change": "без змін",
  "{late} against {early}: {signed}, within the method's error of ±{error}%.":
    "{late} проти {early}: {signed}, у межах похибки методу ±{error}%.",
  "{late} against {early}: {signed} ({ratio}×).": "{late} проти {early}: {signed} ({ratio}×).",
  "Burns in {n} of {years} years, about {amount} {unit} a year ({perArea} per 100 km²), most in {month}.":
    "Горить у {n} з {years} років, близько {amount} ({unit}) за рік ({perArea} на 100 км²), найбільше — {month}.|Горить у {n} з {years} років, близько {amount} ({unit}) за рік ({perArea} на 100 км²), найбільше — {month}.|Горить у {n} з {years} років, близько {amount} ({unit}) за рік ({perArea} на 100 км²), найбільше — {month}.",

  "Peak months: these {n} hold {share}% of a typical year.":
    "Піковий місяць: він дає {share}% типового року.|Пікові місяці: ці {n} дають {share}% типового року.|Пікові місяці: ці {n} дають {share}% типового року.",
  "Busiest full year: {value} {unit}, {ratio}× the median year.":
    "Найактивніший повний рік: {value} ({unit}), {ratio}× від медіанного року.",
  "Busiest full year: {value} {unit}.": "Найактивніший повний рік: {value} ({unit}).",
  "About the same": "Приблизно так само",
  "Burning in {late} against {early}, within the method's error of ±{error}%.":
    "Горіння у {late} проти {early}, у межах похибки методу ±{error}%.",
  "Burning in {late} against {early}.": "Горіння у {late} проти {early}.",
  "{n} months": "{n} місяць|{n} місяці|{n} місяців",
  "in a month that usually has none": "у місяць, коли зазвичай нічого немає",
  "{ratio}× its median": "{ratio}× від медіани",
  "Stand out from their own history; the largest departure was {first}, {how}.":
    "Вирізняється на тлі власної історії: {first}, {how}.|Вирізняються на тлі власної історії; найбільше відхилення — {first}, {how}.|Вирізняються на тлі власної історії; найбільше відхилення — {first}, {how}.",
  "Stand out from their own history by more than the method's error.":
    "Відхиляються від своєї історії більше, ніж на похибку методу.",
  "all year": "увесь рік",
  "{list} and {last}": "{list} і {last}",
  "an unknown time": "невідомий час",

  "Area of interest: {country}, inside its border. Its bounds, degrees": "Область інтересу: {country}, у межах кордону. Її межі, градуси",
  "Back to the box of {region}": "Назад до прямокутника регіону {region}",
  "Globe of the selected day's hotspots. Drag or use the arrow keys to turn it; plus and minus, or Ctrl or Command with the scroll wheel, to zoom. Double-click a country to see its burning calendar below.":
    "Глобус із гарячими точками вибраного дня. Перетягуйте або повертайте його клавішами зі стрілками; масштаб — плюс і мінус або Ctrl чи Command з коліщатком. Двічі клацніть країну, щоб побачити її календар горіння нижче.",
  "Map of the selected day's hotspots. Drag or use the arrow keys to move it; plus and minus, or Ctrl or Command with the scroll wheel, to zoom. Double-click a country to see its burning calendar below.":
    "Карта з гарячими точками вибраного дня. Перетягуйте або рухайте її клавішами зі стрілками; масштаб — плюс і мінус або Ctrl чи Command з коліщатком. Двічі клацніть країну, щоб побачити її календар горіння нижче.",
  "Double-click a country to see its burning calendar below.": "Двічі клацніть країну, щоб побачити її календар горіння нижче.",
  "Borders a country is picked by:": "Кордони для вибору країни:",
  "{country}: no record is loaded for this country yet.": "{country}: ряд для цієї країни ще не завантажено.",
  "{country}. The calendar below now counts the burning inside its border.": "{country}. Календар нижче тепер рахує горіння в межах її кордону.",
  "See what is missing": "Подивитися, чого бракує",
  "Let the country go": "Прибрати країну",
  "Hotspots on {date}": "Гарячі точки {date}",
  "{regions}: no hotspot seen yet. Clouds, smoke and the hours between satellite passes hide some fires, so a zero is not proof there was none.":
    "{regions}: гарячих точок поки не видно. Хмари, дим і години між прольотами супутників приховують частину пожеж, тож нуль не доводить, що їх не було.",
  "None on that day: on a quiet day the satellites can pass without seeing a fire.":
    "Того дня жодної: у спокійний день супутники можуть пролетіти й не побачити вогню.",
  "None in the last hour: a satellite sees a place only a few times a day, so most hours are empty.":
    "За останню годину жодної: супутник бачить місце лише кілька разів на добу, тож більшість годин порожні.",
  "No hotspots in these days. Clouds and smoke can hide fires from the satellites, so this is not proof there were none.":
    "У ці дні гарячих точок немає. Хмари й дим можуть приховати пожежі від супутників, тож це не доводить, що їх не було.",
  "No hotspots on this day. Clouds and smoke can hide fires from the satellites, so this is not proof there were none.":
    "Цього дня гарячих точок немає. Хмари й дим можуть приховати пожежі від супутників, тож це не доводить, що їх не було.",
  "Link copied": "Посилання скопійовано",
  "Copy the address from the browser bar": "Скопіюйте адресу з рядка браузера",
  "Share this view": "Поділитися",
  Day: "День",
  Period: "Період",
  Show: "Показати",
  "Loading the hotspots of these days...": "Завантаження гарячих точок за ці дні...",
  "Cannot load these days: {error}": "Не вдалося завантажити ці дні: {error}",
  "No hotspots in these days.": "У ці дні гарячих точок немає.",
  "click to see its hotspots on the map": "клацніть, щоб побачити його гарячі точки на мапі",
  "Press Enter to see the hotspots of that month on the map.": "Натисніть Enter, щоб побачити гарячі точки цього місяця на мапі.",
  "Click a month to see its hotspots on the map above.": "Клацніть місяць, щоб побачити його гарячі точки на мапі вгорі.",
  "Outlined: {month}, the month on the map above. Click any month to see its hotspots.":
    "Обведено: {month}, місяць на мапі вгорі. Клацніть будь-який місяць, щоб побачити його гарячі точки.",
  "Outlined: {from} to {to}, the months on the map above. Click any month to see its hotspots.":
    "Обведено: {from} – {to}, місяці на мапі вгорі. Клацніть будь-який місяць, щоб побачити його гарячі точки.",
  "Quick periods": "Швидкі періоди",
  "Last 7 days": "Останні 7 днів",
  "This month": "Цей місяць",
  "Fire season": "Пожежний сезон",
  "The area's peak burning months: {span}": "Пікові місяці горіння в області: {span}",
  "The fire season comes from the calendar of the area below, once it has loaded.":
    "Пожежний сезон береться з календаря області нижче, щойно він завантажиться.",
  "Now click the last day; Esc starts over.": "Тепер клацніть останній день; Esc — почати спочатку.",
  "Click a first and a last day to pick another.": "Клацніть перший і останній день, щоб вибрати інший.",
  "Through the day": "До дня",
  "Play the days": "Програти дні",
  "{unit} from {first} through {day}": "{unit} з {first} до {day}",
  "That day": "Того дня",
  "These days hold {count} hotspots; the globe and these figures show an even sample of {shown}.":
    "У ці дні {count} гарячих точок; глобус і ці цифри показують рівномірну вибірку з {shown}.",
  "{sensor} was down on {n} days of this span, so its hotspots are missing or incomplete there.":
    "{sensor} не працював {n} день цього періоду, тож гарячі точки там відсутні або неповні.|{sensor} не працював {n} дні цього періоду, тож гарячі точки там відсутні або неповні.|{sensor} не працював {n} днів цього періоду, тож гарячі точки там відсутні або неповні.",
  "Hotspots, {span}": "Гарячі точки, {span}",
  "{span}, through {day}": "{span}, до {day}",
  "All days": "Усі дні",
  "No hotspots loaded for these days.": "Для цих днів гарячі точки не завантажено.",
  "Hotspots through the selected day": "Гарячі точки до вибраного дня",
  "Detected on that day": "Виявлені того дня",
  "Hotspots of the whole month, {n} days":
    "Гарячі точки за весь місяць, {n} день|Гарячі точки за весь місяць, {n} дні|Гарячі точки за весь місяць, {n} днів",
  "Hotspots from the first day through the last, {n} days":
    "Гарячі точки з першого до останнього дня, {n} день|Гарячі точки з першого до останнього дня, {n} дні|Гарячі точки з першого до останнього дня, {n} днів",
  "within the error": "у межах похибки",
  "Where it burns most, {start} to {end}, {record}: {unit} a year, {deg}° cells":
    "Де горить найбільше, {start} – {end}, {record}: {unit} за рік, клітинки {deg}°",
  "{late} against {early}": "{late} проти {early}",
  "No record for {country} yet": "Для країни {country} ряду ще немає",
  "This build holds the hotspots of {regions}. Once the record of {country} is loaded, its burning activity calendar, peak months, yearly totals and unusual months appear here, counted inside its border.":
    "Ця збірка містить гарячі точки таких регіонів: {regions}. Коли завантажиться ряд для країни {country}, тут з'являться її календар активності горіння, місяці піку, річні суми та незвичні місяці, пораховані в межах кордону.",
  "To load it, add the country to": "Щоб завантажити його, додайте країну до",
  "and run": "і запустіть",
  "; nothing on this page has to change.": "; на сторінці нічого змінювати не треба.",
  "Back to {region}": "Назад до регіону {region}",
  "Counted inside the border of {country}: a grid cell belongs to the country when its centre is inside the border, so a cell on the border counts in full or not at all. Border: Natural Earth, simplified to about 2 km.":
    "Пораховано в межах кордону країни {country}: клітинка сітки належить країні, якщо її центр усередині кордону, тож клітинка на кордоні рахується повністю або зовсім ні. Кордон: Natural Earth, спрощено приблизно до 2 км.",

  "Search a region or a country": "Знайти регіон або країну",
  "Search a country": "Знайти країну",
  "Regions and countries": "Регіони та країни",
  "record loaded": "ряд завантажено",
  "no record yet": "ряду ще немає",
  "No country matches": "Жодна країна не підходить",
};
