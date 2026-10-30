// jsdom implements attachInternals but not ElementInternals.setFormValue, so the
// submitted value is recorded here instead. Real form submission is covered by the
// Playwright test, which runs in a browser that implements it.
export const formValues = new WeakMap<Element, File | string | FormData | null>();

const attachInternals = HTMLElement.prototype.attachInternals;

HTMLElement.prototype.attachInternals = function patched(this: HTMLElement) {
  const internals = attachInternals.call(this) as ElementInternals;
  if (typeof internals.setFormValue !== 'function') {
    internals.setFormValue = (value: File | string | FormData | null) => {
      formValues.set(this, value);
    };
  }
  return internals;
};
