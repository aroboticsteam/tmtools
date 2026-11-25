/** Small vmd1.dev mark fixed to the bottom-right corner of every SPA page.
 * On phones it sits above the bottom tab bar (h-16) so it never covers a tab. */
export function CornerLogo() {
  return (
    <a
      href="https://vmd1.dev"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="vmd1.dev"
      className="fixed bottom-[4.75rem] right-3 z-40 flex h-8 w-8 items-center justify-center rounded-md bg-black opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 lg:bottom-3 dark:ring-1 dark:ring-white/35"
    >
      <img src="https://cdn.848226.xyz/v1/vmd1/media/logo/logo.svg" alt="" className="h-5 w-5 object-contain" />
    </a>
  );
}
