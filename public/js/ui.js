// 全局提示（toast）和对话框（确认 / 输入 / 多选项）
const { reactive } = Vue;

export const ui = reactive({ toasts: [], dialog: null });

let seq = 0;

export function toast(message, type = 'info', ms = 2400) {
  const id = ++seq;
  ui.toasts.push({ id, message, type });
  setTimeout(() => {
    const i = ui.toasts.findIndex((t) => t.id === id);
    if (i >= 0) ui.toasts.splice(i, 1);
  }, ms);
}

export const toastError = (err) => toast(err?.message || String(err), 'error', 3600);

/**
 * 打开对话框，返回 Promise：
 * - 普通确认：确定 → true，取消 → null
 * - input：确定 → 输入的字符串，取消 → null
 * - actions：[{ text, value, primary, danger }]，点哪个返回哪个 value，取消 → null
 */
export function dialog(options) {
  if (ui.dialog) ui.dialog.resolve(null);
  return new Promise((resolve) => {
    ui.dialog = {
      okText: '确定',
      cancelText: '取消',
      ...options,
      value: options.input?.value ?? '',
      resolve(v) {
        ui.dialog = null;
        resolve(v);
      },
    };
  });
}

export async function confirm(message, { title = '请确认', okText = '确定', danger = false } = {}) {
  return (await dialog({ title, message, okText, danger })) === true;
}

export function prompt(title, { message, value = '', placeholder = '', type = 'text', inputmode, okText } = {}) {
  return dialog({ title, message, okText, input: { value: String(value), placeholder, type, inputmode } });
}
