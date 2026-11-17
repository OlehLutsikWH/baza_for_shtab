// Віддати файл користувачу (завантаження в браузері). Одне місце для CSV, PDF тощо:
// демо-збірка підміняє саме цю функцію (сторінка-артефакт не може сама почати завантаження).
export function saveFile(name: string, data: Blob | string, type = 'application/octet-stream'): void | Promise<void> {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
