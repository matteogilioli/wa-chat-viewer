/* ==========================================================================
   markers.js — recognizes the lines WhatsApp writes by itself (media left out
   of the export, deleted or edited messages, calls, notices).

   Those strings are translated into the phone's language, so a list of
   sentences is never enough: sooner or later an unlisted language shows up.
   So we detect them in two steps.

   1. STRUCTURE (works in every language). WhatsApp marks content the user did
      not type:
        · on iPhone by prefixing it with the invisible character U+200E;
        · on Android by wrapping the text in angle brackets, "<…>";
        · the "edited" marker always sits at the end, in angle brackets.
      That alone tells us it is not a typed message, which is enough to render
      it as a placeholder instead of raw text.

   2. VOCABULARY (only used to pick the right icon and to cover Android cases
      that carry no marker). These are word stems, not whole sentences: stems
      survive plurals, genders and regional variants — exactly what breaks
      lists of full sentences.

   An unlisted language is still recognized as generated content, just with a
   generic icon: no raw marker text ever reaches the screen.
   ========================================================================== */
(function (global) {
  'use strict';

  /** Builds a regexp matching any of the given stems. */
  const anyOf = (stems) => new RegExp(stems.join('|'), 'iu');

  /* -------------------------------------------------------------- deleted */
  // Stem of the verb "to delete" in the most widely spoken languages.
  const DELETED = anyOf([
    'delet',                       // English
    'eliminat', 'eliminad', 'elimin',  // Italian, Spanish, Portuguese
    'borrad', 'borrast',           // Latin American Spanish
    'apagad',                      // Portuguese
    'supprim',                     // French
    'gelöscht', 'geloscht',        // German
    'verwijderd',                  // Dutch
    'usunię', 'usunie',            // Polish
    'удален', 'удалено', 'удалила', 'удалил',   // Russian
    'видален', 'видалено',         // Ukrainian
    'silindi', 'sildiniz',         // Turkish
    'dihapus', 'menghapus',        // Indonesian, Malay
    'xóa', 'xoá',                  // Vietnamese
    'ลบ',                          // Thai
    'حذف',                         // Arabic, Persian, Urdu
    'נמחק', 'מחקת',                // Hebrew
    'διαγρ',                       // Greek
    'ștears', 'sters',             // Romanian
    'raderat', 'togs bort',        // Swedish
    'slettet',                     // Danish, Norwegian
    'poistettu', 'poistit',        // Finnish
    'smazán', 'smazan',            // Czech
    'törölve', 'torolve',          // Hungarian
    'डिलीट', 'मिटा',                // Hindi
    'মুছে',                          // Bengali
    '削除',                          // Japanese
    '삭제',                          // Korean
    '删除', '刪除',                   // Chinese
  ]);

  /* --------------------------------------------------------------- edited */
  const EDITED = anyOf([
    'edit', 'modificat', 'modific', 'editad', 'bearbeitet', 'bewerkt',
    'edytowan', 'изменено', 'відредаговано', 'düzenlendi', 'diedit',
    'chỉnh sửa', 'επεξεργ', 'redigerat', 'redigert', 'muokattu', 'upraven',
    'szerkesztve', 'تعديل', 'נערכה', '編集', '편집', '编辑', '已編輯',
  ]);

  /* ------------------------------------------------------- media left out */
  // Stem of "omitted / excluded / missing / not included".
  const OMITTED = anyOf([
    'omitted', 'omess', 'omitid', 'omiti', 'omis', 'ocult',
    'ausgeschlossen', 'weggelassen', 'fehlen', 'weggelaten', 'ontbreek',
    'pominię', 'pominie', 'пропущен', 'без медиа', 'медіа', 'медиафайл',
    'dahil edilmedi', 'atlandı', 'tidak disertakan', 'dihilangkan',
    'bỏ qua', 'ไม่ได้รวม', 'استبعاد', 'הוסר', 'נכלל', 'παραλείφθηκε',
    'utelämnad', 'utelatt', 'udeladt', 'jätetty pois', 'vynechán',
    'kihagyva', 'शामिल नहीं', 'बाहर', '省略', '략', '略去', '未包含',
  ]);

  /* ----------------------------------------------------------- media kind */
  // Nouns are mostly cognates across languages, so a few stems go a long way.
  const KIND = [
    ['sticker', anyOf(['sticker', 'stiker', 'adesiv', 'pegatina', 'autocolante',
                       'autocollant', 'наклейк', 'çıkartma', 'ملصق', 'מדבקה',
                       'ステッカー', '스티커', '贴纸', '貼圖', 'स्टिकर'])],
    ['video',   anyOf(['video', 'vídeo', 'víd', 'filmat', 'filme', 'film',
                       'видео', 'відео', 'βίντεο', 'فيديو', 'סרטון', 'वीडियो',
                       '動画', 'ビデオ', '동영상', '视频', '視訊', 'gif'])],
    ['audio',   anyOf(['audio', 'áudio', 'ääni', 'ljud', 'lyd', 'аудио',
                       'голосов', 'ses ', 'suara', 'صوت', 'קול', 'ήχ',
                       '音声', 'オーディオ', '오디오', '音频', 'ऑडियो', 'voice',
                       'vocal', 'sprachnachricht', 'nota de voz'])],
    ['image',   anyOf(['imag', 'immag', 'foto', 'photo', 'bild', 'obraz', 'resim',
                       'gambar', 'ảnh', 'صور', 'תמונה', 'εικόνα', 'kuva',
                       'billede', 'зображ', 'изображ', 'фото', 'चित्र', 'फ़ोटो',
                       '画像', '写真', '사진', '图片', '圖片', 'รูป'])],
    ['doc',     anyOf(['document', 'dokument', 'документ', 'belge', 'dokumen',
                       'مستند', 'מסמך', 'έγγραφο', 'दस्तावे', '文書', 'ドキュメント',
                       '문서', '文档', '文件'])],
  ];

  /* ---------------------------------------------------------------- calls */
  const CALL = anyOf([
    'chiamata', 'call', 'llamada', 'chamada', 'appel', 'anruf', 'gesprek',
    'połączenie', 'polaczenie', 'звонок', 'дзвінок', 'arama', 'panggilan',
    'cuộc gọi', 'สาย', 'مكالمة', 'שיחה', 'κλήση', 'apel', 'samtal', 'opkald',
    'puhelu', 'hovor', 'hívás', 'कॉल', '通話', '전화', '通话', '來電',
  ]);
  const CALL_VIDEO = anyOf(['video', 'vídeo', 'відео', 'видео', 'görüntülü',
                            'фидео', 'مرئية', 'וידאו', '視訊', '视频', '영상', 'ビデオ']);
  const CALL_MISSED = anyOf([
    'pers', 'missed', 'perdid', 'verpasst', 'manqué', 'gemist', 'nieodebran',
    'пропущ', 'cevapsız', 'tak terjawab', 'nhỡ', 'ไม่ได้รับสาย', 'فائتة',
    'שלא נענתה', 'αναπάντητη', 'missat', 'ubesvaret', 'vastaamaton',
    'zmeškan', 'nem fogadott', 'मिस', '不在着信', '부재중', '未接',
    'senza risposta', 'no answer', 'sin respuesta',
  ]);

  /* ------------------------------------------------------------ view once */
  // Photos and videos sent as "view once": the file is never in the export,
  // but when WhatsApp says so outright we can pass that on to the reader.
  const VIEW_ONCE = anyOf([
    'una volta', 'una sola volta',            // Italian
    'view once', 'viewed once', 'opened once', // English
    'una vez', 'una sola vez',                // Spanish
    'visualização única', 'uma vez',          // Portuguese
    'vue unique', 'une seule fois',           // French
    'einmal ansehen', 'einmalige ansicht',    // German
    'eenmalig',                               // Dutch
    'tek seferlik',                           // Turkish
    'один раз', 'одноразов',                  // Russian
    'sekali lihat', 'lihat sekali',           // Indonesian
    'एक बार',                                  // Hindi
    'مرة واحدة',                               // Arabic
    '一度だけ', '한 번만', '阅后即焚', '查看一次',
  ]);

  /* ------------------------------------------------------- system notices */
  const ENCRYPTED = anyOf([
    'crittograf', 'encrypt', 'cifrad', 'criptograf', 'chiffr', 'verschlüssel',
    'verschlussel', 'versleuteld', 'szyfrowan', 'шифров', 'uçtan uca',
    'terenkripsi', 'mã hóa', 'เข้ารหัส', 'مشفرة', 'مشفّرة', 'מוצפנ',
    'κρυπτογρ', 'krypter', 'salattu', 'šifrov', 'titkosít', 'एन्क्रिप्ट',
    '暗号化', '암호화', '加密',
  ]);
  const CONTACT_NOTICE = anyOf([
    'tra i tuoi contatti', 'in your contacts', 'dans vos contacts',
    'in deinen kontakten', 'en tus contactos', 'nos seus contactos',
    'nos seus contatos', 'in je contacten', 'codice di sicurezza',
    'security code', 'código de seguridad', 'sicherheitsnummer',
    'code de sécurité', 'код безопасности', 'güvenlik kodu',
  ]);

  /* ---------------------------------------------------------------- "you" */
  // Some exports sign your own messages with the word for "you" instead of
  // your name: if that shows up among the participants, that one is you.
  const YOU = new Set([
    'tu', 'you', 'yo', 'tú', 'você', 'voce', 'du', 'ich', 'vous', 'moi', 'toi',
    'jij', 'je', 'ik', 'sen', 'siz', 'вы', 'ты', 'я', 'anda', 'kamu', 'saya',
    'आप', 'मैं', 'أنت', 'أنا', 'εσύ', 'εγώ', 'ty', 'ja', 'eu', 'jag', 'minä',
    '你', '我', '자신', '나', '私', '自分',
  ]);

  /* ------------------------------------------------------------ structure */

  const LRM = /^[\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
  const WRAPPED = /^<[^<>]{1,120}>$/;
  // "edited" marker: always trailing, in angle brackets, preceded by the
  // invisible character WhatsApp puts in front of the text it generates.
  const TRAILING_TAG = /[\s]*[\u200e\u200f]<[^<>]{1,80}>\s*$/;

  /**
   * Was this body written by WhatsApp rather than by the user?
   * Language-independent: it looks at the markers, not at the words.
   */
  function isGenerated(body) {
    const t = body.trim();
    return LRM.test(t) || WRAPPED.test(t);
  }

  /** Media kind mentioned in a text such as "image omitted". */
  function kindOfText(text) {
    for (const [kind, re] of KIND) if (re.test(text)) return kind;
    return 'media';
  }

  global.Markers = {
    isGenerated, kindOfText,
    isYou: (name) => YOU.has(String(name).trim().toLowerCase()),
    isViewOnce: (s) => VIEW_ONCE.test(s),
    isDeleted: (s) => DELETED.test(s),
    isEdited: (s) => EDITED.test(s),
    isOmitted: (s) => OMITTED.test(s),
    isCall: (s) => CALL.test(s),
    isVideoCall: (s) => CALL_VIDEO.test(s),
    isMissedCall: (s) => CALL_MISSED.test(s),
    isEncryptionNotice: (s) => ENCRYPTED.test(s),
    isContactNotice: (s) => CONTACT_NOTICE.test(s),
    TRAILING_TAG,
  };
})(window);
