// In-app help, in the three languages. Plain data: sections with paragraphs or bullet lists.

import type { Language } from '../store'

export interface HelpSection {
  title: string
  intro?: string
  items?: string[]
}

export interface HelpContent {
  title: string
  tagline: string
  sections: HelpSection[]
}

const fr: HelpContent = {
  title: 'Aide',
  tagline: 'MyMedia range, reconnaît et allège vos photos et vidéos directement dans votre Google Drive — sans les envoyer ailleurs.',
  sections: [
    {
      title: 'Ce qui rend MyMedia différent',
      items: [
        'Vos photos restent chez vous. Elles restent de simples fichiers dans des dossiers de votre Google Drive. Pas de format propriétaire : si vous arrêtez MyMedia demain, tout reste rangé et lisible.',
        'Aucun serveur MyMedia. L’application parle directement à votre Drive. Pas de compte à créer, pas d’abonnement, pas de publicité.',
        'L’intelligence sur votre appareil. La reconnaissance des visages et l’apprentissage de vos albums se font sur votre téléphone ou votre ordinateur. Les visages ne sont jamais envoyés à un service.',
        'Elle apprend VOTRE classement. MyMedia étudie vos propres albums (par exemple une espèce d’oiseau par album) et range les nouvelles photos de la même façon. Il vous montre son degré de certitude et ne décide seul que s’il est sûr.',
        'Elle libère de la place, sous votre contrôle. Elle vous propose une liste des gros fichiers avec la taille avant → après. Vous choisissez. Date, appareil photo et position GPS sont conservés.',
        'La vraie date de chaque photo. Elle la lit dans la photo, la vidéo ou le nom du fichier, même quand une copie dans Drive l’avait perdue.',
        'Une seule application pour tous vos appareils : téléphone Android, iPhone, ordinateur. Elle est pensée en hébreu (de droite à gauche), en français et en anglais.',
      ],
    },
    {
      title: 'Démarrer',
      items: [
        'Charger les nouveaux fichiers : lit ce qui a changé dans votre dossier MyMedia sur Drive. En mode automatique, il le fait aussi seul toutes les 15 minutes.',
        'Ajouter : envoie des photos et vidéos depuis votre appareil, une clé USB ou une carte SD. Les fichiers gardent leur vraie date et sont compressés avant l’envoi. Les doublons sont repérés.',
        'Menu de gauche : vos catégories et albums sont les dossiers de votre Drive. Les dossiers créés directement dans Drive apparaissent aussi.',
        'Sur Android, dans la Galerie ou WhatsApp : Partager → MyMedia.',
      ],
    },
    {
      title: 'Classer automatiquement',
      items: [
        '« À classer » : photos posées en vrac. MyMedia propose l’album le plus probable avec un pourcentage ; un toucher suffit pour accepter.',
        '« Classés automatiquement » : ce que MyMedia a rangé seul (85 % ou plus). Vérifiez et corrigez si besoin ; chaque correction lui apprend.',
        'Un fichier nommé comme un album (par exemple « נחליאלי לבן.jpg ») va directement dans cet album.',
      ],
    },
    {
      title: 'Personnes',
      items: [
        'Personnes → Visages à nommer : chaque rond est un groupe de visages de la même personne. Donnez-lui un nom ; toutes ses photos, et les nouvelles, le reçoivent.',
        '« Est-ce Noa ? » : MyMedia demande quand il n’est pas sûr. Oui ou Non.',
        'Une photo avec plusieurs personnes apparaît chez chacune, sans copie.',
        'Dans la fenêtre d’une personne, cochez seulement les visages erronés pour les corriger. Pour les bébés et les jeunes enfants, plus vous confirmez, mieux c’est reconnu.',
      ],
    },
    {
      title: 'Compresser',
      items: [
        'Après un chargement, MyMedia propose la liste des nouveaux gros fichiers avec la taille avant → après. Vous cochez ceux à compresser.',
        'Bouton Compresser : sur un album, une catégorie ou une sélection.',
        'L’original reste récupérable environ 30 jours dans l’historique des versions de Drive (ou dans le dossier _Originals, selon vos paramètres).',
      ],
    },
    {
      title: 'Retrouver',
      items: [
        'Recherche : nom, description, album, espèce, personne. Les accents et les points-voyelles sont ignorés.',
        'Filtres : album, origine (appareil photo, WhatsApp, web…), classement, compression, personne.',
        'Sélectionner (ou appui long sur une photo) : déplacer, créer un album, décrire, ajouter une personne, compresser, supprimer plusieurs fichiers d’un coup.',
      ],
    },
    {
      title: 'Questions fréquentes',
      items: [
        'Mes photos sont-elles envoyées quelque part ? Non. Seulement entre votre appareil et votre propre Google Drive.',
        'Où sont mes noms, descriptions, visages ? Dans votre Drive, dossier MyMedia : mymedia.json, mymedia-faces.json, mymedia-index.*. Vos autres appareils les retrouvent.',
        'Supprimer est-il définitif ? Non. Les fichiers vont dans la corbeille de Google Drive, récupérables 30 jours.',
        'Bandeau « Se reconnecter » : la connexion Google doit être renouvelée (surtout sur iPhone). Votre travail est conservé.',
        'iPhone : le menu Partager n’est pas disponible pour MyMedia. Utilisez le bouton Ajouter.',
      ],
    },
  ],
}

const en: HelpContent = {
  title: 'Help',
  tagline: 'MyMedia organises, recognises and slims down your photos and videos right in your Google Drive — without sending them anywhere else.',
  sections: [
    {
      title: 'What makes MyMedia different',
      items: [
        'Your photos stay yours. They remain plain files in folders of your Google Drive. No proprietary format: if you stop using MyMedia tomorrow, everything stays organised and readable.',
        'No MyMedia server. The app talks directly to your Drive. No account to create, no subscription, no ads.',
        'Intelligence on your device. Face recognition and learning your albums run on your phone or computer. Faces are never sent to any service.',
        'It learns YOUR way of organising. MyMedia studies your own albums (for example one bird species per album) and files new photos the same way. It shows how sure it is, and only decides alone when it is confident.',
        'It frees space, under your control. You get a list of big files with size before → after, and you choose. Date, camera and GPS position are kept.',
        'The real date of every photo. It is read from the photo, the video or the file name, even when a copy into Drive had lost it.',
        'One app for all your devices: Android phone, iPhone, computer. It is designed for Hebrew (right-to-left), French and English.',
      ],
    },
    {
      title: 'Getting started',
      items: [
        'Load new files: reads what changed in your MyMedia folder on Drive. In automatic mode it also does this on its own every 15 minutes.',
        'Add: upload photos and videos from this device, a USB stick or an SD card. Files keep their real date, are compressed before upload, and duplicates are spotted.',
        'Left menu: your categories and albums are the folders of your Drive. Folders created directly in Drive appear too.',
        'On Android, in Gallery or WhatsApp: Share → MyMedia.',
      ],
    },
    {
      title: 'Automatic classification',
      items: [
        '"To classify": loose photos. MyMedia suggests the most likely album with a percentage; one tap accepts it.',
        '"Classified automatically": what MyMedia filed on its own (85 % or more). Check and correct if needed; every correction teaches it.',
        'A file named like an album (e.g. "נחליאלי לבן.jpg") goes straight into that album.',
      ],
    },
    {
      title: 'People',
      items: [
        'People → Faces to name: each circle is a group of faces of one person. Give it a name; all their photos, and new ones, get it.',
        '"Is it Noa?": MyMedia asks when it is not sure. Yes or No.',
        'A photo with several people appears for each of them, without copies.',
        'In a person’s window, tick only wrong faces to fix them. For babies and young children, the more you confirm, the better it recognises them.',
      ],
    },
    {
      title: 'Compress',
      items: [
        'After a load, MyMedia lists the new big files with size before → after. You tick the ones to compress.',
        'Compress button: on an album, a category or a selection.',
        'The original can be recovered for about 30 days in Drive’s version history (or in the _Originals folder, depending on your settings).',
      ],
    },
    {
      title: 'Find',
      items: [
        'Search: name, description, album, species, person. Accents and Hebrew vowel points are ignored.',
        'Filters: album, origin (camera, WhatsApp, web…), classification, compression, person.',
        'Select (or long press a photo): move, create an album, describe, add a person, compress, delete several files at once.',
      ],
    },
    {
      title: 'Questions',
      items: [
        'Are my photos sent anywhere? No. Only between your device and your own Google Drive.',
        'Where are my names, descriptions, faces? In your Drive, MyMedia folder: mymedia.json, mymedia-faces.json, mymedia-index.*. Your other devices find them there.',
        'Is deleting permanent? No. Files go to the Google Drive trash, recoverable for 30 days.',
        '"Reconnect" banner: the Google connection must be renewed (mostly on iPhone). Your work is kept.',
        'iPhone: the Share menu is not available for MyMedia. Use the Add button.',
      ],
    },
  ],
}

const he: HelpContent = {
  title: 'עזרה',
  tagline: 'MyMedia מסדרת, מזהה ומקטינה את התמונות והסרטונים שלך ישירות ב-Google Drive שלך — בלי לשלוח אותם לשום מקום אחר.',
  sections: [
    {
      title: 'מה מייחד את MyMedia',
      items: [
        'התמונות נשארות שלך. הן נשארות קבצים רגילים בתיקיות של ה-Google Drive שלך. אין פורמט סגור: אם תפסיקו להשתמש ב-MyMedia מחר, הכול נשאר מסודר וקריא.',
        'אין שרת של MyMedia. האפליקציה מדברת ישירות עם ה-Drive שלך. אין חשבון לפתוח, אין מנוי ואין פרסומות.',
        'הבינה נמצאת במכשיר שלך. זיהוי הפנים והלמידה של האלבומים שלך מתבצעים בטלפון או במחשב. הפנים לעולם לא נשלחות לשום שירות.',
        'היא לומדת את הסידור שלך. MyMedia לומדת את האלבומים שלך (למשל אלבום לכל מין של ציפור) ומסדרת תמונות חדשות באותה דרך. היא מראה עד כמה היא בטוחה, ומחליטה לבד רק כשהיא בטוחה.',
        'היא מפנה מקום, בשליטה שלך. מוצגת לך רשימה של הקבצים הגדולים עם הגודל לפני ← אחרי, ואת/ה בוחר/ת. התאריך, המצלמה והמיקום (GPS) נשמרים.',
        'התאריך האמיתי של כל תמונה. הוא נקרא מהתמונה, מהסרטון או משם הקובץ, גם כשהעתקה ל-Drive איבדה אותו.',
        'אפליקציה אחת לכל המכשירים: טלפון אנדרואיד, אייפון ומחשב. היא מתוכננת לעברית (מימין לשמאל), לצרפתית ולאנגלית.',
      ],
    },
    {
      title: 'מתחילים',
      items: [
        'טעינת קבצים חדשים: קורא את מה שהשתנה בתיקיית MyMedia ב-Drive. במצב אוטומטי זה קורה גם לבד כל 15 דקות.',
        'הוספה: העלאת תמונות וסרטונים מהמכשיר, מדיסק און קי או מכרטיס SD. הקבצים שומרים על התאריך האמיתי, נדחסים לפני ההעלאה, וכפילויות מזוהות.',
        'התפריט הצדדי: הקטגוריות והאלבומים הם התיקיות של ה-Drive שלך. גם תיקיות שנוצרו ישירות ב-Drive מופיעות.',
        'באנדרואיד, בגלריה או בוואטסאפ: שיתוף ← MyMedia.',
      ],
    },
    {
      title: 'מיון אוטומטי',
      items: [
        '"למיון": תמונות שלא בתיקייה. MyMedia מציעה את האלבום הסביר ביותר עם אחוז ביטחון; לחיצה אחת מאשרת.',
        '"מוינו אוטומטית": מה ש-MyMedia סידרה לבד (85% ומעלה). כדאי לבדוק ולתקן במידת הצורך; כל תיקון מלמד אותה.',
        'קובץ ששמו כשם אלבום (למשל "נחליאלי לבן.jpg") נכנס ישר לאלבום הזה.',
      ],
    },
    {
      title: 'אנשים',
      items: [
        'אנשים ← פנים לתת להן שם: כל עיגול הוא קבוצת פנים של אדם אחד. נותנים לה שם, וכל התמונות שלו, גם החדשות, מקבלות אותו.',
        '"האם זה נועה?": MyMedia שואלת כשהיא לא בטוחה. כן או לא.',
        'תמונה עם כמה אנשים מופיעה אצל כל אחד מהם, בלי העתקה.',
        'בחלון של אדם מסמנים רק פנים שגויות כדי לתקן. אצל תינוקות וילדים קטנים, ככל שמאשרים יותר, הזיהוי משתפר.',
      ],
    },
    {
      title: 'דחיסה',
      items: [
        'אחרי טעינה, MyMedia מציגה את הקבצים הגדולים החדשים עם הגודל לפני ← אחרי. מסמנים את אלה שרוצים לדחוס.',
        'כפתור דחיסה: על אלבום, קטגוריה או בחירה.',
        'אפשר לשחזר את המקור כ-30 יום בהיסטוריית הגרסאות של Drive (או בתיקייה ‎_Originals, לפי ההגדרות).',
      ],
    },
    {
      title: 'חיפוש',
      items: [
        'חיפוש: שם, תיאור, אלבום, מין, אדם. הניקוד והאותיות הגדולות לא משנים.',
        'סינון: אלבום, מקור (מצלמה, וואטסאפ, אינטרנט…), מיון, דחיסה, אדם.',
        'בחירה (או לחיצה ארוכה על תמונה): העברה, יצירת אלבום, תיאור, הוספת אדם, דחיסה ומחיקה של כמה קבצים בבת אחת.',
      ],
    },
    {
      title: 'שאלות נפוצות',
      items: [
        'האם התמונות שלי נשלחות לאנשהו? לא. רק בין המכשיר שלך ל-Google Drive שלך.',
        'איפה נשמרים השמות, התיאורים והפנים? ב-Drive שלך, בתיקיית MyMedia: mymedia.json, mymedia-faces.json, mymedia-index.*. המכשירים האחרים שלך מוצאים אותם שם.',
        'האם מחיקה היא סופית? לא. הקבצים עוברים לאשפה של Google Drive וניתנים לשחזור במשך 30 יום.',
        'הודעת "התחברות מחדש": יש לחדש את החיבור ל-Google (בעיקר באייפון). העבודה שלך נשמרת.',
        'אייפון: תפריט השיתוף לא זמין ל-MyMedia. יש להשתמש בכפתור הוספה.',
      ],
    },
  ],
}

export const HELP: Record<Language, HelpContent> = { fr, en, he }
