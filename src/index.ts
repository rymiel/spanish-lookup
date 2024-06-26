let form: HTMLFormElement;
let queryBox: HTMLInputElement;
let content: HTMLDivElement;
let left: HTMLDivElement;
let activeQuery: string;

let controller = new AbortController();

const headers = new Headers({
  "Api-User-Agent": "Spanish-Lookup/1.0 (emilia@rymiel.space)",
});

const frequencies: Map<string, Record<string, number>> = new Map();
const KNOWN_FREQS = ["ciudad", "hobbit"] as const;
const VARIANTS = ["-freq", "-count"] as const;

function constructURL(query: string): string {
  const encoded = encodeURIComponent(query);
  return `https://en.wiktionary.org/w/api.php?action=parse&page=${encoded}&prop=text|wikitext&formatversion=2&origin=*&format=json`;
}

function constructTemplateURL(template: string, title: string): string {
  const encodedTempl = encodeURIComponent(template);
  const encodedTitle = encodeURIComponent(title);
  return `https://en.wiktionary.org/w/api.php?action=expandtemplates&title=${encodedTitle}&text={{${encodedTempl}|json=1}}&prop=wikitext&formatversion=2&origin=*&format=json`;
}

function rgb(s: string): number[] {
  return s
    .substring(4, s.length - 1)
    .split(", ")
    .map((i) => parseInt(i));
}

function unrgb(n: number[]) {
  return `rgb(${n.join(", ")})`;
}

const ANKI_VERSION = 6;
type AnkiOk<T> = { result: T; error: null };
type AnkiError = { result: null; error: string };
type AnkiResponse<T> = AnkiOk<T> | AnkiError;
async function invoke<T = object>(action: string, params: object = {}): Promise<T> {
  const i = await fetch("http://127.0.0.1:8765", {
    method: "POST",
    body: JSON.stringify({
      action,
      params,
      version: ANKI_VERSION,
    }),
  });
  const json = (await i.json()) as AnkiResponse<T>;
  if (json.error) {
    throw json.error;
  }
  return json.result as T; // why, ts?
}
type AnkiPermissionResponse = { permission: "granted" | "denied" };

function findPronuncation(pronuncationTitle: HTMLElement, page: HTMLElement): string | undefined {
  const pronuncationSection = pronuncationTitle.parentElement!.nextElementSibling! as HTMLElement;
  let pronuncationEntries: HTMLElement[] = Array.from(pronuncationSection.querySelectorAll("li")).filter((el) =>
    el.innerText.startsWith("IPA")
  );
  const switcherEntries = Array.from(page.querySelectorAll(".vsSwitcher > .vsHide > ul > li")) as HTMLElement[];

  // Sometimes the pronuncations are in consecutive switchers, instead of directly under the "Pronuncation"
  // header. We can't use this in every case because sometimes the switchers aren't there at all, so just
  // use whichever one is more accurate.
  if (switcherEntries.length > pronuncationEntries.length) {
    pronuncationEntries = switcherEntries;
  }

  // Try to find the most Buenos Aires pronuncation
  const correctPronuncation =
    pronuncationEntries.length === 1
      ? pronuncationEntries[0]
      : pronuncationEntries.find((el) => {
          const inner = el.innerText;
          return inner.includes("(Buenos Aires and environs)") || inner.includes("(Latin America)");
        });

  if (correctPronuncation === undefined) {
    console.error(
      `Couldn't find the correct pronuncation from the choices ${pronuncationEntries
        .map((el) => el.innerText)
        .join(", ")}`
    );

    return undefined;
  } else {
    // Extract just the IPA. There's some jank here to account for words which do not vary by region. Those
    // are formatted slightly differently by wiktionary.
    const parts = correctPronuncation.innerText.split(")", 3);
    let pronuncationText = parts[parts.length - 1].trim();
    if (pronuncationText.startsWith(":")) {
      pronuncationText = pronuncationText.substring(1).trim();
    }

    return pronuncationText;
  }
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

function runRecursiveFilters(el: HTMLElement) {
  recursiveFilters.forEach((fn) => fn(el));

  Array.from(el.children).forEach((i) => runRecursiveFilters(i as HTMLElement));
}

const vosotrosFilterColumns = [1, 1, 1, 0, 0, 2, 4, 6, 5, 5, 5, 5, 5, 0, 6, 5, 5, 5, 5, 0, 6, 5, 5] as const;

function filterVosotrosTable(table: HTMLTableElement) {
  for (const row of table.rows) {
    const cells = row.cells;
    const idx = row.rowIndex;

    const decIndex = vosotrosFilterColumns[idx];
    if (cells[decIndex].colSpan === 1) {
      cells[decIndex].remove();
    } else {
      cells[decIndex].colSpan -= 1;
    }
  }
}

const compactableRows = [7, 14, 20];
function filterCompactTable(table: HTMLTableElement) {
  for (const row of table.rows) {
    if (compactableRows.indexOf(row.rowIndex) == -1) {
      continue;
    }

    for (const cell of Array.from(row.cells)) {
      if (cell.cellIndex == 0) {
        continue;
      }
      cell.remove();
    }
  }
}

function buildTable(a: readonly string[], b: readonly Node[]) {
  const formTable = document.createElement("table");
  formTable.className = "quick";

  a.forEach((_, i) => {
    const tr = document.createElement("tr");

    let aText = a[i];
    if (aText.startsWith("!")) {
      aText = aText.substring(1);
      tr.classList.add("gap");
    }
    const tda = document.createElement("th");
    tda.innerText = aText;
    tr.appendChild(tda);

    const tdb = document.createElement("td");
    tdb.appendChild(b[i]);
    tr.appendChild(tdb);

    formTable.appendChild(tr);
  });

  return formTable;
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

function equalOrHigherLevel(base: HTMLElement, other: HTMLElement) {
  if (!isHeader(base) || !isHeader(other)) {
    return false;
  }

  const baseLevel = parseInt(base.firstElementChild!.nodeName[1]);
  const otherLevel = parseInt(other.firstElementChild!.nodeName[1]);
  return otherLevel <= baseLevel;
}

function delimitSection(headerContainer: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];
  if (isHeaderName(headerContainer.nodeName)) {
    headerContainer = headerContainer.parentElement!;
  } else if (!isHeader(headerContainer)) {
    throw new Error(`Cannot delimit non-header element ${headerContainer}`);
  }
  let next = headerContainer.nextElementSibling as HTMLElement | null;
  while (next !== null && !equalOrHigherLevel(headerContainer, next)) {
    elements.push(next);
    next = next.nextElementSibling as HTMLElement | null;
  }
  return elements;
}

function delimitInlineSection(startHeader: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const level = startHeader.nodeName;
  if (!isHeaderName(level)) {
    throw new Error(`Cannot delimit non-header element ${level}`);
  }
  let next = startHeader.nextElementSibling as HTMLElement | null;
  while (next !== null && !isHeaderName(next.nodeName)) {
    elements.push(next);
    next = next.nextElementSibling as HTMLElement | null;
  }
  return elements;
}

function removeFromArray<T>(array: T[], ...elements: T[]) {
  elements.forEach((e) => {
    const i = array.indexOf(e);
    if (i !== -1) {
      array.splice(i, 1);
    }
  });
}

const PRONOUNS = [
  "yo",
  "tú",
  "vos",
  "ella",
  "nosotros",
  "ustedes",
  "!p. yo",
  "p. vos",
  "p. ella",
  "p. nosotros",
  "p. ustedes",
  "!subj.",
] as const;
const FORMS = [
  "pres_1s",
  "pres_2s",
  "pres_2sv",
  "pres_3s",
  "pres_1p",
  "pres_3p",
  "pret_1s",
  "pret_2s",
  "pret_3s",
  "pret_1p",
  "pret_3p",
  "pres_sub_1s",
] as const;
type EsConjForm = (typeof FORMS)[number];
interface EsConjEntry {
  form: string;
  footnotes?: string[];
}
interface EsConjJson {
  forms: Record<EsConjForm, EsConjEntry[]>;
}

// TODO: nicer layout of pages with multiple definitions (i.e. jump to definition)
// this includes pages with multiple "etymologies", for example `colmo`

const esConjRegex = /{{(es-conj[^}]*?)}}/;

function spanishDefinitionLookup(page: HTMLElement, query: string, wikitext: string, cleanup: () => void) {
  // console.log(wikitext);
  const templateLookup = esConjRegex.exec(wikitext);
  console.log(templateLookup);
  if (templateLookup && templateLookup[1]) {
    const loader = document.createElement("div");
    loader.className = "loader";
    left.appendChild(loader);
    fetch(constructTemplateURL(templateLookup[1], query), {
      method: "GET",
      headers: headers,
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((json) => {
        // console.log(json);
        const innerJson = JSON.parse(json.expandtemplates.wikitext) as EsConjJson;
        console.log(innerJson);

        // TODO: include footnotes
        const forms = FORMS.map((i) => {
          const div = document.createElement("div");
          innerJson.forms[i]
            .map((j) => {
              const span = document.createElement("span");
              span.innerText = j.form;
              if (j.footnotes) {
                span.title = j.footnotes.join(", ");
                span.classList.add("footnote");
              }
              return span;
            })
            .forEach((span, i) => {
              if (i > 0) div.append(", ");
              div.appendChild(span);
            });
          return div;
        });

        const formTable = buildTable(PRONOUNS, forms);
        loader.remove();
        left.appendChild(formTable);
      });
  }

  const spanishHeader = page.querySelector<HTMLElement>("h2#Spanish")?.parentElement;
  if (!spanishHeader) {
    if (activeQuery === query) {
      const errorMessage = document.createElement("div");
      errorMessage.innerText = "This page has no Spanish entry!";
      content.appendChild(errorMessage);
      cleanup();
    }
    return;
  }

  const spanishSection: Element[] = delimitSection(spanishHeader);
  Array.from(page.children)
    .filter((i) => !spanishSection.includes(i))
    .forEach((i) => i.remove());

  runRecursiveFilters(page);

  const searchHeader = document.createElement("h1");
  searchHeader.innerText = query;
  page.prepend(searchHeader);

  const pronuncationTitle = page.querySelector<HTMLElement>("h3[data-h=Pronunciation]");
  if (pronuncationTitle) {
    const pronuncation = findPronuncation(pronuncationTitle, page);

    if (pronuncation) {
      // Remove the whole Pronuncation section
      delimitSection(pronuncationTitle).forEach((i) => i.remove());
      pronuncationTitle.remove();

      // Put the pronuncation directly in the title
      searchHeader.innerText = `<${query}> ${pronuncation}`;
    }
  }

  const params = new URLSearchParams(window.location.search);
  if (params.has("freq")) {
    const container = document.createElement("div");
    container.classList.add("freqlist");
    searchHeader.insertAdjacentElement("afterend", container);

    KNOWN_FREQS.forEach((id, i) => {
      if (i > 0) container.insertAdjacentElement("beforeend", document.createElement("br"));

      const freq = frequencies.get(`${id}-freq`);
      const count = frequencies.get(`${id}-count`);
      const freqValue = freq ? (freq[query] ?? 0).toString() : "?";
      const countValue = count ? (count[query] ?? 0).toString() : "?";
      const freqEl = document.createElement("span");
      freqEl.innerText = `${id}: ${freqValue}`;
      container.insertAdjacentElement("beforeend", freqEl);
      const countEl = document.createElement("span");
      countEl.innerText = `(count): ${countValue}`;
      container.insertAdjacentElement("beforeend", countEl);
    });
  }

  const etymologyTitles = page.querySelectorAll<HTMLElement>("h3[data-h^=Etymology]");
  etymologyTitles.forEach((etymologyTitle) => {
    const content = delimitInlineSection(etymologyTitle);

    const details = document.createElement("details");
    etymologyTitle.insertAdjacentElement("afterend", details);

    const summary = document.createElement("summary");
    details.insertAdjacentElement("afterbegin", summary);

    summary.appendChild(etymologyTitle);
    content.forEach((i) => details.appendChild(i));
  });

  const tables = Array.from(page.querySelectorAll(".NavFrame .NavContent")).filter((i) =>
    (i.previousElementSibling as HTMLElement).textContent?.trim().startsWith("Conjugation of")
  );
  if (tables.length > 0) {
    const primaryTable = tables[0].firstElementChild as HTMLTableElement;
    filterVosotrosTable(primaryTable);
    filterCompactTable(primaryTable);
  }

  if (params.has("anki")) {
    const headwords = page.querySelectorAll<HTMLElement>(".headword");
    const duplicate = new Promise<boolean>((resolve) => {
      if (headwords.length > 0) {
        invoke<number[]>("findNotes", {
          query: `"deck:Words from textbook" "Expression:${headwords[0].innerText}"`,
        }).then((i) => {
          if (i.length === 0) resolve(true);
        });
      }
    });
    headwords.forEach((i) => {
      const headwordLine = i.parentElement;
      const headwordParagraph = headwordLine?.parentElement;
      let previousHeaderContainer = headwordParagraph?.previousElementSibling;
      let previousHeader = previousHeaderContainer?.firstElementChild as HTMLElement | null;
      if (previousHeader?.nodeName !== "H3" && previousHeader?.nodeName !== "H4") previousHeader = null;
      const gender = headwordLine?.querySelector(".gender");
      const list = headwordParagraph?.nextElementSibling;
      if (!headwordLine || !headwordParagraph || !list) return;
      if (list.nodeName !== "OL") return;
      const firstEntry = list.firstElementChild as HTMLElement | null;
      const primaryMeaning = firstEntry?.textContent?.split("\n")[0];
      if (!primaryMeaning) return;

      const link = document.createElement("input");
      link.type = "button";
      link.value = "+";
      link.addEventListener("click", () => {
        invoke("guiAddCards", {
          note: {
            deckName: "Words from textbook",
            modelName: "Basic+Spanish",
            fields: {
              Expression: i.innerText,
              Meaning: primaryMeaning,
              Notes: [previousHeader?.innerText.toLowerCase() ?? undefined, gender?.textContent ?? undefined]
                .filter((i) => i !== undefined)
                .join(" "),
            },
            tags: ["connect"],
          },
        });
      });
      duplicate.then(() => headwordLine.insertBefore(link, i));
    });
  }

  // Load into page
  if (activeQuery === query) {
    cleanup();
    content.appendChild(page);
    document.title = `${query} | Spanish`;
  }
}

// TODO: fix for those random pages which have their translations on a separate page for some reason
function englishTranslationLookup(page: HTMLElement, query: string, cleanup: () => void) {
  const rawQuery = query + "?";
  const englishHeader = page.querySelector<HTMLElement>("h2#English")?.parentElement;
  if (!englishHeader) {
    if (activeQuery === rawQuery) {
      const errorMessage = document.createElement("div");
      errorMessage.innerText = "This page has no English entry!";
      content.appendChild(errorMessage);
      cleanup();
    }
    return;
  }

  const englishSection: Element[] = delimitSection(englishHeader);
  Array.from(page.children)
    .filter((i) => !englishSection.includes(i))
    .forEach((i) => i.remove());

  const searchHeader = document.createElement("h1");
  searchHeader.innerText = query;
  page.prepend(searchHeader);

  const translationHeadings = page.querySelectorAll<HTMLElement>("[id^=Translations].mw-headline");
  const translationSections = Array.from(translationHeadings).flatMap((i) => delimitSection(i.parentElement!));

  const trList: HTMLElement[] = [];
  translationSections.forEach((i) => {
    if (i.className !== "NavFrame") return;
    const navHeader = i.firstElementChild! as HTMLElement;
    if (navHeader.className !== "NavHead") return;
    const navContent = i.lastElementChild!;
    if (navContent.className !== "NavContent") return;
    const trEnglish = navHeader.innerText;
    if (trEnglish === "Translations to be checked") return;

    const trElement = document.createElement("div");
    const trKey = document.createElement("span");
    trKey.innerText = trEnglish + ": ";
    trElement.appendChild(trKey);

    const trEntries = Array.from(navContent.querySelectorAll('li > span[lang="es"]'));
    if (trEntries.length === 0) {
      const trNothing = document.createElement("span");
      trNothing.innerText = "No translations";
      trNothing.className = "nothing";
      trElement.appendChild(trNothing);
    } else {
      trEntries.forEach((e, i) => {
        if (i > 0) {
          trElement.appendChild(document.createTextNode(", "));
        }
        e.classList.add("tr");
        trElement.appendChild(e);
      });
    }

    runRecursiveFilters(trElement);
    trList.push(trElement);
  });

  if (trList.length === 0) {
    if (activeQuery === rawQuery) {
      const errorMessage = document.createElement("div");
      errorMessage.innerText = "This page has no translations!";
      content.appendChild(errorMessage);
      cleanup();
    }
    return;
  }

  // Load into page
  if (activeQuery === rawQuery) {
    cleanup();
    trList.forEach((el) => content.appendChild(el));
    document.title = `${query}? | Spanish`;
  }
}

function startLoading() {
  // Clear previous results and create a spinner
  content.innerHTML = "";
  left.innerHTML = "";
  const loader = document.createElement("div");
  loader.className = "loader";
  content.appendChild(loader);

  return loader;
}

function makeQuery(query: string) {
  if (query == activeQuery) {
    return;
  }

  activeQuery = query;
  queryBox.value = query;
  window.location.hash = query;
  queryBox.disabled = true;
  const loader = startLoading();

  const cleanup = () => {
    loader.remove();
    queryBox.disabled = false;
    queryBox.select();
    document.title = "Spanish";
  };

  const originalQuery = query;
  const isTranslationLookup = query.endsWith("?");
  if (isTranslationLookup) {
    query = query.substring(0, query.length - 1);
  }

  controller.abort(); // Abort all existing queries
  controller = new AbortController(); // Make a new controller for the new query
  fetch(constructURL(query), {
    method: "GET",
    signal: controller.signal,
    headers: headers,
  })
    .then((r) => r.json())
    .then((json) => {
      // console.log(json);
      if (json.error) {
        console.error(json.error);
        const errorMessage = document.createElement("div");
        if (json.error.info) {
          errorMessage.title = json.error.code;
          errorMessage.innerText = json.error.info;
        } else {
          errorMessage.title = json.toString();
          errorMessage.innerText = "An unknown error ocurred";
        }
        if (activeQuery === originalQuery) {
          content.appendChild(errorMessage);
          cleanup();
        }
        return;
      }
      const html = json.parse.text;
      const wikitext = json.parse.wikitext;

      let page = new DOMParser().parseFromString(html, "text/html").body.children[0] as HTMLElement;

      // Delete all [edit] links, this is just for viewing, not editing
      page.querySelectorAll(".mw-editsection").forEach((i) => i.remove());
      // Delete all references [1], I don't need them here
      page.querySelectorAll(".reference").forEach((i) => i.remove());
      page.querySelectorAll(".external").forEach((i) => i.remove());

      if (isTranslationLookup) {
        englishTranslationLookup(page, query, cleanup);
      } else {
        spanishDefinitionLookup(page, query, wikitext, cleanup);
      }
    })
    .catch((err) => {
      if (activeQuery === originalQuery) {
        cleanup();
        console.error(err);
      }
    });
}

addEventListener("load", () => {
  form = document.getElementById("form") as HTMLFormElement;
  const params = new URLSearchParams(window.location.search);
  if (params.has("inline")) {
    form.classList.add("hidden");
  }

  queryBox = document.getElementById("query") as HTMLInputElement;
  content = document.getElementById("content") as HTMLDivElement;
  left = document.getElementById("leftMain") as HTMLDivElement;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = queryBox.value;

    makeQuery(query.toLowerCase());
  });

  if (document.location.hash !== "") {
    makeQuery(decodeURIComponent(document.location.hash.substring(1).toLowerCase()));
  }

  if (params.has("anki")) {
    invoke<AnkiPermissionResponse>("requestPermission").then((i) => console.log(i.permission));
  }

  if (params.has("freq")) {
    (async () => {
      for (const key of KNOWN_FREQS) {
        for (const suffix of VARIANTS) {
          try {
            const res = await fetch(`/freq/${key}${suffix}.json`);
            const json = await res.json();
            frequencies.set(`${key}${suffix}`, json);
          } catch {
            frequencies.set(`${key}${suffix}`, {});
          }
        }
      }
    })();
  }
});

addEventListener("hashchange", () => {
  if (document.location.hash !== "") {
    makeQuery(decodeURIComponent(document.location.hash.substring(1).toLowerCase()));
  }
});
