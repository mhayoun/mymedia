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
        'Ajouter un dossier de l’ordinateur : chaque dossier devient un album du même nom (le dossier « Cigogne » devient l’album « Cigogne »). MyMedia indique les albums avant l’envoi.',
        'Les photos s’ouvrent en pleine qualité automatiquement ; le pourcentage montre le chargement.',
        'En bas du menu : l’espace Google Drive (utilisé, libre, et la part de MyMedia).',
        'Sur téléphone, quand un album est ouvert, son nom et les boutons modifier, nouvel album et supprimer sont sur la première ligne.',
      ],
    },
    {
      title: 'Classer automatiquement',
      items: [
        '« À classer » : photos posées en vrac. MyMedia propose l’album le plus probable avec un pourcentage ; un toucher suffit pour accepter.',
        '« Classés automatiquement » : ce que MyMedia a rangé seul (85 % ou plus). Vérifiez et corrigez si besoin ; chaque correction lui apprend.',
        'Un fichier nommé comme un album (par exemple « נחליאלי לבן.jpg ») va directement dans cet album.',
        '« Nouveau ? » : la photo ne ressemble à aucun album, par exemple une espèce qui n’a pas encore d’album. Elle n’est jamais rangée toute seule : créez l’album ou choisissez-en un.',
        'Nouvel album depuis « À classer » : bouton Nouvel album, touchez les photos à mettre dedans, puis « Créer l’album avec… ». Le petit bouton dossier + d’une carte le fait pour une seule photo.',
        'Dans la fiche d’une photo : « Nouvel album avec cette photo » crée l’album et y met la photo.',
        'Dès 3 photos dans un album, MyMedia peut ranger seul les suivantes.',
        'Apprentissage : la pastille bleue en haut se remplit pendant que MyMedia étudie les nouvelles photos. Touchez-la pour les statistiques : exactitude par album, confusions, albums qui manquent d’exemples.',
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
        'Trier par « Plus gros » pour voir ce qui prend de la place ; la taille s’affiche sur chaque vignette.',
        'Menu → Provenance : les photos par groupe Facebook ou par import (dossier ou ZIP, avec le jour).',
      ],
    },
    {
      title: 'Facebook',
      items: [
        'Ajouter → Export Facebook (ZIP) : choisissez les groupes. Chaque photo garde la date et le texte du post, et va dans l’album de l’espèce si le texte la nomme.',
        'Une photo déjà présente en plus petit est remplacée par la version du ZIP ; la même photo pas plus grande est un doublon, ignoré.',
      ],
    },
    {
      title: 'Donner des photos à un autre compte',
      items: [
        'Réglages → Transfert vers un autre compte : choisissez une catégorie ou un album (par exemple ציפורים) et l’adresse Gmail, puis Envoyer.',
        'L’autre compte ouvre MyMedia, même menu, et clique sur Accepter. Le dossier arrive au même endroit dans son MyMedia, avec espèces, textes, dates et personnes.',
        'Rien n’est copié ni renvoyé : les photos changent seulement de propriétaire. Après l’acceptation, la place est libérée sur le premier compte.',
        'Seuls vos propres fichiers peuvent être donnés ; MyMedia indique ceux qui appartiennent à un autre compte.',
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
        'Un nouveau compte Google n’arrive pas à se connecter ? Il doit d’abord être ajouté à la liste des comptes autorisés de MyMedia (Google Cloud → utilisateurs test).',
        'Combien de photos tiennent dans 15 Go gratuits ? Avec des photos de 100 Ko en moyenne, environ 150 000. Exemple réel : 652 photos occupent 61,7 Mo, soit environ 95 Ko par photo. Les photos ajoutées en taille d’origine depuis le téléphone pèsent plus. Les 15 Go sont partagés avec Gmail et Google Photos.',
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
        'Add a folder from the computer: each folder becomes an album with the same name (the folder "Stork" becomes the album "Stork"). MyMedia shows the albums before uploading.',
        'Photos open in full quality automatically; the percentage shows the loading.',
        'At the bottom of the menu: your Google Drive space (used, free, and MyMedia\'s share).',
        'On a phone, with an album open, its name and the rename, new album and delete buttons are on the first line.',
      ],
    },
    {
      title: 'Automatic classification',
      items: [
        '"To classify": loose photos. MyMedia suggests the most likely album with a percentage; one tap accepts it.',
        '"Classified automatically": what MyMedia filed on its own (85 % or more). Check and correct if needed; every correction teaches it.',
        'A file named like an album (e.g. "נחליאלי לבן.jpg") goes straight into that album.',
        '"New?": the photo resembles no album, for example a species that has no album yet. It is never filed on its own: create the album or choose one.',
        'New album from "To classify": New album button, tap the photos to put in it, then "Create the album with…". The small folder + button of a card does it for one photo.',
        'In a photo\'s information: "New album with this photo" creates the album and puts the photo in it.',
        'From 3 photos in an album, MyMedia can file the next ones on its own.',
        'Learning: the blue pill at the top fills up while MyMedia studies new photos. Tap it for the statistics: accuracy per album, confusions, albums that need more examples.',
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
        'Sort by "Largest" to see what takes space; the size shows on each thumbnail.',
        'Menu → Provenance: photos by Facebook group or by import (folder or ZIP, with the day).',
      ],
    },
    {
      title: 'Facebook',
      items: [
        'Add → Facebook export (ZIP): choose the groups. Each photo keeps the post\'s date and text, and goes into the species album when the text names it.',
        'A photo already there in a smaller size is replaced by the ZIP\'s version; the same photo not bigger is a duplicate, skipped.',
      ],
    },
    {
      title: 'Give photos to another account',
      items: [
        'Settings → Transfer to another account: choose a category or an album (e.g. ציפורים) and the Gmail address, then Send.',
        'The other account opens MyMedia, same menu, and clicks Accept. The folder lands at the same place in their MyMedia, with species, texts, dates and people.',
        'Nothing is copied or uploaded again: only the owner changes. Once accepted, the space is freed on the first account.',
        'Only your own files can be given; MyMedia tells which ones belong to another account.',
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
        'A new Google account cannot sign in? It must first be added to MyMedia\'s allowed accounts (Google Cloud → test users).',
        'How many photos fit in the free 15 GB? With photos of 100 KB on average, about 150,000. Real example: 652 photos take 61.7 MB, about 95 KB per photo. Photos added at full size from a phone weigh more. The 15 GB are shared with Gmail and Google Photos.',
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
        'הוספת תיקייה מהמחשב: כל תיקייה הופכת לאלבום באותו שם (התיקייה "חסידה" הופכת לאלבום "חסידה"). MyMedia מראה את האלבומים לפני ההעלאה.',
        'התמונות נפתחות באיכות מלאה אוטומטית; האחוז מראה את הטעינה.',
        'בתחתית התפריט: המקום ב-Google Drive (בשימוש, פנוי, והחלק של MyMedia).',
        'בטלפון, כשאלבום פתוח, השם שלו והכפתורים עריכה, אלבום חדש ומחיקה נמצאים בשורה הראשונה.',
      ],
    },
    {
      title: 'מיון אוטומטי',
      items: [
        '"למיון": תמונות שלא בתיקייה. MyMedia מציעה את האלבום הסביר ביותר עם אחוז ביטחון; לחיצה אחת מאשרת.',
        '"מוינו אוטומטית": מה ש-MyMedia סידרה לבד (85% ומעלה). כדאי לבדוק ולתקן במידת הצורך; כל תיקון מלמד אותה.',
        'קובץ ששמו כשם אלבום (למשל "נחליאלי לבן.jpg") נכנס ישר לאלבום הזה.',
        '"חדש?": התמונה לא דומה לאף אלבום, למשל מין שעוד אין לו אלבום. היא אף פעם לא מועברת לבד: יוצרים את האלבום או בוחרים אחד.',
        'אלבום חדש מ"למיון": כפתור אלבום חדש, נוגעים בתמונות שייכנסו אליו, ואז "צור אלבום עם…". כפתור התיקייה + הקטן בכרטיס עושה זאת לתמונה אחת.',
        'בפרטי תמונה: "אלבום חדש עם התמונה" יוצר את האלבום ומכניס אליו את התמונה.',
        'מ-3 תמונות באלבום, MyMedia יכולה לסדר לבד את הבאות.',
        'למידה: הכדור הכחול למעלה מתמלא בזמן ש-MyMedia לומדת תמונות חדשות. נוגעים בו לסטטיסטיקה: דיוק לכל אלבום, בלבולים, אלבומים שחסרות בהם דוגמאות.',
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
        'מיון לפי "הגדולים ביותר" כדי לראות מה תופס מקום; הגודל מופיע על כל תמונה ממוזערת.',
        'תפריט ← מקור: תמונות לפי קבוצת פייסבוק או לפי ייבוא (תיקייה או ZIP, עם היום).',
      ],
    },
    {
      title: 'פייסבוק',
      items: [
        'הוספה ← ייצוא מפייסבוק (ZIP): בוחרים את הקבוצות. כל תמונה שומרת את התאריך והטקסט של הפוסט, ונכנסת לאלבום המין כשהטקסט מזכיר אותו.',
        'תמונה שכבר קיימת בגודל קטן יותר מוחלפת בגרסה מה-ZIP; אותה תמונה שאינה גדולה יותר היא כפילות ומדולגת.',
      ],
    },
    {
      title: 'מסירת תמונות לחשבון אחר',
      items: [
        'הגדרות ← העברה לחשבון אחר: בוחרים קטגוריה או אלבום (למשל ציפורים) ואת כתובת ה-Gmail, ואז שליחה.',
        'החשבון השני פותח את MyMedia, באותו תפריט, ולוחץ לקבל. התיקייה מגיעה לאותו מקום ב-MyMedia שלו, עם המינים, הטקסטים, התאריכים והאנשים.',
        'שום דבר לא מועתק ולא מועלה מחדש: רק הבעלים משתנה. אחרי הקבלה, המקום מתפנה בחשבון הראשון.',
        'אפשר למסור רק קבצים שלך; MyMedia מציינת אילו שייכים לחשבון אחר.',
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
        'חשבון Google חדש לא מצליח להתחבר? צריך קודם להוסיף אותו לרשימת החשבונות המורשים של MyMedia (Google Cloud ← משתמשי בדיקה).',
        'כמה תמונות נכנסות ב-15 ג\'יגה החינמיים? עם תמונות של 100 קילובייט בממוצע, בערך 150,000. דוגמה אמיתית: 652 תמונות תופסות 61.7 מגה, כלומר כ-95 קילובייט לתמונה. תמונות שנוספו בגודל המקורי מהטלפון שוקלות יותר. ה-15 ג\'יגה משותפים עם Gmail ו-Google Photos.',
      ],
    },
  ],
}

export const HELP: Record<Language, HelpContent> = { fr, en, he }
