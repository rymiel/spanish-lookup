function rgb(s: string): number[] {
  return s
    .substring(4, s.length - 1)
    .split(", ")
    .map((i) => parseInt(i));
}

function unrgb(n: number[]) {
  return `rgb(${n.join(", ")})`;
}

const recursiveFilters = [
  function recursiveFilterColors(el: HTMLElement) {
    const bg = el.style.backgroundColor;
    if (bg !== "") {
      const inverted = rgb(bg).map((i) => 255 - i);
      el.style.backgroundColor = unrgb(inverted);
    }
  },

  function recursiveFilterLinks(el: HTMLElement) {
    if (el instanceof HTMLAnchorElement) {
      const href = el.href;
      el.href = href;
      el.target = "_blank";
      if (href.startsWith(el.baseURI)) {
        const suffix = href.substring(el.baseURI.length);
        if (suffix.endsWith("#Spanish")) {
          const page = suffix.substring(0, suffix.length - 8);
          el.classList.add("inlink");
          el.href = "#" + page;
          el.target = "_self";
        } else if (suffix.endsWith("#Translations") || suffix.includes("/translations")) {
          const page = suffix.split("#")[0];
          el.classList.add("einlink");
          el.href = "#" + page + "?";
          el.target = "_self";
        }
      }
    }
  },

  function recursiveFilterHeaders(el: HTMLElement) {
    if (el instanceof HTMLHeadingElement) {
      el.dataset.h = el.innerText;
    }
  },
] as const;

export function runRecursiveFilters(el: HTMLElement) {
  recursiveFilters.forEach((fn) => fn(el));

  Array.from(el.children).forEach((i) => runRecursiveFilters(i as HTMLElement));
}

export function keepOnlyLanguageSection(page: HTMLElement, languageId: "English" | "Spanish"): boolean {
  const languageHeader = page.querySelector<HTMLElement>(`h2#${languageId}`);
  if (!languageHeader) return false;
  const languageSection = languageHeader.parentElement!;

  languageSection.querySelectorAll<HTMLLinkElement>("link[rel='mw-deduplicated-inline-style']").forEach(deduped => {
    let ref = deduped.href;
    if (!ref.startsWith("mw-data:")) return;
    ref = ref.substring("mw-data:".length);
    const source = page.querySelector<HTMLStyleElement>(`style[data-mw-deduplicate='${ref}']`);
    if (!source) return;
    // https://github.com/microsoft/TypeScript/issues/283
    const duplicate = source.cloneNode(true) as HTMLElement;
    deduped.insertAdjacentElement("afterend", duplicate);
  });

  Array.from(page.children)
    .filter((i) => i != languageSection)
    .forEach((i) => i.remove());
  languageHeader.remove();
  return true;
}
