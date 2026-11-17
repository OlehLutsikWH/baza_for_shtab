// Налаштування модуля, що залежать від місця розгортання.
/** Звідки браузер бере шрифти для PDF-звіту (файли з public/base/fonts). */
export const REPORT_FONT_BASE = '/base/fonts/';
/** Фото, які вміє вставляти PDF (react-pdf: лише JPG і PNG). */
export const REPORT_IMAGE_EXT = /\.(jpe?g|png)$/i;
