// From folder names only ("anniv papa", "TyoulJerusalem2015", "mariageAvishai", "יום הולדת נעמי 13"),
// the categories to propose: each album goes to the first category whose words it has (French, English,
// Hebrew and Hebrew written in Latin letters). A name met in several folders (Asher, Efrat…) is a person:
// a folder with such a name and no other clue goes to "Children". Pure, tested.

export const CATEGORY_KEYS = ['weddings', 'barMitzvah', 'birthdays', 'snow', 'trips', 'holidays', 'school', 'family', 'kids', 'other'] as const
export type CategoryKey = (typeof CATEGORY_KEYS)[number]

/** Hebrew has no \b in JS regexes: a word alone, between spaces or at the ends. */
const he = (words: string) => `(?:^|\\s)(?:${words})(?=\\s|$)`

/** In order: the first that matches wins ("anniversaire efrat bar mitsva" → bar mitzvah). */
const RULES: [CategoryKey, RegExp][] = [
  ['weddings', new RegExp(`mariage|wedding|\\bh[ao]t[ou]{1,2}na|\\bhou?p+a\\b|chuppa|fian[cç]ailles|\\b[ei]rou?sin|cheva brah?ot|sheva brachot|kise kala|חתונ|אירוס|${he('חופה|שבע ברכות')}`)],
  ['barMitzvah', new RegExp(`\\bba[rt] ?mi[tsz]{1,3}[vw]a|\\btefil+in|\\bt[eé]fil+ine|בר[ -]?מצו|בת[ -]?מצו|תפילין`)],
  ['birthdays', new RegExp(`anniv|birthday|\\bb ?day|\\by[oa]m h?a?o?u?ledet|\\bh?ouledet|יום הולדת|יומולדת`)],
  ['snow', new RegExp(`neige|\\bsnow|\\bch?eleg|\\bsheleg|שלג`)],
  [
    'trips',
    new RegExp(
      `\\bt[iy]{1,2}o?u?l|voyage|vacances|\\btrip|travel|safari|\\bparis|london|londres|\\bfrance|\\bgolan|\\bgalil|hermon|eilat|ein ?gu?edi|jerusalem|yerou?chala|tiberiade|tveria|mit[sz]pe|\\bramon|\\bkotel|mass?ada|mer morte|dead sea|negev|camping|\\bplage|beach|\\bparc\\b|\\bpark|\\bzoo\\b|\\bmangal|\\bavion|טיול|נסיעה|חופשה|ירושלים|גולן|גליל|אילת|כנרת`,
    ),
  ],
  [
    'holidays',
    new RegExp(
      `\\bpou?rim|\\bh?anou?[ck]|\\bchanu?k|\\bpess?ah|\\bpesach|sou?c+ot|sukkot|ro[cs]h hach?ana|seli[ch]h?ot|selih|kip+our|kip+ur|ch?avou?ot|shavuot|lag ba?omer|\\bseder|פורים|חנוכה|פסח|סוכות|ראש השנה|סליחות|שבועות|ל"ג בעומר`,
    ),
  ],
  [
    'school',
    new RegExp(
      `\\bgan\\b|\\bkita|\\bclasse?\\b|[eé]cole|school|ye[sc]h?iva|midra[cs]h|\\bou?lpan|\\bsiou?m|\\bsiyum|\\bsi?dou?r\\b|sidour|kindergarten|${he('גן')}|כיתה|כתה|ישיבה|אולפנ|מדרשה|סיום|בית ספר`,
    ),
  ],
  ['family', new RegExp(`famil|\\bmamie?\\b|\\bpapie?\\b|grand[- ]?(?:p[eè]re|m[eè]re|parents?)|\\bsa?ba\\b|\\bsavta|cousin|משפחה|סבא|סבתא|${he('סבים|נכדים')}`)],
]

/** Words of folder names that are no person ("photos", "copy of"…). */
const NOT_A_NAME = new Set(
  'photos photo pictures picture images image video videos jpg jpeg bmp png my mes the and of de des du la le les et et copy of new nouveau dossier folder backup scanned digital camera outgoing attachments adobe instrumental misc temp sony canon nikon vivicam תמונות תמונה של עם סרטונים'.split(' '),
)

/** "TyoulJerusalem2015" → "tyoul jerusalem 2015": lower case, words apart, accents kept (é counts as e in the rules). */
export function wordsOf(name: string): string {
  return name
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/[_\-.,;:()[\]{}+]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** The category whose words the name has, or null. */
export function categoryOfName(name: string): CategoryKey | null {
  const w = wordsOf(name)
  const plain = w.normalize('NFD').replace(/[̀-ͯ]/g, '')
  for (const [key, re] of RULES) if (re.test(w) || re.test(plain)) return key
  return null
}

/** Words that look like first names: letters only, in at least 3 folder names, no category word. */
function personNames(names: string[]): Set<string> {
  const seen = new Map<string, number>()
  for (const n of names) {
    for (const word of new Set(wordsOf(n).split(' '))) {
      if (word.length < 3 || !/^\p{L}+$/u.test(word) || NOT_A_NAME.has(word) || categoryOfName(word)) continue
      seen.set(word, (seen.get(word) ?? 0) + 1)
    }
  }
  return new Set([...seen].filter(([, k]) => k >= 3).map(([w]) => w))
}

/** Each name with its proposed category ("other" when nothing is recognised). */
export function proposeCategories(names: string[]): Map<string, CategoryKey> {
  const people = personNames(names)
  const out = new Map<string, CategoryKey>()
  for (const n of names) {
    const key = categoryOfName(n) ?? (wordsOf(n).split(' ').some((w) => people.has(w)) ? 'kids' : 'other')
    out.set(n, key)
  }
  return out
}
