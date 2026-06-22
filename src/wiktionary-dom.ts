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
      if (href !== "") {
        if (href.startsWith(window.location.origin)) {
          const suffix = href.substring(window.location.origin.length);
          if (suffix.endsWith("#Spanish") && suffix.startsWith("/wiki/")) {
            const page = suffix.substring(6, suffix.length - 8);
            el.classList.add("inlink");
            el.href = "#" + page;
          } else if (suffix.endsWith("#Translations") && suffix.startsWith("/wiki/")) {
            const page = suffix.substring(6).split("#")[0];
            el.classList.add("einlink");
            el.href = "#" + page + "?";
          } else {
            el.href = "https://en.wiktionary.org/" + suffix;
            el.target = "_blank";
          }
        } else {
          el.target = "_blank";
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

function isHeaderName(str: string) {
  return str === "H1" || str === "H2" || str === "H3" || str === "H4" || str === "H5";
}

function isHeader(el: HTMLElement): boolean {
  return (
    (el.classList.contains("mw-heading") && el.firstElementChild && isHeaderName(el.firstElementChild.nodeName)) ??
    false
  );
}

function headerLevel(el: HTMLElement) {
  if (!isHeader(el)) return Infinity;
  return parseInt(el.firstElementChild!.nodeName[1]);
}

export function delimitSection(headerContainer: HTMLElement, minLevel = -Infinity): HTMLElement[] {
  const elements: HTMLElement[] = [];
  if (isHeaderName(headerContainer.nodeName)) {
    headerContainer = headerContainer.parentElement!;
  } else if (!isHeader(headerContainer)) {
    throw new Error(`Cannot delimit non-header element ${headerContainer}`);
  }
  const baseLevel = headerLevel(headerContainer);
  let next = headerContainer.nextElementSibling as HTMLElement | null;
  while (next !== null && headerLevel(next) > baseLevel && headerLevel(next) > minLevel) {
    elements.push(next);
    next = next.nextElementSibling as HTMLElement | null;
  }
  return elements;
}

export function keepOnlyLanguageSection(page: HTMLElement, languageId: "English" | "Spanish"): boolean {
  const languageHeader = page.querySelector<HTMLElement>(`h2#${languageId}`)?.parentElement;
  if (!languageHeader) {
    return false;
  }

  const section = delimitSection(languageHeader);
  Array.from(page.children as HTMLCollectionOf<HTMLElement>)
    .filter((i) => !section.includes(i))
    .forEach((i) => i.remove());
  return true;
}

export function removeWiktionaryChrome(page: HTMLElement) {
  // This app is only viewing Wiktionary snippets, so editing links and references are clutter.
  page.querySelectorAll(".mw-editsection").forEach((i) => i.remove());
  page.querySelectorAll(".reference").forEach((i) => i.remove());
  page.querySelectorAll(".external").forEach((i) => i.remove());
}
