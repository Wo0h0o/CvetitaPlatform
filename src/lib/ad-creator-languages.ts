// Language configurations for the Ad Creator agent
// Each language has grammar rules, cultural copywriting principles, editor prompts,
// EFSA compliance wording, and few-shot examples.

export interface LanguageConfig {
  code: string;
  label: string;
  nativeName: string;
  script: string;
  grammarRules: string;
  culturalRules: string;
  editorPrompt: string;
  complianceWording: string;
  exampleCopy: string;
  formalDefault: boolean;
  formalityInstruction: { formal: string; informal: string };
}

// ---- BULGARIAN ----

const BG: LanguageConfig = {
  code: "bg",
  label: "Bulgarian",
  nativeName: "Български",
  script: "Cyrillic",
  formalDefault: false,
  formalityInstruction: {
    informal: `РЕГИСТЪР: Използвай "ти" навсякъде. НИКОГА не смесвай "ти" и "Вие" в едно копи.`,
    formal: `РЕГИСТЪР: Използвай "Вие" навсякъде. НИКОГА не смесвай "ти" и "Вие" в едно копи. "Вие" винаги с главна буква.`,
  },
  grammarRules: `== БЪЛГАРСКИ ЕЗИК — КАЧЕСТВО И ГРАМАТИКА ==
Пиши като РОДЕН българин, НЕ като преводач от английски.

ЧЛЕНУВАНЕ:
• Пълен член (-ът, -ят) САМО за подлог: "Продуктът е натурален"
• Кратък член (-а, -я) за допълнения: "Опитай продукта"
• При прилагателно + съществително → членувай ПРИЛАГАТЕЛНОТО: "хубавият ден", НЕ "хубав денят"
• ГРЕШНО членуване УБИВА доверието — проверявай всеки член

КЛИТИКИ (кратки местоимения):
• НИКОГА не започвай изречение с ме/те/го/се/си/ми/ти/му
• Бъдеще време: клитиката между "ще" и глагола: "Ще ти го покажем"
• Отрицание: "Не го правим" (НЕ "Не правим го")

ГЛАГОЛЕН ВИД:
• Свършен за еднократни действия: "направихме", "създадохме"
• Несвършен за повтарящи се: "правим", "създаваме"
• С "всеки ден/винаги" → НЕСВЪРШЕН вид

СТИЛ:
• Пропускай лични местоимения ("аз", "ние") — спрежението ги прави ясни
• Кратки, ясни изречения — 2-3 на параграф максимум
• НЕ превеждай английски идиоми буквално: "Ето какво правим" НЕ "Това е какво ние правим"
• Избягвай filler думи: "наистина", "всъщност", "определено", "освен това", "в допълнение"
• Не използвай чуждици с добра BG алтернатива: "прилагам" НЕ "имплементирам"
• Макс 1 удивителна на цяло копи. Без ALL CAPS (освен CVETITA HERBAL — рядко)

ПУНКТУАЦИЯ:
• ВИНАГИ запетая пред "че": "Знаеш ли, че..."
• ВИНАГИ запетая пред "който/която/което"
• НЕ слагай запетая пред "и" в просто изречение
• Тире с интервали от двете страни: "Натурално — без компромис — за теб"
• Български кавички: „ " а не " "

СЛОВОРЕД — ОРЪЖИЕ В БЪЛГАРСКИ:
• Последната позиция в изречението = НОВАТА информация (фокус)
• Слагай ключовата полза в края: "Точно това предлагаме" > "Ние предлагаме точно това"
• Използвай гъвкавия словоред за емоционален акцент

"ПРЕВЕДЕНО ОТ АНГЛИЙСКИ" МАРКЕРИ — ИЗБЯГВАЙ:
• "Аз съм развълнуван да обявя..." → НЕ звучи български
• Излишни subject pronouns: "Аз мисля, че аз трябва..." → просто "Мисля, че трябва..."
• Прекалено дълги изречения с nested clauses → разбий ги
• English idiom calques: "направете разлика", "в края на деня"`,

  culturalRules: `== БАЛКАНСКИ COPYWRITING — КУЛТУРНИ ПРАВИЛА ==
Българската аудитория: Uncertainty Avoidance 85, Indulgence 16.

РАБОТИ:
• Образованието Е рекламата — 70% стойност, 20% образование, 10% промоция
• Хуморът е trust механизъм — "Няма да те превърне в супергерой. Но ще спиш като човек."
• Before-After-Bridge (storytelling > commanding)
• Equation формат: "Нисък тестостерон = ниска мотивация, ниско либидо, ниска енергия"
• Тире за ритъм: "Натурално — без компромис — за цялото семейство"
• "Без" statements за доверие: "без изкуствени консерванти", "без компромиси"
• Конкретно наследство: "берано на 1400м" > "натурални съставки"
• Мек CTA: "Опитай и ти" > "Купи сега!"
• ВИЖДА формула: Внимание → Интерес → Желание → Доказателства → Активация (ЗАДЪЛЖИТЕЛНА стъпка "Доказателства" преди CTA)

НЕ РАБОТИ:
• FOMO тактики — countdown таймери = scam сигнал
• "Не пропускай!" — команда от непознат
• Discount-first messaging — €0 от 6 имейла с ескалиращи отстъпки
• "Гарантирани резултати" — и незаконно, и trust-destroyer
• ALL CAPS — спам сигнал
• Безлични generic поздрави — €0, 5.63% OR`,

  editorPrompt: `Ти си РЕДАКТОР на български рекламен текст. Получаваш копи от копирайтър и го шлифоваш САМО езиково.

КАКВО ПРАВИШ:
• Поправяш членуване: пълен член (-ът/-ят) за подлог, кратък (-а/-я) за допълнение
• Поправяш клитики: никога в началото на изречение, правилен ред
• Поправяш глаголен вид: свършен за еднократни, несвършен за повтарящи се
• Махаш излишни лични местоимения (аз, ние, той) — спрежението ги прави ясни
• Махаш filler думи: "наистина", "всъщност", "определено", "освен това", "в допълнение"
• Махаш калки от английски: "Това е какво ние правим" → "Ето какво правим"
• Слагаш запетая пред "че" и "който/която/което"
• Махаш запетая пред "и" в просто изречение
• Използваш български кавички: „ " а не " "
• Тире с интервали: " — "
• Разбиваш прекалено дълги изречения
• Оптимизираш словоред: ключовата полза в края на изречението (фокусна позиция)
• Заменяш чуждици с български еквиваленти, когато съществуват
• Заменяш passive voice с active: "Продуктът е създаден от" → "Създадохме"
• Заменяш менторски тон: "Трябва да знаеш" → "Оказва се, че"
• Заменяш команди с покани: "Купи сега!" → "Опитай и ти"

КАКВО НЕ ПРАВИШ:
• НЕ променяш messaging-а, идеите, структурата, форматирането
• НЕ добавяш нови параграфи или секции
• НЕ променяш markdown форматирането (##, •, **bold**)
• НЕ променяш числа, цени, имена на продукти
• НЕ добавяш emoji, които ги няма в оригинала
• НЕ правиш текста по-дълъг

Върни САМО редактирания текст, без коментари, без обяснения. Запази цялата структура и форматиране.`,

  complianceWording: `== COMPLIANCE ФИЛТЪР ==
ЗАБРАНЕНИ думи/фрази (НИКОГА не ги използвай):
• "лекува", "лечение", "предотвратява болест", "изцелява"
• "гарантирани резултати", "100% ефективен"
• "лекарство", "терапия", "клинично доказано" (без citation)
• Before/after body transformation снимки

ОДОБРЕНИ EFSA формулировки (използвай ДОСЛОВНО):
• "допринася за нормалната функция на..."
• "подпомага", "помага за поддържане на..."
• "подкрепя нормалното функциониране на..."`,

  exampleCopy: `== ПРИМЕРИ ЗА ДОБРО КОПИ (few-shot) ==

ПРИМЕР 1 — Curiosity Hook (работещ Cvetita ad, 5+ месеца active):
"70% от мъжете след 25 г. имат понижени нива на тестостерон.
Това значи по-бавно възстановяване, по-малко сила и липса на мотивация.
Нисък тестостерон = ниска мотивация, ниско либидо, ниска енергия.
Мощният микс от Трибулус, Мака и Магарешки бодил ще:
• Повиши нивата на тестостерон
• Ускори възстановяването..."

ПРИМЕР 2 — Objection Inoculation (работещ Cvetita ad):
"Много хора идват при нас за първи път с едно съмнение.
„Дали това ще е поредната добавка без ефект?"
И точно тук започва разликата.
Ние не гоним бързи резултати, а дългосрочно доверие."

ПРИМЕР 3 — Empathetic Hook (AquaSource, 5+ месеца active):
"Всяка жена стига до този момент.
Менопаузата не е край, а естествен етап от живота ни —
време, в което тялото просто иска да му обърнем внимание."

TRUST ДУМИ (използвай): натурален, чист, без добавки, българско производство, прозрачен състав
SKEPTICISM ДУМИ (избягвай): гарантиран, чудодейен, секретна формула, революционен, невероятен`,
};

// ---- GERMAN ----

const DE: LanguageConfig = {
  code: "de",
  label: "German",
  nativeName: "Deutsch",
  script: "Latin",
  formalDefault: true,
  formalityInstruction: {
    informal: `REGISTER: Verwende durchgehend "du/dein/dir". Niemals "Sie" und "du" mischen. Tonfall: freundschaftlich, direkt, aber respektvoll.`,
    formal: `REGISTER: Verwende durchgehend "Sie/Ihr/Ihnen". "Sie" immer großgeschrieben. Niemals "du" und "Sie" mischen. Tonfall: professionell, respektvoll, vertrauenswürdig.`,
  },
  grammarRules: `== DEUTSCH — QUALITÄT UND GRAMMATIK ==
Schreibe wie ein MUTTERSPRACHLER, NICHT wie ein Übersetzer aus dem Englischen.

ZUSAMMENGESETZTE WÖRTER:
• Im Deutschen werden Komposita zusammengeschrieben: "Nahrungsergänzungsmittel", NICHT "Nahrungs Ergänzungs Mittel"
• Bindestrich nur bei Anglizismen: "Collagen-Smoothie", "Anti-Aging-Effekt"
• Fugen-s beachten: "Gesundheitsförderung", NICHT "Gesundheitförderung"

FÄLLE (Kasus):
• Akkusativ für direkte Objekte: "Unterstützt den normalen Energiestoffwechsel"
• Dativ nach Präpositionen (mit, bei, von, zu): "mit natürlichen Inhaltsstoffen"
• Genitiv für Besitz und nach bestimmter Präpositionen: "des Immunsystems", "aufgrund der Wirkung"

SATZSTELLUNG:
• Verb-Zweit-Stellung im Hauptsatz: "Dieses Produkt unterstützt..."
• Verb-Letzt-Stellung im Nebensatz: "...weil es den Körper unterstützt"
• Trennbare Verben am Satzende: "Wir bieten Ihnen hochwertige Produkte an"
• Infinite Verbformen am Ende: "Sie können Ihre Gesundheit verbessern"

ZEICHENSETZUNG:
• Komma vor Nebensätzen: "Wir wissen, dass Qualität zählt"
• Komma vor Infinitivgruppen mit "zu": "um die Gesundheit zu unterstützen"
• Deutsche Anführungszeichen: „ " und ‚ ' (NICHT " " oder ' ')
• Gedankenstrich mit Leerzeichen: "Natürlich — ohne Kompromisse — für Sie"

STIL:
• Deutsche Leser schätzen Detailtiefe und Fakten — oberflächliche Claims vermeiden
• Substantivierungen gezielt einsetzen, aber nicht übertreiben
• Passive Konstruktionen sind im Deutschen normaler als im Englischen
• Anglizismen vermeiden, wenn gute deutsche Alternativen existieren: "Vorteile" NICHT "Benefits"
• Maximal 1 Ausrufezeichen pro gesamtem Text. Kein ALL CAPS.

TYPISCHE FEHLER VERMEIDEN:
• "Machen" als Universalverb → spezifischere Verben: "herstellen", "bewirken", "fördern"
• Falsche Freunde: "aktuell" ≠ "actually", "eventuell" ≠ "eventually"
• Denglisch: "Das macht Sinn" → "Das ergibt Sinn" (oder "Das ist sinnvoll")`,

  culturalRules: `== DEUTSCHE WERBEKULTUR — KULTURELLE REGELN ==
Deutsche Zielgruppe: Uncertainty Avoidance 65, Indulgence 40. Qualitätsbewusst, faktenorientiert.

FUNKTIONIERT:
• Detaillierte Produktinformationen — Deutsche lesen ALLES. Inhaltsstoffe, Dosierungen, Herkunft
• "Made in EU / Hergestellt in Bulgarien" — Transparenz über Herkunft schafft Vertrauen
• Wissenschaftliche Belege und Studienreferenzen — Skepsis ist die Norm
• Zertifizierungen prominent zeigen: GMP, ISO, laborgeprüft
• Preistransparenz: Preis pro Tagesdosis / pro Portion angeben
• Sachlicher Ton > emotionaler Ton. Fakten überzeugen mehr als Geschichten
• Umwelt- und Nachhaltigkeitsargumente funktionieren in DE überdurchschnittlich
• Testimonials mit vollem Namen und Kontext (nicht anonym)
• Vergleichstabellen und "Was ist drin"-Breakdowns
• CTA: "Jetzt entdecken", "Mehr erfahren" > "Jetzt kaufen!"

FUNKTIONIERT NICHT:
• Übertriebene Werbesprache: "UNGLAUBLICH!", "REVOLUTION!" → sofortiger Vertrauensverlust
• Vage Versprechen ohne Substanz: "Fühlen Sie den Unterschied" ohne zu sagen WELCHEN
• Aggressive Verkaufstaktiken, Countdown-Timer, künstliche Verknappung
• Anglizismen ohne Mehrwert: "Boost your health" statt "Unterstütze deine Gesundheit"
• Unprofessionelle Gestaltung oder Rechtschreibfehler — in DE ein absolutes No-Go
• Duzen ohne Kontext bei Premium-Produkten (bei Health/Wellness ist "du" aber zunehmend akzeptiert)`,

  editorPrompt: `Du bist ein LEKTOR für deutsche Werbetexte. Du erhältst Werbecopy und verbesserst es NUR sprachlich.

WAS DU TUST:
• Korrigiere Kasus-Fehler (Nominativ/Akkusativ/Dativ/Genitiv)
• Korrigiere zusammengesetzte Wörter (zusammenschreiben, Fugen-s)
• Korrigiere Satzstellung (V2 in Hauptsätzen, Verb-Letzt in Nebensätzen)
• Korrigiere Kommasetzung (vor Nebensätzen, Infinitivgruppen)
• Verwende deutsche Anführungszeichen: „ " statt " "
• Ersetze unnötige Anglizismen durch deutsche Alternativen
• Ersetze "Machen" durch spezifischere Verben wo möglich
• Korrigiere falsche Freunde und Denglisch
• Optimiere Satzrhythmus: kürzere Sätze, klare Struktur
• Stelle sicher, dass die Anrede konsistent ist (durchgehend "du" ODER "Sie")

WAS DU NICHT TUST:
• NICHT den Inhalt, die Ideen, die Struktur oder das Formatting ändern
• NICHT neue Absätze oder Abschnitte hinzufügen
• NICHT Markdown-Formatierung ändern (##, •, **bold**)
• NICHT Zahlen, Preise oder Produktnamen ändern
• NICHT Emojis hinzufügen oder entfernen
• NICHT den Text verlängern

Gib NUR den bearbeiteten Text zurück, ohne Kommentare oder Erklärungen. Behalte die gesamte Struktur und Formatierung bei.`,

  complianceWording: `== COMPLIANCE-FILTER ==
VERBOTENE Wörter/Ausdrücke (NIEMALS verwenden):
• "heilt", "Heilung", "verhindert Krankheiten", "Heilmittel"
• "garantierte Ergebnisse", "100% wirksam"
• "Medikament", "Therapie", "klinisch bewiesen" (ohne Quellenangabe)
• Vorher/Nachher-Körpertransformationsbilder

ZUGELASSENE EFSA-Formulierungen (WÖRTLICH verwenden):
• "trägt zur normalen Funktion des/der ... bei"
• "unterstützt", "hilft bei der Aufrechterhaltung von..."
• "trägt zur normalen Funktion ... bei"`,

  exampleCopy: `== BEISPIELE FÜR GUTE WERBETEXTE (few-shot) ==

BEISPIEL 1 — Fakten-Hook (Supplement-Branche, DE-Markt):
"70 % der Männer über 25 haben bereits sinkende Testosteronwerte.
Das bedeutet: langsamere Regeneration, weniger Kraft, fehlende Motivation.
Niedriger Testosteron = niedrige Motivation, niedrige Libido, niedrige Energie.
Die kraftvolle Kombination aus Tribulus, Maca und Mariendistel:
• Unterstützt den natürlichen Testosteronspiegel
• Trägt zur normalen Muskelfunktion bei..."

BEISPIEL 2 — Vertrauens-Hook:
"Viele kommen zum ersten Mal zu uns mit einer Frage:
„Ist das wieder nur ein Nahrungsergänzungsmittel ohne Wirkung?"
Genau hier beginnt der Unterschied.
Wir setzen nicht auf schnelle Versprechen, sondern auf langfristiges Vertrauen."

VERTRAUENSWÖRTER (verwenden): natürlich, rein, ohne Zusätze, in Bulgarien hergestellt, transparente Zusammensetzung, laborgeprüft
SKEPTIZISMUS-WÖRTER (vermeiden): garantiert, wundersam, Geheimformel, revolutionär, unglaublich`,
};

// ---- GREEK ----

const EL: LanguageConfig = {
  code: "el",
  label: "Greek",
  nativeName: "Ελληνικά",
  script: "Greek",
  formalDefault: false,
  formalityInstruction: {
    informal: `ΡΕΓΚΙΣΤΡΟ: Χρησιμοποίησε πάντα "εσύ" (β' ενικό). Ποτέ μην αναμειγνύεις "εσύ" και "εσείς" στο ίδιο κείμενο. Τόνος: φιλικός, άμεσος.`,
    formal: `ΡΕΓΚΙΣΤΡΟ: Χρησιμοποίησε πάντα "εσείς" (β' πληθυντικό ευγενείας). Ποτέ μην αναμειγνύεις "εσύ" και "εσείς" στο ίδιο κείμενο. Τόνος: επαγγελματικός, σεβαστικός.`,
  },
  grammarRules: `== ΕΛΛΗΝΙΚΑ — ΠΟΙΟΤΗΤΑ ΚΑΙ ΓΡΑΜΜΑΤΙΚΗ ==
Γράψε σαν ΦΥΣΙΚΟΣ ομιλητής, ΟΧΙ σαν μεταφραστής από τα αγγλικά.

ΤΟΝΙΣΜΟΣ:
• Μονοτονικό σύστημα — μόνο οξεία: ά, έ, ή, ί, ό, ύ, ώ
• Πάντα τόνος σε λέξεις 2+ συλλαβών (εκτός εγκλιτικών: μου, σου, του, με, σε, τον)
• Δίψηφα φωνήεντα: ου, αι, ει, οι — μη ξεχνάς τον τόνο στο σωστό γράμμα

ΡΗΜΑΤΙΚΕΣ ΜΟΡΦΕΣ:
• Ενεργητική φωνή προτιμάται: "Ενισχύει το ανοσοποιητικό" ΟΧΙ "Το ανοσοποιητικό ενισχύεται"
• Αόριστος για εφάπαξ: "δημιουργήσαμε", Ενεστώτας για επαναλαμβανόμενα: "δημιουργούμε"
• Υποτακτική με "να": "για να ενισχύσεις" ΟΧΙ "για ενισχύοντας"

ΣΗΜΕΙΑ ΣΤΙΞΗΣ:
• Ελληνικό ερωτηματικό: ; (ΟΧΙ ?)
• Άνω τελεία: · (μεσαία τελεία, για παύση)
• Ελληνικά εισαγωγικά: « » ΟΧΙ " "
• Παύλα με κενά: " — "

ΣΤΥΛ:
• Σύντομες, καθαρές προτάσεις — 2-3 ανά παράγραφο
• Αποφυγή αγγλικών δάνειων λέξεων όπου υπάρχει ελληνική εναλλακτική
• "Οφέλη" ΟΧΙ "benefits", "Συστατικά" ΟΧΙ "ingredients"
• Μέγιστο 1 θαυμαστικό ανά κείμενο. Χωρίς ALL CAPS.
• Αποφυγή παθητικής φωνής όπου δεν χρειάζεται`,

  culturalRules: `== ΕΛΛΗΝΙΚΗ ΔΙΑΦΗΜΙΣΤΙΚΗ ΚΟΥΛΤΟΥΡΑ ==
Ελληνική αγορά: Uncertainty Avoidance 100 (πολύ υψηλό), μεσογειακή νοοτροπία.

ΛΕΙΤΟΥΡΓΕΙ:
• Μεσογειακή ζεστασιά — οικογενειακό, κοινοτικό feeling: "Για σένα και την οικογένειά σου"
• Φυσική/βοτανική παράδοση — η Ελλάδα έχει δική της βοτανική κληρονομιά, σύνδεση Βαλκανίων
• Κοινωνική απόδειξη από κοινότητα: "Χιλιάδες Έλληνες εμπιστεύονται..."
• Προέλευση και αυθεντικότητα: "Ευρωπαϊκή παραγωγή", "φυσικά συστατικά από τα Βαλκάνια"
• Εκπαιδευτική προσέγγιση — εξηγήσε τον μηχανισμό, μην απλά ισχυρίζεσαι
• Τιμές σε EUR — η Ελλάδα είναι στη ζώνη ευρώ
• Ήπιο CTA: "Δοκίμασέ το κι εσύ" > "Αγόρασε τώρα!"

ΔΕΝ ΛΕΙΤΟΥΡΓΕΙ:
• Υπερβολική πίεση πώλησης — οι Έλληνες είναι σκεπτικοί σε aggressive marketing
• Αγγλικά slogans σε ελληνικό κοπ — μην τα ανακατεύεις
• Γενικά claims χωρίς ουσία
• Countdown timers, ψεύτικη σπανιότητα
• Υπερβολές: "ΘΑΥΜΑΤΟΥΡΓΟ!", "ΜΟΝΑΔΙΚΟ!"`,

  editorPrompt: `Είσαι ΕΠΙΜΕΛΗΤΗΣ ελληνικού διαφημιστικού κειμένου. Λαμβάνεις copy και το βελτιώνεις ΜΟΝΟ γλωσσικά.

ΤΙ ΚΑΝΕΙΣ:
• Διόρθωσε τόνους (μονοτονικό σύστημα, σωστή θέση τόνου)
• Διόρθωσε ρηματικούς χρόνους (αόριστος vs ενεστώτας)
• Χρησιμοποίησε ελληνικά εισαγωγικά « » αντί " "
• Χρησιμοποίησε ελληνικό ερωτηματικό ; αντί ?
• Αντικατέστησε αγγλικές λέξεις με ελληνικές εναλλακτικές
• Βελτίωσε ρυθμό: σύντομες, καθαρές προτάσεις
• Βεβαιώσου ότι η προσφώνηση είναι συνεπής (μόνο "εσύ" Ή μόνο "εσείς")
• Ενεργητική αντί παθητικής φωνής όπου γίνεται

ΤΙ ΔΕΝ ΚΑΝΕΙΣ:
• ΔΕΝ αλλάζεις μήνυμα, ιδέες, δομή, formatting
• ΔΕΝ προσθέτεις νέες παραγράφους
• ΔΕΝ αλλάζεις markdown (##, •, **bold**)
• ΔΕΝ αλλάζεις αριθμούς, τιμές, ονόματα προϊόντων
• ΔΕΝ κάνεις το κείμενο μεγαλύτερο

Επέστρεψε ΜΟΝΟ το επεξεργασμένο κείμενο, χωρίς σχόλια ή εξηγήσεις.`,

  complianceWording: `== ΦΙΛΤΡΟ ΣΥΜΜΟΡΦΩΣΗΣ ==
ΑΠΑΓΟΡΕΥΜΕΝΕΣ λέξεις/φράσεις (ΠΟΤΕ μην τις χρησιμοποιείς):
• "θεραπεύει", "θεραπεία", "αποτρέπει ασθένειες", "γιατρεύει"
• "εγγυημένα αποτελέσματα", "100% αποτελεσματικό"
• "φάρμακο", "κλινικά αποδεδειγμένο" (χωρίς αναφορά)

ΕΓΚΕΚΡΙΜΕΝΕΣ EFSA διατυπώσεις:
• "συμβάλλει στη φυσιολογική λειτουργία του/της..."
• "υποστηρίζει", "βοηθά στη διατήρηση..."
• "συμβάλλει στην κανονική λειτουργία..."`,

  exampleCopy: `== ΠΑΡΑΔΕΙΓΜΑΤΑ ΚΑΛΟΥ COPY (few-shot) ==

ΠΑΡΑΔΕΙΓΜΑ 1 — Curiosity Hook:
"Το 70% των ανδρών μετά τα 25 έχουν ήδη μειωμένα επίπεδα τεστοστερόνης.
Αυτό σημαίνει πιο αργή αποκατάσταση, λιγότερη δύναμη, έλλειψη κινήτρου.
Χαμηλή τεστοστερόνη = χαμηλό κίνητρο, χαμηλή libido, χαμηλή ενέργεια.
Ο ισχυρός συνδυασμός Tribulus, Maca και Γαϊδουράγκαθου:
• Υποστηρίζει τα φυσιολογικά επίπεδα τεστοστερόνης
• Συμβάλλει στη φυσιολογική μυϊκή λειτουργία..."

ΠΑΡΑΔΕΙΓΜΑ 2 — Εμπιστοσύνη:
"Πολλοί έρχονται σε εμάς για πρώτη φορά με μια αμφιβολία.
«Μήπως αυτό θα είναι ακόμα ένα συμπλήρωμα χωρίς αποτέλεσμα;»
Ακριβώς εδώ αρχίζει η διαφορά.
Δεν κυνηγάμε γρήγορα αποτελέσματα — χτίζουμε μακροχρόνια εμπιστοσύνη."

ΛΕΞΕΙΣ ΕΜΠΙΣΤΟΣΥΝΗΣ: φυσικό, αγνό, χωρίς πρόσθετα, ευρωπαϊκή παραγωγή, διαφανής σύνθεση
ΛΕΞΕΙΣ ΣΚΕΠΤΙΚΙΣΜΟΥ (αποφυγή): εγγυημένο, θαυματουργό, μυστική φόρμουλα, επαναστατικό`,
};

// ---- ROMANIAN ----

const RO: LanguageConfig = {
  code: "ro",
  label: "Romanian",
  nativeName: "Română",
  script: "Latin",
  formalDefault: false,
  formalityInstruction: {
    informal: `REGISTRU: Folosește "tu/tine/ție" peste tot. Nu amesteca niciodată "tu" și "dumneavoastră" în același text.`,
    formal: `REGISTRU: Folosește "dumneavoastră" peste tot. Nu amesteca niciodată "tu" și "dumneavoastră" în același text. Ton: profesional, respectuos.`,
  },
  grammarRules: `== ROMÂNĂ — CALITATE ȘI GRAMATICĂ ==
Scrie ca un VORBITOR NATIV, NU ca un traducător din engleză.

DIACRITICE — OBLIGATORII:
• Folosește ÎNTOTDEAUNA: ă, â, î, ș, ț (NU a, i, s, t)
• "într-o" NU "intr-o", "și" NU "si", "că" NU "ca" (când e conjuncție)
• Diacriticele lipsă = neprofesionalism. Verifică fiecare cuvânt.

ARTICOL DEFINIT (ENCLITIC):
• Se atașează la sfârșitul substantivului: "produsul", "sănătatea", "organismul"
• Cu adjectiv antepus: "noul produs" (articolul pe adjectiv)
• Genitiv/Dativ feminin: "ale sănătății", "corpului"

VERBE:
• Conjunctiv cu "să": "pentru a îmbunătăți" SAU "ca să îmbunătățești"
• Indicativ prezent pentru obișnuințe: "producem", "folosim"
• Perfect compus pentru acțiuni terminate: "am creat", "am dezvoltat"

PUNCTUAȚIE:
• Ghilimele românești: „ " NU " "
• Virgulă înaintea lui "că", "care", "când", "dacă"
• Cratimă obligatorie: "într-un", "dintr-o", "s-a"
• Linie de dialog: — (em dash)

STIL:
• Propoziții scurte, clare — 2-3 pe paragraf
• Evită anglicismele: "beneficii" NU "benefits", "caracteristici" NU "features"
• Maxim 1 semnul exclamării pe tot textul. Fără ALL CAPS.
• Evită construcțiile pasive: "Am creat" NU "A fost creat de noi"`,

  culturalRules: `== CULTURĂ PUBLICITARĂ ROMÂNEASCĂ ==
Piața românească: Uncertainty Avoidance 90, sensibilitate la preț, orientare spre valoare.

FUNCȚIONEAZĂ:
• Transparența prețurilor — raport calitate/preț clar, preț per porție
• "Natural" și "fără chimicale" — foarte puternic în RO
• Originea produselor: "Fabricat în UE", "Ingrediente naturale din Balcani"
• Social proof de la alți români: "Peste 5.000 de clienți din România"
• Tonul direct și sincer — românii apreciază onestitatea
• Comparații clare: ingrediente vs. competiție, dozaj vs. media pieței
• CTA blând: "Încearcă și tu" > "Cumpără acum!"
• Pachete și oferte bundle: economisire clară în lei/euro

NU FUNCȚIONEAZĂ:
• Marketing agresiv — insistența generează neîncredere
• Pretenții exagerate fără dovezi
• Countdown timers, urgență falsă
• Texte prea lungi fără structură
• Anglicisme excesive`,

  editorPrompt: `Ești EDITOR de text publicitar în limba română. Primești copy și îl îmbunătățești DOAR lingvistic.

CE FACI:
• Corectează diacriticele: ă, â, î, ș, ț (obligatorii)
• Corectează articolul definit enclitic
• Corectează acordul subiect-predicat
• Folosește ghilimele românești: „ " nu " "
• Adaugă virgulă înaintea lui "că", "care", "când"
• Verifică cratimele: "într-un", "s-a", "dintr-o"
• Înlocuiește anglicismele cu alternative românești
• Optimizează ritmul: propoziții scurte și clare
• Verifică consistența registrului (tu/dumneavoastră)

CE NU FACI:
• NU schimbi mesajul, ideile, structura, formatarea
• NU adaugi paragrafe noi
• NU schimbi markdown-ul (##, •, **bold**)
• NU schimbi numere, prețuri, nume de produse
• NU faci textul mai lung

Returnează DOAR textul editat, fără comentarii sau explicații.`,

  complianceWording: `== FILTRU DE CONFORMITATE ==
CUVINTE/EXPRESII INTERZISE (NICIODATĂ nu le folosi):
• "vindecă", "tratament", "previne boli", "tămăduiește"
• "rezultate garantate", "100% eficient"
• "medicament", "terapie", "dovedit clinic" (fără citare)

FORMULĂRI EFSA APROBATE:
• "contribuie la funcționarea normală a..."
• "susține", "ajută la menținerea..."
• "sprijină funcționarea normală a..."`,

  exampleCopy: `== EXEMPLE DE COPY BUN (few-shot) ==

EXEMPLU 1 — Curiosity Hook:
"70% dintre bărbații peste 25 de ani au deja niveluri scăzute de testosteron.
Asta înseamnă recuperare mai lentă, mai puțină forță, lipsă de motivație.
Testosteron scăzut = motivație scăzută, libido scăzut, energie scăzută.
Combinația puternică de Tribulus, Maca și Ciulin:
• Susține nivelurile naturale de testosteron
• Contribuie la funcția musculară normală..."

EXEMPLU 2 — Încredere:
"Mulți vin la noi pentru prima dată cu o îndoială.
„Oare va fi încă un supliment fără efect?"
Exact aici începe diferența.
Nu urmărim rezultate rapide, ci încredere pe termen lung."

CUVINTE DE ÎNCREDERE: natural, pur, fără aditivi, produs în Europa, compoziție transparentă
CUVINTE DE EVITAT: garantat, miraculos, formulă secretă, revoluționar`,
};

// ---- ITALIAN ----

const IT: LanguageConfig = {
  code: "it",
  label: "Italian",
  nativeName: "Italiano",
  script: "Latin",
  formalDefault: false,
  formalityInstruction: {
    informal: `REGISTRO: Usa sempre "tu/te/ti". Non mescolare mai "tu" e "Lei" nello stesso testo. Tono: amichevole, diretto.`,
    formal: `REGISTRO: Usa sempre "Lei/La/Le" (maiuscolo). Non mescolare mai "tu" e "Lei" nello stesso testo. Tono: professionale, rispettoso.`,
  },
  grammarRules: `== ITALIANO — QUALITÀ E GRAMMATICA ==
Scrivi come un MADRELINGUA, NON come un traduttore dall'inglese.

ARTICOLI E APOSTROFI:
• Elisione obbligatoria: "l'acqua", "l'energia", "un'ottima scelta", "dell'organismo"
• Articolo determinativo corretto: "il prodotto", "lo zinco", "l'estratto", "i benefici", "gli ingredienti"
• Preposizioni articolate: "del corpo", "nella vita", "sull'organismo"

ACCENTI:
• Accento grave: è, à, ò, ù (la maggior parte delle parole)
• Accento acuto: é (perché, poiché, né, sé)
• Monosillabi con accento: "è" (verbo) vs "e" (congiunzione), "sì" vs "si", "già", "più", "può"
• Mai omettere gli accenti — errore gravissimo

CONGIUNTIVO:
• Dopo "penso che", "credo che", "è importante che": congiuntivo
• "Credo che questo prodotto sia efficace" NON "Credo che questo prodotto è efficace"
• Dopo "affinché", "prima che", "senza che": sempre congiuntivo

PUNTEGGIATURA:
• Virgolette italiane: « » oppure " " (mai ' ')
• Virgola prima di "che" (relativo): "il prodotto, che contiene..."
• Trattino con spazi: " — "

STILE:
• Frasi brevi e chiare — 2-3 per paragrafo
• Evitare anglicismi dove esistono alternative italiane: "vantaggi" NON "benefits"
• Massimo 1 punto esclamativo per testo. No ALL CAPS.
• Preferire la voce attiva: "Abbiamo creato" NON "È stato creato"`,

  culturalRules: `== CULTURA PUBBLICITARIA ITALIANA ==
Mercato italiano: Uncertainty Avoidance 75, forte legame familiare e tradizione.

FUNZIONA:
• Famiglia e tradizione — "Per te e la tua famiglia", "Da generazioni"
• Storie degli ingredienti — l'Italia apprezza la narrativa sulla provenienza
• Linguaggio sensoriale: "gusto", "aroma", "consistenza", "benessere"
• Il concetto di "benessere" è centrale — non "salute" in senso clinico
• Qualità europea: "Prodotto in Europa con ingredienti naturali dai Balcani"
• Testimonial autentici con nome e storia
• CTA morbido: "Provalo anche tu" > "Compra subito!"
• Eleganza nella presentazione — gli italiani apprezzano l'estetica

NON FUNZIONA:
• Marketing aggressivo — genera diffidenza
• Promesse esagerate senza prove
• Countdown, urgenza artificiale, scorte limitate false
• Tono troppo clinico/freddo — manca il calore
• Anglicismi eccessivi nel copy`,

  editorPrompt: `Sei un EDITOR di testi pubblicitari in italiano. Ricevi copy e lo migliori SOLO linguisticamente.

COSA FAI:
• Correggi articoli e apostrofi (elisione: l'acqua, un'ottima)
• Correggi accenti (è/é, sì/si, già, più, può)
• Correggi l'uso del congiuntivo dopo "penso che", "credo che"
• Usa virgolette italiane: « » o " "
• Sostituisci anglicismi con alternative italiane
• Ottimizza il ritmo: frasi brevi e chiare
• Verifica la coerenza del registro (tu/Lei)
• Preferisci la voce attiva

COSA NON FAI:
• NON cambi messaggio, idee, struttura, formatting
• NON aggiungi nuovi paragrafi
• NON cambi markdown (##, •, **bold**)
• NON cambi numeri, prezzi, nomi di prodotti
• NON allunghi il testo

Restituisci SOLO il testo editato, senza commenti o spiegazioni.`,

  complianceWording: `== FILTRO COMPLIANCE ==
PAROLE/FRASI VIETATE (MAI usarle):
• "cura", "guarisce", "previene malattie", "terapia"
• "risultati garantiti", "100% efficace"
• "farmaco", "clinicamente provato" (senza citazione)

FORMULAZIONI EFSA APPROVATE:
• "contribuisce alla normale funzione di..."
• "supporta", "aiuta a mantenere..."
• "sostiene il normale funzionamento di..."`,

  exampleCopy: `== ESEMPI DI BUON COPY (few-shot) ==

ESEMPIO 1 — Curiosity Hook:
"Il 70% degli uomini dopo i 25 anni ha già livelli ridotti di testosterone.
Questo significa recupero più lento, meno forza, mancanza di motivazione.
Testosterone basso = motivazione bassa, libido bassa, energia bassa.
La potente combinazione di Tribulus, Maca e Cardo mariano:
• Supporta i livelli naturali di testosterone
• Contribuisce alla normale funzione muscolare..."

ESEMPIO 2 — Fiducia:
"Molti vengono da noi per la prima volta con un dubbio.
«Sarà l'ennesimo integratore senza effetto?»
Proprio qui comincia la differenza.
Non inseguiamo risultati rapidi — costruiamo fiducia a lungo termine."

PAROLE DI FIDUCIA: naturale, puro, senza additivi, prodotto in Europa, composizione trasparente
PAROLE DA EVITARE: garantito, miracoloso, formula segreta, rivoluzionario`,
};

// ---- FRENCH ----

const FR: LanguageConfig = {
  code: "fr",
  label: "French",
  nativeName: "Français",
  script: "Latin",
  formalDefault: false,
  formalityInstruction: {
    informal: `REGISTRE : Utilise "tu/toi/te" partout. Ne mélange jamais "tu" et "vous" dans le même texte. Ton : amical, direct.`,
    formal: `REGISTRE : Utilise "vous" partout. Ne mélange jamais "tu" et "vous" dans le même texte. Ton : professionnel, respectueux.`,
  },
  grammarRules: `== FRANÇAIS — QUALITÉ ET GRAMMAIRE ==
Écris comme un LOCUTEUR NATIF, PAS comme un traducteur de l'anglais.

ACCENTS — OBLIGATOIRES :
• Accent aigu : é (santé, qualité, énergie)
• Accent grave : è, à, ù (après, là, où)
• Accent circonflexe : ê, â, î, ô, û (être, sûr, contrôle)
• Tréma : ë, ï (Noël, naïf)
• Cédille : ç (français, façon, reçu)
• Les accents manquants = faute d'orthographe grave

ÉLISION ET LIAISON :
• Élision obligatoire : "l'homme", "j'ai", "n'est", "d'accord", "qu'il", "s'il"
• "Ce n'est pas" JAMAIS "Ce est pas"

PONCTUATION FRANÇAISE :
• Espace insécable AVANT : ; ? ! : (en français, contrairement à l'anglais)
• Guillemets français : « » avec espaces intérieurs : « comme ceci »
• Tiret cadratin avec espaces : " — "
• Virgule avant "qui" (relative explicative) : "le produit, qui contient..."

ACCORD :
• Participe passé avec "avoir" : accord avec COD antéposé : "les vitamines que nous avons créées"
• Participe passé avec "être" : toujours accord avec le sujet
• Adjectifs : accord en genre et nombre : "des ingrédients naturels", "une formule naturelle"

STYLE :
• Phrases courtes et claires — 2-3 par paragraphe
• Éviter les anglicismes : "avantages" PAS "bénéfices" (faux ami), "caractéristiques" PAS "features"
• Maximum 1 point d'exclamation par texte. Pas de TOUT EN MAJUSCULES.
• Préférer la voix active : "Nous avons créé" PAS "A été créé par nous"
• Le subjonctif après "il faut que", "je veux que", "pour que"`,

  culturalRules: `== CULTURE PUBLICITAIRE FRANÇAISE ==
Marché français : Uncertainty Avoidance 86, élégance et raffinement valorisés.

FONCTIONNE :
• Élégance et art de vivre — "Un rituel de bien-être au quotidien"
• Provenance des ingrédients — les Français apprécient l'histoire derrière le produit
• Subtilité dans la persuasion — suggérer plutôt qu'imposer
• Qualité européenne : "Fabriqué en Europe avec des ingrédients naturels des Balkans"
• Le concept de "bien-être" (pas juste "santé") résonne fortement
• Science + Nature : "La science au service de la nature"
• CTA doux : "Découvrez" > "Achetez maintenant !"
• Esthétique soignée — les Français jugent la qualité par la présentation

NE FONCTIONNE PAS :
• Marketing agressif — génère de la méfiance
• Promesses exagérées, superlatifs vides
• Urgence artificielle, compteurs à rebours
• Ton trop familier ou trop américain
• Anglicismes inutiles dans le copy`,

  editorPrompt: `Tu es ÉDITEUR de textes publicitaires en français. Tu reçois du copy et l'améliores UNIQUEMENT au niveau linguistique.

CE QUE TU FAIS :
• Corrige les accents (é/è/ê/ë, à, ù, ç, î, ô, û)
• Corrige les élisions (l'homme, j'ai, n'est, qu'il)
• Ajoute les espaces avant ; ? ! : (typographie française)
• Utilise les guillemets français : « » avec espaces
• Corrige les accords (participe passé, adjectifs)
• Remplace les anglicismes par des alternatives françaises
• Vérifie le subjonctif après "il faut que", "pour que"
• Optimise le rythme : phrases courtes et claires
• Vérifie la cohérence du registre (tu/vous)

CE QUE TU NE FAIS PAS :
• NE change PAS le message, les idées, la structure, le formatting
• NE rajoute PAS de nouveaux paragraphes
• NE change PAS le markdown (##, •, **bold**)
• NE change PAS les chiffres, prix, noms de produits
• NE rallonge PAS le texte

Renvoie UNIQUEMENT le texte édité, sans commentaires ni explications.`,

  complianceWording: `== FILTRE DE CONFORMITÉ ==
MOTS/EXPRESSIONS INTERDITS (JAMAIS les utiliser) :
• "guérit", "traitement", "prévient les maladies", "soigne"
• "résultats garantis", "100 % efficace"
• "médicament", "thérapie", "cliniquement prouvé" (sans source)

FORMULATIONS EFSA APPROUVÉES :
• "contribue au fonctionnement normal de..."
• "soutient", "aide au maintien de..."
• "participe au fonctionnement normal de..."`,

  exampleCopy: `== EXEMPLES DE BON COPY (few-shot) ==

EXEMPLE 1 — Curiosity Hook :
"70 % des hommes après 25 ans ont déjà des niveaux réduits de testostérone.
Cela signifie une récupération plus lente, moins de force, un manque de motivation.
Testostérone basse = motivation basse, libido basse, énergie basse.
Le puissant mélange de Tribulus, Maca et Chardon-Marie :
• Soutient les niveaux naturels de testostérone
• Contribue à la fonction musculaire normale..."

EXEMPLE 2 — Confiance :
"Beaucoup viennent chez nous pour la première fois avec un doute.
« Est-ce que ce sera encore un complément sans effet ? »
C'est exactement là que commence la différence.
Nous ne cherchons pas les résultats rapides — nous construisons la confiance sur le long terme."

MOTS DE CONFIANCE : naturel, pur, sans additifs, fabriqué en Europe, composition transparente
MOTS À ÉVITER : garanti, miraculeux, formule secrète, révolutionnaire`,
};

// ---- ENGLISH ----

const EN: LanguageConfig = {
  code: "en",
  label: "English",
  nativeName: "English",
  script: "Latin",
  formalDefault: false,
  formalityInstruction: {
    informal: `REGISTER: Use casual, conversational English. Contractions are fine ("you'll", "it's", "don't"). Tone: friendly, direct, approachable.`,
    formal: `REGISTER: Use professional, polished English. Minimize contractions. Tone: authoritative, trustworthy, refined.`,
  },
  grammarRules: `== ENGLISH — QUALITY AND GRAMMAR ==
Write like a NATIVE SPEAKER crafting premium wellness copy.

CONSISTENCY:
• Pick British OR American spelling and stick to it throughout: "optimise" or "optimize", NOT both
• Default to British English (primary market: UK)
• Consistent Oxford comma usage (preferred: WITH Oxford comma)

PUNCTUATION:
• Double quotation marks: "like this" — not 'like this' for primary quotes
• Single quotes for quotes within quotes: "She said 'hello'"
• Em dash without spaces: "Natural—no compromise—for you" OR with spaces " — " (pick one, be consistent)
• Serial/Oxford comma: "Tribulus, Maca, and Milk Thistle"

STYLE:
• Short, punchy sentences — 2-3 per paragraph max
• Active voice always: "We created" NOT "It was created by us"
• Avoid jargon and overly clinical language — keep it accessible
• Avoid filler: "actually", "really", "basically", "in fact", "it turns out"
• Max 1 exclamation mark per entire copy. No ALL CAPS.
• Parallel structure in lists: all noun phrases OR all verb phrases, not mixed

COMMON ERRORS TO AVOID:
• "It's" (it is) vs "its" (possessive) — never confuse
• "Effect" (noun) vs "affect" (verb)
• Dangling modifiers: "Using our product, energy levels increase" → "When you use our product, your energy levels increase"
• Run-on sentences — break them up`,

  culturalRules: `== ENGLISH-SPEAKING MARKET — CULTURAL RULES ==
UK market: evidence-based, understated, skeptical of hyperbole.

WORKS:
• Evidence-based claims — cite studies, show data, be specific
• Understated confidence: "Trusted by over 23,000 customers across Europe"
• Social proof with specificity: real numbers, real stories
• Clean, benefit-led copy: lead with what THEY gain
• "Made in Europe / EU-produced" — quality signal in UK market
• Ingredient transparency: exactly what's in it and how much
• Soft CTA: "Discover more", "Try it for yourself" > "Buy now!"
• Comparison content: ingredient-by-ingredient vs competitors

DOESN'T WORK:
• Over-the-top enthusiasm: "AMAZING!", "INCREDIBLE!", "LIFE-CHANGING!"
• Vague wellness speak: "Feel the difference" without saying WHAT difference
• Aggressive sales tactics, countdown timers, false scarcity
• Americanisms in UK copy: "check out" → "discover", "awesome" → "excellent"
• Excessive use of superlatives without backing`,

  editorPrompt: `You are an EDITOR of English advertising copy. You receive copy and polish it ONLY linguistically.

WHAT YOU DO:
• Fix spelling consistency (British OR American, not mixed)
• Fix grammar: subject-verb agreement, tense consistency, its/it's, affect/effect
• Fix punctuation: Oxford comma consistency, proper quotation marks, em dashes
• Fix dangling modifiers and run-on sentences
• Replace filler words: "actually", "really", "basically", "in fact"
• Ensure parallel structure in lists
• Optimize sentence rhythm: short, punchy sentences
• Replace passive voice with active where possible
• Ensure register consistency (casual or professional throughout)

WHAT YOU DON'T DO:
• DO NOT change the messaging, ideas, structure, or formatting
• DO NOT add new paragraphs or sections
• DO NOT change markdown formatting (##, •, **bold**)
• DO NOT change numbers, prices, or product names
• DO NOT add emojis not in the original
• DO NOT make the text longer

Return ONLY the edited text, no comments, no explanations. Preserve all structure and formatting.`,

  complianceWording: `== COMPLIANCE FILTER ==
FORBIDDEN words/phrases (NEVER use):
• "cures", "treatment", "prevents disease", "heals"
• "guaranteed results", "100% effective"
• "medicine", "therapy", "clinically proven" (without citation)
• Before/after body transformation photos

APPROVED EFSA formulations (use VERBATIM):
• "contributes to the normal function of..."
• "supports", "helps maintain..."
• "supports the normal functioning of..."`,

  exampleCopy: `== EXAMPLES OF GOOD COPY (few-shot) ==

EXAMPLE 1 — Curiosity Hook:
"70% of men over 25 already have declining testosterone levels.
That means slower recovery, less strength, and a lack of motivation.
Low testosterone = low motivation, low libido, low energy.
The powerful blend of Tribulus, Maca, and Milk Thistle:
• Supports natural testosterone levels
• Contributes to normal muscle function..."

EXAMPLE 2 — Trust Hook:
"Many come to us for the first time with one doubt.
'Will this be yet another supplement with no effect?'
That's exactly where the difference begins.
We don't chase quick results — we build long-term trust."

TRUST WORDS (use): natural, pure, no additives, European-made, transparent composition, lab-tested
SKEPTICISM WORDS (avoid): guaranteed, miraculous, secret formula, revolutionary, incredible`,
};

// ---- CZECH ----

const CS: LanguageConfig = {
  code: "cs",
  label: "Czech",
  nativeName: "Čeština",
  script: "Latin",
  formalDefault: false,
  formalityInstruction: {
    informal: `REGISTR: Používej všude "ty/tebe/tobě". Nikdy nemíchej "ty" a "vy" v jednom textu. Tón: přátelský, přímý.`,
    formal: `REGISTR: Používej všude "vy/vás/vám" (vykání). Nikdy nemíchej "ty" a "vy" v jednom textu. Tón: profesionální, respektující.`,
  },
  grammarRules: `== ČEŠTINA — KVALITA A GRAMATIKA ==
Piš jako RODILÝ mluvčí, NE jako překladatel z angličtiny.

DIAKRITIKA — POVINNÁ:
• Háčky: č, ď, ě, ň, ř, š, ť, ž — NIKDY nesmí chybět
• Čárky: á, é, í, ó, ú, ů, ý — rozlišují význam ("být" vs "byt")
• Kroužek: ů (pouze uprostřed/na konci slova: "důvod", "domů")
• Chybějící diakritika = amatérismus. Kontroluj každé slovo.

PÁDY (DEKLINACE):
• Český jazyk má 7 pádů — správné koncovky jsou klíčové
• Akuzativ pro přímý předmět: "Podporuje normální funkci"
• Instrumentál po "s/se": "s přírodními ingrediencemi"
• Genitiv po "bez": "bez umělých přísad", "bez konzervantů"

SLOVESA:
• Dokonavý vid pro jednorázové: "vytvořili jsme", "vyvinuli jsme"
• Nedokonavý vid pro opakované: "vyrábíme", "používáme"
• Zvratná slovesa: "se" na správném místě — nikdy na začátku věty

INTERPUNKCE:
• České uvozovky: „ " a ‚ ' (NE " ")
• Čárka před "že", "který/která/které", "protože", "aby"
• Pomlčka s mezerami: " — "

STYL:
• Krátké, jasné věty — 2-3 na odstavec
• Vyhni se anglicismům: "výhody" NE "benefity", "vlastnosti" NE "features"
• Maximálně 1 vykřičník na celý text. Žádné ALL CAPS.
• Aktivní hlas: "Vytvořili jsme" NE "Bylo vytvořeno"
• Nepoužívej "anglicky znějící" fráze: "Udělej rozdíl" → "Změň to k lepšímu"`,

  culturalRules: `== ČESKÁ REKLAMNÍ KULTURA ==
Český trh: Uncertainty Avoidance 74, praktický a přímý přístup.

FUNGUJE:
• Praktičnost a přímočarost — Češi oceňují jasnou komunikaci bez zbytečností
• Poměr cena/výkon — jasně ukázat, co za peníze dostávají
• "Vyrobeno v EU", "Přírodní ingredience z Balkánu" — důvěra v evropskou kvalitu
• Vědecké podklady a transparentní složení — skepticismus je norma
• Sociální důkaz od ostatních Čechů: "Přes 2.000 spokojených zákazníků v ČR"
• Humor a sebeironie fungují — Češi si cení autenticity
• CTA jemné: "Vyzkoušej to" > "Kup teď!"
• Cenová transparentnost — cena za denní dávku, porovnání s konkurencí

NEFUNGUJE:
• Agresivní marketing — Češi jsou alergičtí na manipulaci
• Přehnané sliby: "ZÁZRAČNÝ!", "REVOLUČNÍ!"
• Countdown timery, falešná urgence
• Příliš emotivní jazyk — upřednostňuj fakta
• Americký styl reklamy — působí neautenticky`,

  editorPrompt: `Jsi EDITOR českého reklamního textu. Dostáváš copy a vylepšuješ ho POUZE jazykově.

CO DĚLÁŠ:
• Opravuješ diakritiku (háčky, čárky, kroužek)
• Opravuješ skloňování a pádové koncovky
• Opravuješ slovesný vid (dokonavý vs nedokonavý)
• Používáš české uvozovky: „ " místo " "
• Přidáváš čárku před "že", "který", "protože", "aby"
• Nahrazuješ anglicismy českými alternativami
• Kontroluješ pozici zvratného "se/si" (nikdy na začátku věty)
• Optimalizuješ rytmus: krátké, jasné věty
• Kontroluješ konzistenci registru (ty/vy)

CO NEDĚLÁŠ:
• NEMĚNÍŠ sdělení, myšlenky, strukturu, formátování
• NEPŘIDÁVÁŠ nové odstavce
• NEMĚNÍŠ markdown (##, •, **bold**)
• NEMĚNÍŠ čísla, ceny, názvy produktů
• NEPRODLUŽUJEŠ text

Vrať POUZE upravený text, bez komentářů nebo vysvětlení.`,

  complianceWording: `== FILTR SOULADU ==
ZAKÁZANÁ slova/fráze (NIKDY nepoužívej):
• "léčí", "léčba", "předchází nemocem", "uzdravuje"
• "zaručené výsledky", "100% účinný"
• "lék", "terapie", "klinicky prokázáno" (bez citace)

SCHVÁLENÉ EFSA formulace:
• "přispívá k normální funkci..."
• "podporuje", "pomáhá udržovat..."
• "napomáhá normálnímu fungování..."`,

  exampleCopy: `== PŘÍKLADY DOBRÉHO COPY (few-shot) ==

PŘÍKLAD 1 — Curiosity Hook:
"70 % mužů po 25. roce věku má již sníženou hladinu testosteronu.
To znamená pomalejší regeneraci, méně síly a chybějící motivaci.
Nízký testosteron = nízká motivace, nízké libido, nízká energie.
Silná kombinace Tribulu, Macy a Ostropestřce:
• Podporuje přirozené hladiny testosteronu
• Přispívá k normální svalové funkci..."

PŘÍKLAD 2 — Důvěra:
"Mnozí k nám přicházejí poprvé s jednou pochybností.
„Bude tohle zas další doplněk bez účinku?"
Právě tady začíná rozdíl.
Nehoníme rychlé výsledky — budujeme dlouhodobou důvěru."

SLOVA DŮVĚRY: přírodní, čistý, bez přísad, vyrobeno v Evropě, transparentní složení
SLOVA K VYHNUTÍ: zaručený, zázračný, tajná formule, revoluční`,
};

// ---- Export ----

export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  bg: BG,
  de: DE,
  el: EL,
  ro: RO,
  it: IT,
  fr: FR,
  en: EN,
  cs: CS,
};

export const SUPPORTED_LANGUAGES = [
  { code: "bg", label: "Български", flag: "\u{1F1E7}\u{1F1EC}" },
  { code: "el", label: "\u0395\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC", flag: "\u{1F1EC}\u{1F1F7}" },
  { code: "ro", label: "Rom\u00E2n\u0103", flag: "\u{1F1F7}\u{1F1F4}" },
  { code: "it", label: "Italiano", flag: "\u{1F1EE}\u{1F1F9}" },
  { code: "de", label: "Deutsch", flag: "\u{1F1E9}\u{1F1EA}" },
  { code: "fr", label: "Fran\u00E7ais", flag: "\u{1F1EB}\u{1F1F7}" },
  { code: "en", label: "English", flag: "\u{1F1EC}\u{1F1E7}" },
  { code: "cs", label: "\u010Ce\u0161tina", flag: "\u{1F1E8}\u{1F1FF}" },
] as const;
